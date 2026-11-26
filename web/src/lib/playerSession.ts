const PLAYER_ID_KEY = 'geoguessr_player_id';
const PLAYER_NAME_KEY = 'geoguessr_player_name';
const ROOM_CODE_KEY = 'geoguessr_room_code';
const VIEW_MODE_KEY = 'geoguessr_view_mode';
const SESSION_TOKEN_KEY = 'geoguessr_session_token';
const ROOM_SESSIONS_KEY = 'geoguessr_room_sessions';
const ACTIVE_TABS_KEY = 'geoguessr_active_tabs';
const ROOM_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TAB_LEASE_TTL_MS = 6000;
const TAB_ID = `tab_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;

interface ActiveTabLease {
  roomCode: string;
  playerId: string;
  updatedAt: number;
}

export interface SavedRoomSession {
  playerId: string;
  sessionToken?: string;
  playerName?: string;
  isCreator?: boolean;
  updatedAt: number;
}

function createRandomPlayerId(): string {
  const rand = Math.random().toString(36).slice(2, 8);
  const ts = Date.now().toString(36).slice(-4);
  return `player_${ts}_${rand}`;
}

export function getSessionPlayerId(): string {
  if (typeof window === 'undefined') return 'human';
  try {
    const existing = window.sessionStorage.getItem(PLAYER_ID_KEY)?.trim();
    if (existing && existing.length > 0) {
      return existing;
    }
    const created = createRandomPlayerId();
    window.sessionStorage.setItem(PLAYER_ID_KEY, created);
    return created;
  } catch {
    return 'human';
  }
}

export function setSessionPlayerId(playerId: string): void {
  if (typeof window === 'undefined') return;
  try {
    const clean = playerId.trim();
    if (clean) {
      window.sessionStorage.setItem(PLAYER_ID_KEY, clean);
    }
  } catch {
    // ignore storage errors
  }
}

export function getSessionToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const token = window.sessionStorage.getItem(SESSION_TOKEN_KEY)?.trim();
    return token || null;
  } catch {
    return null;
  }
}

export function setSessionToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (token && token.trim()) {
      window.sessionStorage.setItem(SESSION_TOKEN_KEY, token.trim());
    } else {
      window.sessionStorage.removeItem(SESSION_TOKEN_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

function readRoomSessionsMap(): Record<string, SavedRoomSession> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(ROOM_SESSIONS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const now = Date.now();
    const cleaned: Record<string, SavedRoomSession> = {};
    for (const [code, val] of Object.entries(
      parsed as Record<string, unknown>
    )) {
      if (!val || typeof val !== 'object') continue;
      const entry = val as Partial<SavedRoomSession>;
      if (
        typeof entry.playerId === 'string' &&
        entry.playerId.trim() &&
        typeof entry.updatedAt === 'number' &&
        now - entry.updatedAt <= ROOM_SESSION_TTL_MS
      ) {
        cleaned[code.toUpperCase()] = {
          playerId: entry.playerId.trim(),
          sessionToken:
            typeof entry.sessionToken === 'string' && entry.sessionToken.trim()
              ? entry.sessionToken.trim()
              : undefined,
          playerName:
            typeof entry.playerName === 'string' && entry.playerName.trim()
              ? entry.playerName.trim()
              : undefined,
          isCreator: Boolean(entry.isCreator),
          updatedAt: entry.updatedAt,
        };
      }
    }
    return cleaned;
  } catch {
    return {};
  }
}

function writeRoomSessionsMap(map: Record<string, SavedRoomSession>): void {
  if (typeof window === 'undefined') return;
  try {
    const entries = Object.entries(map)
      .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
      .slice(0, 20);
    window.localStorage.setItem(
      ROOM_SESSIONS_KEY,
      JSON.stringify(Object.fromEntries(entries))
    );
  } catch {
    // ignore storage errors
  }
}

function readActiveTabsMap(): Record<string, ActiveTabLease> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(ACTIVE_TABS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const now = Date.now();
    const cleaned: Record<string, ActiveTabLease> = {};
    for (const [tid, val] of Object.entries(parsed as Record<string, unknown>)) {
      if (!val || typeof val !== 'object') continue;
      const entry = val as Partial<ActiveTabLease>;
      if (
        typeof entry.roomCode === 'string' &&
        typeof entry.playerId === 'string' &&
        typeof entry.updatedAt === 'number' &&
        now - entry.updatedAt <= TAB_LEASE_TTL_MS
      ) {
        cleaned[tid] = {
          roomCode: entry.roomCode.trim().toUpperCase(),
          playerId: entry.playerId.trim(),
          updatedAt: entry.updatedAt,
        };
      }
    }
    return cleaned;
  } catch {
    return {};
  }
}

function writeActiveTabsMap(map: Record<string, ActiveTabLease>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(ACTIVE_TABS_KEY, JSON.stringify(map));
  } catch {
    // ignore storage errors
  }
}

export function claimActiveRoomTab(roomCode: string, playerId: string): void {
  const cleanRoom = roomCode.trim().toUpperCase();
  const cleanPlayer = playerId.trim();
  if (!cleanRoom || cleanRoom === 'ARENA1' || cleanRoom === 'DEFAULT') return;
  if (!cleanPlayer) return;
  const map = readActiveTabsMap();
  map[TAB_ID] = {
    roomCode: cleanRoom,
    playerId: cleanPlayer,
    updatedAt: Date.now(),
  };
  writeActiveTabsMap(map);
}

export function releaseActiveRoomTab(): void {
  if (typeof window === 'undefined') return;
  const map = readActiveTabsMap();
  if (TAB_ID in map) {
    delete map[TAB_ID];
    writeActiveTabsMap(map);
  }
}

export function isRoomPlayerActiveInOtherTab(
  roomCode: string,
  playerId: string
): boolean {
  const cleanRoom = roomCode.trim().toUpperCase();
  const cleanPlayer = playerId.trim();
  if (!cleanRoom || !cleanPlayer) return false;
  const map = readActiveTabsMap();
  for (const [tid, lease] of Object.entries(map)) {
    if (
      tid !== TAB_ID &&
      lease.roomCode === cleanRoom &&
      lease.playerId === cleanPlayer
    ) {
      return true;
    }
  }
  return false;
}

export function saveRoomSession(
  roomCode: string,
  entry: {
    playerId: string;
    sessionToken?: string | null;
    playerName?: string;
    isCreator?: boolean;
  }
): void {
  const clean = roomCode.trim().toUpperCase();
  const cleanPlayerId = entry.playerId.trim();
  if (!clean || clean === 'ARENA1' || clean === 'DEFAULT') return;
  if (!cleanPlayerId) return;
  const map = readRoomSessionsMap();
  const prev = map[clean];
  if (prev?.isCreator && !entry.isCreator && cleanPlayerId !== prev.playerId) {
    return;
  }
  const samePlayer = prev?.playerId === cleanPlayerId;
  map[clean] = {
    playerId: cleanPlayerId,
    sessionToken:
      entry.sessionToken?.trim() ||
      (samePlayer ? prev?.sessionToken : undefined),
    playerName:
      entry.playerName?.trim() || (samePlayer ? prev?.playerName : undefined),
    isCreator:
      entry.isCreator ?? (samePlayer ? prev?.isCreator : false) ?? false,
    updatedAt: Date.now(),
  };
  writeRoomSessionsMap(map);
}

export function getSavedRoomSession(roomCode: string): SavedRoomSession | null {
  const clean = roomCode.trim().toUpperCase();
  if (!clean || clean === 'ARENA1' || clean === 'DEFAULT') return null;
  const map = readRoomSessionsMap();
  return map[clean] || null;
}

export function clearSavedRoomSession(
  roomCode: string | null,
  expectedPlayerId?: string
): void {
  if (!roomCode) return;
  const clean = roomCode.trim().toUpperCase();
  if (!clean) return;
  const map = readRoomSessionsMap();
  if (!(clean in map)) return;
  const expected = expectedPlayerId?.trim();
  if (expected && map[clean]?.playerId !== expected) {
    return;
  }
  delete map[clean];
  writeRoomSessionsMap(map);
}

export function restoreRoomSessionToTab(
  roomCode: string | null
): SavedRoomSession | null {
  if (!roomCode) return null;
  const clean = roomCode.trim().toUpperCase();
  if (!clean || clean === 'ARENA1' || clean === 'DEFAULT') return null;

  const saved = getSavedRoomSession(clean);
  if (!saved || !saved.sessionToken) return null;

  if (isRoomPlayerActiveInOtherTab(clean, saved.playerId)) {
    return null;
  }

  const activeTabRoom = getSessionRoomCode();
  const activeTabToken = getSessionToken();
  if (activeTabToken && activeTabRoom && activeTabRoom !== clean) {
    return null;
  }

  setSessionPlayerId(saved.playerId);
  setSessionToken(saved.sessionToken);
  if (saved.playerName) {
    setSessionPlayerName(saved.playerName);
  }
  return saved;
}

export function getSessionPlayerName(): string {
  if (typeof window === 'undefined') return 'You (Player)';
  try {
    return window.sessionStorage.getItem(PLAYER_NAME_KEY)?.trim() || 'You (Player)';
  } catch {
    return 'You (Player)';
  }
}

export function getAutoJoinPlayerName(): string {
  if (typeof window === 'undefined') return 'Player';
  try {
    const saved = window.sessionStorage.getItem(PLAYER_NAME_KEY)?.trim();
    if (saved && saved !== 'You (Player)') {
      return saved;
    }
  } catch {
    // ignore
  }
  const pid = getSessionPlayerId();
  const suffix = pid.replace(/[^a-zA-Z0-9]/g, '').slice(-4).toUpperCase() || '1';
  return `Player ${suffix}`;
}

export function extractRoomCodeInput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  try {
    if (
      trimmed.includes('://') ||
      trimmed.includes('?room=') ||
      trimmed.includes('/room/')
    ) {
      const url = new URL(trimmed, 'http://localhost');
      const fromQuery = url.searchParams.get('room')?.trim();
      if (fromQuery) {
        return fromQuery
          .replace(/[^a-zA-Z0-9_-]/g, '')
          .toUpperCase()
          .slice(0, 24);
      }
      const pathMatch = url.pathname.match(
        /\/room\/([A-Za-z0-9_-]{4,24})\/?$/
      );
      if (pathMatch) return pathMatch[1].toUpperCase();
    }
  } catch {
    // treat as raw room code
  }
  return trimmed
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .toUpperCase()
    .slice(0, 24);
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof window === 'undefined' || !text) return false;
  try {
    if (window.navigator?.clipboard?.writeText) {
      await window.navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall back to execCommand below on non-HTTPS LAN origins or restricted contexts
  }
  try {
    const el = document.createElement('textarea');
    el.value = text;
    el.setAttribute('readonly', '');
    el.style.position = 'fixed';
    el.style.left = '-9999px';
    el.style.top = '-9999px';
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}

export function getUrlRoomCode(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get('room')?.trim().toUpperCase();
    if (fromQuery && fromQuery !== 'ARENA1' && fromQuery !== 'DEFAULT') {
      return fromQuery;
    }
    const pathMatch = window.location.pathname.match(
      /^\/room\/([A-Za-z0-9_-]{4,24})\/?$/
    );
    if (pathMatch) {
      const fromPath = pathMatch[1].toUpperCase();
      if (fromPath !== 'ARENA1' && fromPath !== 'DEFAULT') {
        return fromPath;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

export function syncUrlRoomCode(roomCode: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    const clean = roomCode?.trim().toUpperCase() || null;
    const isShareableRoom =
      Boolean(clean) && clean !== 'ARENA1' && clean !== 'DEFAULT';
    const url = new URL(window.location.href);
    if (url.pathname.startsWith('/room/')) {
      url.pathname = '/';
    }
    if (isShareableRoom && clean) {
      url.searchParams.set('room', clean);
    } else {
      url.searchParams.delete('room');
    }
    const nextHref = `${url.pathname}${url.search}${url.hash}`;
    const currHref = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextHref !== currHref) {
      window.history.replaceState({}, '', nextHref);
    }
  } catch {
    // ignore history errors
  }
}

export function buildRoomInviteUrl(roomCode: string): string {
  const clean = roomCode.trim().toUpperCase();
  if (typeof window === 'undefined') return `/?room=${encodeURIComponent(clean)}`;
  const url = new URL(window.location.origin);
  url.pathname = '/';
  url.searchParams.set('room', clean);
  return url.toString();
}

export function setSessionPlayerName(name: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(PLAYER_NAME_KEY, name.trim() || 'You (Player)');
  } catch {
    // ignore storage errors
  }
}

export function getSessionRoomCode(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const code = window.sessionStorage.getItem(ROOM_CODE_KEY)?.trim().toUpperCase();
    return code || null;
  } catch {
    return null;
  }
}

export function setSessionRoomCode(roomCode: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (roomCode && roomCode.trim()) {
      window.sessionStorage.setItem(ROOM_CODE_KEY, roomCode.trim().toUpperCase());
    } else {
      window.sessionStorage.removeItem(ROOM_CODE_KEY);
    }
  } catch {
    // ignore
  }
}

export function getSessionViewMode(): 'home' | 'arena' {
  if (typeof window === 'undefined') return 'home';
  try {
    const val = window.sessionStorage.getItem(VIEW_MODE_KEY);
    return val === 'arena' ? 'arena' : 'home';
  } catch {
    return 'home';
  }
}

export function setSessionViewMode(mode: 'home' | 'arena'): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(VIEW_MODE_KEY, mode);
  } catch {
    // ignore
  }
}
