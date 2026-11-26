import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const TOKEN_PREFIX = 'gs';
const TOKEN_TTL_SEC = 7 * 24 * 60 * 60;
const PLAYER_ID_REGEX = /^[a-zA-Z0-9_-]{3,64}$/;

export interface IssuedSession {
  playerId: string;
  sessionToken: string;
}

export interface VerifiedSession {
  playerId: string;
  issuedAtSec: number;
}

function loadOrCreateSecret(cacheDir: string): string {
  const envSecret = process.env.SESSION_SECRET?.trim();
  if (envSecret && envSecret.length >= 16) {
    return envSecret;
  }

  const secretPath = path.resolve(cacheDir, '..', '.session-secret');
  try {
    if (fs.existsSync(secretPath)) {
      const stored = fs.readFileSync(secretPath, 'utf8').trim();
      if (stored.length >= 32) {
        return stored;
      }
    }
  } catch {
    // Fall through to generate a new secret
  }

  const generated = crypto.randomBytes(32).toString('hex');
  try {
    fs.mkdirSync(path.dirname(secretPath), { recursive: true });
    fs.writeFileSync(secretPath, generated, { encoding: 'utf8', mode: 0o600 });
  } catch {
    // Keep in-memory secret if filesystem is read-only
  }
  return generated;
}

/**
 * Issues and verifies HMAC-SHA256 signed temporary player session tokens.
 * Tokens use the `gs.<playerId>.<issuedAtSec>.<sig>` format so clients can
 * prove ownership of a playerId across refreshes and reopened tabs.
 */
export class SessionAuth {
  private readonly secret: string;

  constructor(cacheDir: string) {
    this.secret = loadOrCreateSecret(cacheDir);
  }

  private sign(payload: string): string {
    return crypto
      .createHmac('sha256', this.secret)
      .update(payload)
      .digest('hex');
  }

  public issueSession(opts?: {
    preferredPlayerId?: string;
  }): IssuedSession {
    const candidate = opts?.preferredPlayerId?.trim();
    const playerId =
      candidate && candidate !== 'human' && PLAYER_ID_REGEX.test(candidate)
        ? candidate
        : `player_${crypto.randomBytes(4).toString('hex')}`;

    const issuedAtSec = Math.floor(Date.now() / 1000);
    const sig = this.sign(`${playerId}.${issuedAtSec}`);
    return {
      playerId,
      sessionToken: `${TOKEN_PREFIX}.${playerId}.${issuedAtSec}.${sig}`,
    };
  }

  public verifyToken(token: string | null | undefined): VerifiedSession | null {
    if (!token || typeof token !== 'string') return null;
    const parts = token.trim().split('.');
    if (parts.length !== 4 || parts[0] !== TOKEN_PREFIX) return null;

    const [, playerId, tsRaw, sig] = parts;
    if (!PLAYER_ID_REGEX.test(playerId) || playerId === 'human') return null;
    if (!/^\d+$/.test(tsRaw)) return null;

    const issuedAtSec = Number(tsRaw);
    const nowSec = Math.floor(Date.now() / 1000);
    if (issuedAtSec > nowSec + 60 || nowSec - issuedAtSec > TOKEN_TTL_SEC) {
      return null;
    }

    const expectedSig = this.sign(`${playerId}.${issuedAtSec}`);
    const sigBuf = Buffer.from(sig, 'utf8');
    const expectedBuf = Buffer.from(expectedSig, 'utf8');
    if (sigBuf.length !== expectedBuf.length) return null;
    if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

    return { playerId, issuedAtSec };
  }

  public extractTokenFromRequest(req: {
    header?: (name: string) => string | undefined;
    query?: Record<string, unknown>;
  }): string | undefined {
    const headerVal = req.header?.('x-session-token')?.trim();
    if (headerVal) return headerVal;
    const queryVal = req.query?.sessionToken;
    if (typeof queryVal === 'string' && queryVal.trim()) {
      return queryVal.trim();
    }
    return undefined;
  }
}
