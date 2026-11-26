import assert, { AssertionError } from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { WebSocket } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.resolve(__dirname, '..', '..');
export const BACKEND_PORT = 3101;
export const MCP_HTTP_PORT = 3102;
export const FORBIDDEN_PORTS = Object.freeze([5173, 3001]);

export const BASE_URL = process.env.E2E_BACKEND_URL || `http://127.0.0.1:${BACKEND_PORT}`;
export const MCP_HTTP_URL = process.env.E2E_MCP_HTTP_URL || `http://127.0.0.1:${MCP_HTTP_PORT}`;
export const WS_URL = process.env.E2E_WS_URL || `ws://127.0.0.1:${BACKEND_PORT}/ws`;
export const LIVE_UI_URL = process.env.E2E_LIVE_UI_URL || 'http://localhost:5173';

const VALID_TIERS = new Set([1, 2, 3, 4]);
const VALID_KINDS = new Set(['api', 'mcp', 'ws', 'browser']);
const SECRET_ENV_KEYS = ['MAPILLARY_ACCESS_TOKEN', 'GOOGLE_MAPS_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'];
const SECRET_PATTERNS = [
  { name: 'Mapillary token', regex: /MLY\|[A-Za-z0-9_|-]{8,}/g },
  { name: 'Google API key', regex: /AIza[0-9A-Za-z_-]{16,}/g },
  { name: 'API secret key', regex: /\bsk-[A-Za-z0-9_-]{16,}\b/g },
  { name: 'Bearer token', regex: /Bearer\s+[A-Za-z0-9._-]{16,}/gi },
];

const trackedProcs = new Set();
const trackedCleanups = new Set();
let hooksRegistered = false;
let seqCounter = 0;

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function assertSafePort(port) {
  const num = Number(port);
  if (!Number.isInteger(num) || num <= 0 || num > 65535) {
    throw new Error(`Invalid port number: ${port}`);
  }
  if (FORBIDDEN_PORTS.includes(num)) {
    throw new Error(
      `Refusing to start/stop or touch forbidden live dev port ${num}. Forbidden ports: ${FORBIDDEN_PORTS.join(', ')}`
    );
  }
  return num;
}

function getSecretEnvValues() {
  const vals = [];
  for (const key of SECRET_ENV_KEYS) {
    const val = process.env[key];
    if (typeof val === 'string' && val.trim().length >= 8) {
      vals.push({ key, value: val.trim() });
    }
  }
  return vals;
}

export function scrubSecrets(input) {
  let text = typeof input === 'string' ? input : JSON.stringify(input ?? '');
  if (typeof text !== 'string') text = String(text);
  for (const { value } of getSecretEnvValues()) {
    if (text.includes(value)) {
      text = text.split(value).join('[REDACTED]');
    }
  }
  for (const { regex } of SECRET_PATTERNS) {
    regex.lastIndex = 0;
    text = text.replace(regex, '[REDACTED]');
  }
  return text;
}

export function assertNoSecretLeak(input, label = 'output') {
  const text = typeof input === 'string' ? input : JSON.stringify(input ?? '');
  if (typeof text !== 'string' || text.length === 0) return;

  for (const { key, value } of getSecretEnvValues()) {
    if (text.includes(value)) {
      throw new AssertionError({
        message: `Secret leak detected in ${label}: matched env secret ${key} ([REDACTED])`,
        operator: 'assertNoSecretLeak',
      });
    }
  }

  for (const { name, regex } of SECRET_PATTERNS) {
    regex.lastIndex = 0;
    if (regex.test(text)) {
      regex.lastIndex = 0;
      throw new AssertionError({
        message: `Secret leak detected in ${label}: matched ${name} pattern ([REDACTED])`,
        operator: 'assertNoSecretLeak',
      });
    }
  }
}

export function uniqueRoomCode(prefix = 'E2E') {
  seqCounter += 1;
  const cleanPrefix = String(prefix).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) || 'E2E';
  const suffix = `${Date.now().toString(36)}${seqCounter.toString(36)}`.toUpperCase();
  return `${cleanPrefix}${suffix}`.slice(0, 12);
}

export function uniquePlayerId(prefix = 'p') {
  seqCounter += 1;
  const cleanPrefix = String(prefix).replace(/[^a-zA-Z0-9_-]/g, '') || 'p';
  return `${cleanPrefix}-${Date.now().toString(36)}-${seqCounter}`;
}

export function assertJpeg(base64OrBuf, label = 'image') {
  const buf = Buffer.isBuffer(base64OrBuf)
    ? base64OrBuf
    : Buffer.from(String(base64OrBuf), 'base64');
  assert.ok(buf.length > 5000, `${label}: JPEG too small (${buf.length} bytes)`);
  assert.equal(buf[0], 0xff, `${label}: missing JPEG SOI 0xFF`);
  assert.equal(buf[1], 0xd8, `${label}: missing JPEG SOI 0xD8`);
  assert.equal(buf[2], 0xff, `${label}: missing JPEG marker 0xFF`);
  return buf;
}

export function getTextContent(mcpResult) {
  assert.ok(mcpResult && Array.isArray(mcpResult.content), 'Expected MCP tool result with content array');
  const item = mcpResult.content.find((c) => c.type === 'text');
  assert.ok(item && typeof item.text === 'string' && item.text.length > 0, 'Expected text content in MCP tool result');
  return JSON.parse(item.text);
}

export function getImageContent(mcpResult) {
  assert.ok(mcpResult && Array.isArray(mcpResult.content), 'Expected MCP tool result with content array');
  const item = mcpResult.content.find((c) => c.type === 'image');
  assert.ok(item && item.data, 'Expected image content in MCP tool result');
  assert.equal(item.mimeType, 'image/jpeg', `Expected image/jpeg mimeType, got ${item.mimeType}`);
  return item.data;
}

function normalizeFeatureId(id) {
  return String(id).trim().toUpperCase();
}

export function testCase(spec) {
  assert.ok(spec && typeof spec === 'object', 'testCase requires a specification object');
  const { id, tier, featureIds, title, kind, run, requiresBrowser, requiresMcp } = spec;
  assert.ok(typeof id === 'string' && id.trim().length > 0, 'testCase requires non-empty string id');
  assert.ok(VALID_TIERS.has(Number(tier)), `testCase(${id}) invalid tier: ${tier}`);
  assert.ok(Array.isArray(featureIds) && featureIds.length > 0, `testCase(${id}) requires non-empty featureIds array`);
  assert.ok(typeof title === 'string' && title.trim().length > 0, `testCase(${id}) requires non-empty title`);
  assert.ok(VALID_KINDS.has(kind), `testCase(${id}) invalid kind: ${kind}`);
  assert.equal(typeof run, 'function', `testCase(${id}) requires run async function`);

  return Object.freeze({
    id: id.trim(),
    tier: Number(tier),
    featureIds: Object.freeze(featureIds.map(normalizeFeatureId)),
    title: title.trim(),
    kind,
    requiresBrowser: Boolean(requiresBrowser ?? kind === 'browser'),
    requiresMcp: Boolean(requiresMcp ?? kind === 'mcp'),
    run,
  });
}

export function defineSuite(specOrName, maybeCases) {
  let tier = null;
  let name = '';
  let cases = [];

  if (typeof specOrName === 'string') {
    name = specOrName;
    cases = Array.isArray(maybeCases) ? maybeCases : [];
  } else if (specOrName && typeof specOrName === 'object') {
    tier = specOrName.tier ?? null;
    name = specOrName.name || '';
    cases = Array.isArray(specOrName.cases) ? specOrName.cases : [];
  } else {
    throw new Error('defineSuite requires (name, cases) or ({ tier, name, cases })');
  }

  const normalized = cases.map(testCase);
  if (tier === null && normalized.length > 0) {
    tier = normalized[0].tier;
  }

  return Object.freeze({
    tier,
    name: name || (tier ? `Tier ${tier}` : 'Suite'),
    cases: Object.freeze(normalized),
  });
}

export class SuiteResult {
  constructor({ tier = null, name = '', results = [], durationMs = 0 } = {}) {
    this.tier = tier;
    this.name = name;
    this.results = results;
    this.durationMs = durationMs;
    this.total = results.length;
    this.passed = results.filter((r) => r.status === 'passed').length;
    this.failed = results.filter((r) => r.status === 'failed').length;
    this.skipped = results.filter((r) => r.status === 'skipped').length;
  }
}

function buildFilterMatcher(filter) {
  if (!filter) return () => true;
  const raw = String(filter).trim();
  if (!raw) return () => true;

  if (raw.startsWith('/') && raw.lastIndexOf('/') > 0) {
    const lastSlash = raw.lastIndexOf('/');
    const pattern = raw.slice(1, lastSlash);
    const flags = (raw.slice(lastSlash + 1) || 'i').replace(/g/g, '');
    const regex = new RegExp(pattern, flags);
    return (tc) => regex.test(tc.id) || regex.test(tc.title) || regex.test(tc.featureIds.join(','));
  }

  const needle = raw.toLowerCase();
  return (tc) =>
    tc.id.toLowerCase().includes(needle) ||
    tc.title.toLowerCase().includes(needle) ||
    tc.featureIds.some((f) => f.toLowerCase().includes(needle));
}

function buildFeatureMatcher(features) {
  if (!features || features === 'all') return () => true;
  const set = new Set(
    (Array.isArray(features) ? features : [features]).map((f) => normalizeFeatureId(f))
  );
  if (set.size === 0) return () => true;
  return (tc) => tc.featureIds.some((f) => set.has(f));
}

function buildTierMatcher(tiers) {
  if (!tiers || tiers === 'all') return () => true;
  const set = new Set((Array.isArray(tiers) ? tiers : [tiers]).map(Number));
  if (set.size === 0) return () => true;
  return (tc) => set.has(tc.tier);
}

export function validateUniqueCaseIds(suites) {
  const seen = new Map();
  for (const suite of suites) {
    for (const tc of suite.cases) {
      if (seen.has(tc.id)) {
        throw new Error(`Duplicate E2E test case ID detected: ${tc.id} (in ${seen.get(tc.id)} and ${suite.name})`);
      }
      seen.set(tc.id, suite.name);
    }
  }
}

export async function runSuites(suites, options = {}) {
  const suiteList = Array.isArray(suites) ? suites : [suites];
  validateUniqueCaseIds(suiteList);

  const tierMatch = buildTierMatcher(options.tiers);
  const featureMatch = buildFeatureMatcher(options.features);
  const filterMatch = buildFilterMatcher(options.filter);
  const withBrowser = Boolean(options.withBrowser);
  const dryRunLike = Boolean(options.dryRun || options.syntaxOnly || options.list);
  const log = typeof options.logger === 'function' ? options.logger : (line) => console.log(line);

  const suiteResults = [];
  const startAll = Date.now();

  for (const suite of suiteList) {
    const matchedCases = suite.cases.filter(
      (tc) => tierMatch(tc) && featureMatch(tc) && filterMatch(tc)
    );
    if (matchedCases.length === 0) continue;

    const suiteStart = Date.now();
    const caseResults = [];

    for (const tc of matchedCases) {
      if (dryRunLike) {
        const wouldSkip = tc.requiresBrowser && !withBrowser;
        caseResults.push({
          id: tc.id,
          tier: tc.tier,
          featureIds: tc.featureIds,
          title: tc.title,
          kind: tc.kind,
          requiresBrowser: tc.requiresBrowser,
          requiresMcp: tc.requiresMcp,
          status: wouldSkip ? 'skipped' : 'planned',
          durationMs: 0,
          ...(wouldSkip ? { skipReason: 'browser disabled (--no-browser)' } : {}),
        });
        continue;
      }

      if (tc.requiresBrowser && !withBrowser) {
        const res = {
          id: tc.id,
          tier: tc.tier,
          featureIds: tc.featureIds,
          title: tc.title,
          kind: tc.kind,
          status: 'skipped',
          durationMs: 0,
          skipReason: 'browser checks disabled (pass --with-browser)',
        };
        caseResults.push(res);
        log(`  [SKIP] ${tc.id} — ${tc.title} (${res.skipReason})`);
        continue;
      }

      const cleanups = [];
      const caseStart = Date.now();
      const baseHelpers =
        typeof options.helpersFactory === 'function'
          ? await options.helpersFactory({ testCase: tc, options })
          : {};

      const helpers = {
        baseUrl: options.baseUrl ?? BASE_URL,
        mcpHttpUrl: options.mcpHttpUrl ?? MCP_HTTP_URL,
        wsUrl: options.wsUrl ?? WS_URL,
        uiUrl: options.uiUrl ?? options.liveUiUrl ?? (options.liveUi ? LIVE_UI_URL : BASE_URL),
        withBrowser,
        liveUi: Boolean(options.liveUi || options.liveUiUrl),
        skipServer: Boolean(options.skipServer),
        apiFetch,
        connectUiWs,
        waitForWsMessage,
        connectStdioMcp,
        connectHttpMcp,
        connectSseMcp,
        assertNoSecretLeak,
        scrubSecrets,
        assertJpeg,
        getTextContent,
        getImageContent,
        uniqueRoomCode,
        uniquePlayerId,
        sleep,
        waitForHttpOk,
        ...baseHelpers,
        onCleanup(fn) {
          if (typeof fn === 'function') cleanups.push(fn);
        },
      };

      try {
        await tc.run(helpers);
        const durationMs = Date.now() - caseStart;
        caseResults.push({
          id: tc.id,
          tier: tc.tier,
          featureIds: tc.featureIds,
          title: tc.title,
          kind: tc.kind,
          status: 'passed',
          durationMs,
        });
        log(`  [PASS] ${tc.id} (${durationMs}ms) — ${tc.title}`);
      } catch (err) {
        const durationMs = Date.now() - caseStart;
        const rawErr = err instanceof Error ? err.stack || err.message : String(err);
        const safeErr = scrubSecrets(rawErr);
        caseResults.push({
          id: tc.id,
          tier: tc.tier,
          featureIds: tc.featureIds,
          title: tc.title,
          kind: tc.kind,
          status: 'failed',
          durationMs,
          error: safeErr,
        });
        log(`  [FAIL] ${tc.id} (${durationMs}ms) — ${tc.title}\n         ${safeErr.split('\n')[0]}`);
      } finally {
        for (let i = cleanups.length - 1; i >= 0; i -= 1) {
          try {
            await Promise.race([Promise.resolve(cleanups[i]()), sleep(2500)]);
          } catch {
            // ignore cleanup failures after reporting test outcome
          }
        }
      }
    }

    suiteResults.push(
      new SuiteResult({
        tier: suite.tier,
        name: suite.name,
        results: caseResults,
        durationMs: Date.now() - suiteStart,
      })
    );
  }

  const total = suiteResults.reduce((acc, s) => acc + s.total, 0);
  const passed = suiteResults.reduce((acc, s) => acc + s.passed, 0);
  const failed = suiteResults.reduce((acc, s) => acc + s.failed, 0);
  const skipped = suiteResults.reduce((acc, s) => acc + s.skipped, 0);

  return {
    ok: failed === 0,
    suites: suiteResults,
    summary: {
      total,
      passed,
      failed,
      skipped,
      durationMs: Date.now() - startAll,
    },
  };
}

export async function waitForHttpOk(url, timeoutMs = 15000) {
  const start = Date.now();
  let lastError = null;
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
      if (res.ok) {
        const text = await res.text();
        try {
          return JSON.parse(text);
        } catch {
          return text;
        }
      }
      lastError = new Error(`HTTP ${res.status} from ${url}`);
    } catch (err) {
      lastError = err;
    }
    await sleep(200);
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for ${url}: ${lastError?.message || 'unreachable'}`);
}

export function checkBuildArtifacts() {
  const required = [
    path.join(ROOT_DIR, 'shared', 'dist', 'index.js'),
    path.join(ROOT_DIR, 'web', 'dist', 'index.html'),
    path.join(ROOT_DIR, 'web', 'dist-server', 'index.js'),
    path.join(ROOT_DIR, 'mcp-server', 'dist', 'index.js'),
  ];
  const missing = required.filter((p) => !fs.existsSync(p));
  if (missing.length > 0) {
    const rel = missing.map((p) => path.relative(ROOT_DIR, p));
    throw new Error(`Missing build artifacts (${rel.join(', ')}). Run "npm run build" first.`);
  }
  return required;
}

export async function isPortListening(port, host = '127.0.0.1') {
  assertSafePort(port);
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (val) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(val);
    };
    socket.setTimeout(500);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(Number(port), host);
  });
}

function registerProcessExitHooks() {
  if (hooksRegistered) return;
  hooksRegistered = true;
  const emergencyKill = () => {
    for (const proc of trackedProcs) {
      try {
        if (proc.pid && process.platform === 'win32') {
          execFile('taskkill', ['/PID', String(proc.pid), '/T', '/F'], () => {});
        } else {
          proc.kill('SIGKILL');
        }
      } catch {
        // ignore
      }
    }
  };
  process.once('exit', emergencyKill);
}

function attachRingBuffer(stream, limit = 40) {
  const lines = [];
  if (!stream) return lines;
  stream.on('data', (chunk) => {
    const text = scrubSecrets(String(chunk));
    for (const line of text.split(/\r?\n/)) {
      if (!line) continue;
      lines.push(line);
      if (lines.length > limit) lines.shift();
    }
  });
  return lines;
}

async function killSpawnedProcess(proc) {
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) {
    trackedProcs.delete(proc);
    return;
  }

  const exited = new Promise((resolve) => {
    proc.once('exit', () => resolve(true));
  });

  if (process.platform === 'win32' && proc.pid) {
    await new Promise((resolve) => {
      execFile('taskkill', ['/PID', String(proc.pid), '/T', '/F'], () => resolve());
    });
  } else {
    try {
      proc.kill('SIGTERM');
    } catch {
      // ignore
    }
    const fast = await Promise.race([exited, sleep(1500).then(() => false)]);
    if (!fast) {
      try {
        proc.kill('SIGKILL');
      } catch {
        // ignore
      }
    }
  }

  await Promise.race([exited, sleep(3000)]);
  trackedProcs.delete(proc);
}

export async function startIsolatedBackend(opts = {}) {
  const port = assertSafePort(opts.port ?? BACKEND_PORT);
  const host = opts.host ?? '127.0.0.1';
  const baseUrl = `http://${host}:${port}`;
  const entry = path.join(ROOT_DIR, 'web', 'dist-server', 'index.js');

  if (!fs.existsSync(entry)) {
    throw new Error(`Backend build artifact missing at ${path.relative(ROOT_DIR, entry)}. Run "npm run build" first.`);
  }
  if (await isPortListening(port, host)) {
    throw new Error(`Port ${port} is already in use by another process. Cannot start isolated E2E backend.`);
  }

  registerProcessExitHooks();

  const childEnv = {
    ...process.env,
    PORT: String(port),
    PANORAMA_PROVIDER: opts.provider ?? 'open',
    ENABLE_WIKIMEDIA_FETCH: opts.enableWikimediaFetch ? 'true' : 'false',
    MAPILLARY_ACCESS_TOKEN: '',
    GOOGLE_MAPS_API_KEY: '',
    OPENAI_API_KEY: '',
    ANTHROPIC_API_KEY: '',
  };
  if (opts.env && typeof opts.env === 'object') {
    Object.assign(childEnv, opts.env);
  }

  const proc = spawn(process.execPath, [entry], {
    cwd: ROOT_DIR,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  trackedProcs.add(proc);

  const stdoutRing = attachRingBuffer(proc.stdout);
  const stderrRing = attachRingBuffer(proc.stderr);

  const earlyExit = new Promise((_, reject) => {
    proc.once('exit', (code, signal) => {
      reject(
        new Error(
          `Isolated backend exited early (code=${code}, signal=${signal}). Logs:\n${[...stdoutRing, ...stderrRing].join('\n')}`
        )
      );
    });
  });

  try {
    const health = await Promise.race([
      waitForHttpOk(`${baseUrl}/api/health`, opts.timeoutMs ?? 15000),
      earlyExit,
    ]);
    assert.equal(health?.status, 'ok', `Unexpected backend health status: ${JSON.stringify(health)}`);
    return {
      proc,
      port,
      baseUrl,
      stop: () => killSpawnedProcess(proc),
    };
  } catch (err) {
    await killSpawnedProcess(proc);
    throw err;
  }
}

export async function startIsolatedMcpServer(opts = {}) {
  const port = assertSafePort(opts.port ?? MCP_HTTP_PORT);
  const host = opts.host ?? '127.0.0.1';
  const mcpHttpUrl = `http://${host}:${port}`;
  const backendUrl = opts.backendUrl ?? BASE_URL;
  const entry = path.join(ROOT_DIR, 'mcp-server', 'dist', 'index.js');

  if (!fs.existsSync(entry)) {
    throw new Error(`MCP server build artifact missing at ${path.relative(ROOT_DIR, entry)}. Run "npm run build" first.`);
  }
  if (await isPortListening(port, host)) {
    throw new Error(`Port ${port} is already in use by another process. Cannot start isolated E2E MCP server.`);
  }

  registerProcessExitHooks();

  const childEnv = {
    ...process.env,
    MAPILLARY_ACCESS_TOKEN: '',
    GOOGLE_MAPS_API_KEY: '',
    OPENAI_API_KEY: '',
    ANTHROPIC_API_KEY: '',
    GEOGUESSR_AGENT_ID: '',
    GEOGUESSR_AGENT_NAME: '',
    GEOGUESSR_AGENT_MODEL: '',
  };
  if (opts.env && typeof opts.env === 'object') {
    Object.assign(childEnv, opts.env);
  }

  const proc = spawn(
    process.execPath,
    [entry, '--transport', 'http', '--port', String(port), '--backend-url', backendUrl],
    {
      cwd: ROOT_DIR,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  trackedProcs.add(proc);

  const stdoutRing = attachRingBuffer(proc.stdout);
  const stderrRing = attachRingBuffer(proc.stderr);

  const earlyExit = new Promise((_, reject) => {
    proc.once('exit', (code, signal) => {
      reject(
        new Error(
          `Isolated MCP server exited early (code=${code}, signal=${signal}). Logs:\n${[...stdoutRing, ...stderrRing].join('\n')}`
        )
      );
    });
  });

  try {
    const health = await Promise.race([
      waitForHttpOk(`${mcpHttpUrl}/health`, opts.timeoutMs ?? 15000),
      earlyExit,
    ]);
    assert.equal(health?.status, 'ok', `Unexpected MCP health status: ${JSON.stringify(health)}`);
    assert.ok(
      Array.isArray(health.transports) &&
        health.transports.includes('streamable-http') &&
        health.transports.includes('sse'),
      `MCP /health missing expected transports: ${JSON.stringify(health.transports)}`
    );
    return {
      proc,
      port,
      mcpHttpUrl,
      stop: () => killSpawnedProcess(proc),
    };
  } catch (err) {
    await killSpawnedProcess(proc);
    throw err;
  }
}

export async function stopAllServers() {
  const cleanups = [...trackedCleanups];
  trackedCleanups.clear();
  await Promise.allSettled(
    cleanups.map((fn) => Promise.race([Promise.resolve().then(() => fn()), sleep(2000)]))
  );

  const procs = [...trackedProcs];
  await Promise.allSettled(procs.map((proc) => killSpawnedProcess(proc)));
}

export async function apiFetch(endpoint, opts = {}) {
  const baseUrl = opts.baseUrl ?? BASE_URL;
  const url = /^https?:\/\//i.test(endpoint)
    ? endpoint
    : `${baseUrl}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
  const method = opts.method ?? (opts.body !== undefined ? 'POST' : 'GET');
  const headers = { ...(opts.headers || {}) };
  let body = opts.body;

  if (body !== undefined && body !== null && typeof body === 'object' && !Buffer.isBuffer(body)) {
    body = JSON.stringify(body);
    if (!Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) {
      headers['Content-Type'] = 'application/json';
    }
  }

  const res = await fetch(url, {
    method,
    headers,
    body,
    signal: AbortSignal.timeout(opts.timeoutMs ?? 10000),
  });

  if (opts.raw) {
    const arrayBuf = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);
    return {
      status: res.status,
      ok: res.ok,
      headers: res.headers,
      buffer,
      text: '',
      data: null,
    };
  }

  const text = await res.text();
  let data = null;
  if (text.length > 0) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  return {
    status: res.status,
    ok: res.ok,
    headers: res.headers,
    text,
    data,
  };
}

export async function waitForWsMessage(wsOrHandle, predicate, timeoutMs = 5000, opts = {}) {
  const fromIndex = opts.fromIndex ?? 0;
  const isHandle = wsOrHandle && Array.isArray(wsOrHandle.messages) && wsOrHandle.ws;

  if (isHandle) {
    const { ws, messages } = wsOrHandle;
    for (let i = fromIndex; i < messages.length; i += 1) {
      if (predicate(messages[i], i)) return messages[i];
    }
    if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
      throw new Error('WebSocket is closed or closing before matching message arrived');
    }

    return new Promise((resolve, reject) => {
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        ws.off('message', onMsg);
        ws.off('close', onClose);
        const seenTypes = messages.slice(fromIndex).map((m) => m?.type || typeof m).join(', ');
        reject(new Error(`Timed out after ${timeoutMs}ms waiting for WS message. Observed types: [${seenTypes}]`));
      }, timeoutMs);

      const onMsg = (raw) => {
        let parsed;
        try {
          parsed = JSON.parse(String(raw));
        } catch {
          return;
        }
        if (predicate(parsed, messages.length - 1)) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          ws.off('message', onMsg);
          ws.off('close', onClose);
          resolve(parsed);
        }
      };

      const onClose = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        ws.off('message', onMsg);
        reject(new Error('WebSocket closed before matching message arrived'));
      };

      ws.on('message', onMsg);
      ws.once('close', onClose);
    });
  }

  // Raw WebSocket fallback
  const rawWs = wsOrHandle;
  if (rawWs.readyState === WebSocket.CLOSED || rawWs.readyState === WebSocket.CLOSING) {
    throw new Error('WebSocket is closed or closing before matching message arrived');
  }
  const seen = [];
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      rawWs.off('message', onMsg);
      rawWs.off('close', onClose);
      reject(new Error(`Timed out after ${timeoutMs}ms waiting for WS message. Observed types: [${seen.join(', ')}]`));
    }, timeoutMs);

    const onMsg = (raw) => {
      let parsed;
      try {
        parsed = JSON.parse(String(raw));
      } catch {
        return;
      }
      seen.push(parsed?.type || typeof parsed);
      if (predicate(parsed)) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        rawWs.off('message', onMsg);
        rawWs.off('close', onClose);
        resolve(parsed);
      }
    };

    const onClose = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      rawWs.off('message', onMsg);
      reject(new Error('WebSocket closed before matching message arrived'));
    };

    rawWs.on('message', onMsg);
    rawWs.once('close', onClose);
  });
}

export async function connectUiWs(opts = {}) {
  const url = new URL(opts.wsUrl ?? WS_URL);
  url.searchParams.set('role', opts.role ?? 'ui');
  if (opts.roomCode) url.searchParams.set('roomCode', opts.roomCode);
  if (opts.playerId) url.searchParams.set('playerId', opts.playerId);
  if (opts.playerName) url.searchParams.set('playerName', opts.playerName);
  if (opts.sessionToken) url.searchParams.set('sessionToken', opts.sessionToken);

  const ws = new WebSocket(url.toString());
  const messages = [];
  const errors = [];

  // Keep an error listener attached across connect, terminate()-on-timeout, and post-open lifetime
  // so socket errors never surface as unhandled Node EventEmitter 'error' throws.
  ws.on('error', (err) => {
    errors.push(err);
  });

  // Attach buffering listener synchronously BEFORE open resolves so initial state_sync is never missed.
  ws.on('message', (raw) => {
    try {
      messages.push(JSON.parse(String(raw)));
    } catch {
      // ignore non-JSON frames
    }
  });

  await new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      ws.off('open', onOpen);
      ws.off('error', onError);
    };
    const onOpen = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const onError = (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        ws.terminate();
      } catch {
        // ignore
      }
      reject(err);
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        ws.terminate();
      } catch {
        // ignore
      }
      reject(new Error(`Timed out connecting UI WS to ${url.toString()}`));
    }, opts.timeoutMs ?? 5000);

    ws.on('open', onOpen);
    ws.on('error', onError);
  });

  const close = async () => {
    trackedCleanups.delete(close);
    if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) return;
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        try {
          ws.terminate();
        } catch {
          // ignore
        }
        resolve();
      }, 1000);
      ws.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
      try {
        ws.close();
      } catch {
        clearTimeout(timer);
        resolve();
      }
    });
  };

  trackedCleanups.add(close);

  const handle = {
    ws,
    messages,
    errors,
    waitForMessage(predicate, timeoutMs = 5000, waitOpts = {}) {
      return waitForWsMessage(handle, predicate, timeoutMs, waitOpts);
    },
    close,
  };

  return handle;
}

function wrapMcpClient(client, transport, extra = {}) {
  const close = async () => {
    trackedCleanups.delete(close);
    try {
      if (typeof extra.onBeforeClose === 'function') {
        await extra.onBeforeClose();
      }
    } catch {
      // ignore
    }
    try {
      await Promise.race([client.close(), sleep(2000)]);
    } catch {
      // ignore
    }
    if (process.platform === 'win32' && extra.pid) {
      await new Promise((resolve) => {
        execFile('taskkill', ['/PID', String(extra.pid), '/T', '/F'], () => resolve());
      });
    }
  };

  trackedCleanups.add(close);

  const callToolRaw = async (name, args = {}) => {
    return client.callTool({ name, arguments: args });
  };

  const callToolJson = async (name, args = {}) => {
    const res = await callToolRaw(name, args);
    if (res.isError) {
      const txt = res.content?.find((c) => c.type === 'text')?.text || 'MCP tool returned isError=true';
      const err = new Error(scrubSecrets(txt));
      err.mcpResult = res;
      throw err;
    }
    return getTextContent(res);
  };

  return {
    client,
    transport,
    ...extra.fields,
    close,
    callToolRaw,
    callToolJson,
    listTools: () => client.listTools(),
    listResources: () => client.listResources(),
    readResource: (uri) => client.readResource({ uri }),
  };
}

export async function connectStdioMcp(opts = {}) {
  const entry = path.join(ROOT_DIR, 'mcp-server', 'dist', 'index.js');
  if (!fs.existsSync(entry)) {
    throw new Error(`MCP server build artifact missing at ${path.relative(ROOT_DIR, entry)}. Run "npm run build" first.`);
  }

  const args = [
    entry,
    '--transport',
    'stdio',
    '--backend-url',
    opts.backendUrl ?? BASE_URL,
    '--agent-name',
    opts.agentName ?? 'E2E-Stdio-Agent',
    '--model',
    opts.model ?? 'e2e-stdio-model',
  ];
  if (opts.agentId) {
    args.push('--agent-id', opts.agentId);
  }

  const cleanEnv = {
    ...process.env,
    GEOGUESSR_AGENT_ID: '',
    GEOGUESSR_AGENT_NAME: '',
    GEOGUESSR_AGENT_MODEL: '',
    MAPILLARY_ACCESS_TOKEN: '',
    GOOGLE_MAPS_API_KEY: '',
    OPENAI_API_KEY: '',
    ANTHROPIC_API_KEY: '',
  };

  const transport = new StdioClientTransport({
    command: process.execPath,
    args,
    cwd: ROOT_DIR,
    env: cleanEnv,
    stderr: 'pipe',
  });

  const client = new Client(
    { name: opts.clientName ?? 'e2e-stdio-client', version: '1.0.0' },
    { capabilities: {} }
  );

  try {
    await client.connect(transport);
  } catch (err) {
    const pid = transport.pid;
    await transport.close().catch(() => {});
    if (process.platform === 'win32' && pid) {
      await new Promise((resolve) => {
        execFile('taskkill', ['/PID', String(pid), '/T', '/F'], () => resolve());
      });
    }
    throw err;
  }
  return wrapMcpClient(client, transport, { pid: transport.pid });
}

export async function connectHttpMcp(opts = {}) {
  const url = new URL(`${opts.mcpHttpUrl ?? MCP_HTTP_URL}/mcp`);
  url.searchParams.set('agentName', opts.agentName ?? 'E2E-HTTP-Agent');
  url.searchParams.set('model', opts.model ?? 'e2e-http-model');
  if (opts.agentId) url.searchParams.set('agentId', opts.agentId);
  if (opts.roomCode) url.searchParams.set('roomCode', opts.roomCode);
  if (opts.query && typeof opts.query === 'object') {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }

  const transport = new StreamableHTTPClientTransport(url);
  const client = new Client(
    { name: opts.clientName ?? 'e2e-http-client', version: '1.0.0' },
    { capabilities: {} }
  );

  try {
    await client.connect(transport);
    assert.ok(transport.sessionId, 'Missing Mcp-Session-Id on StreamableHTTPClientTransport');
  } catch (err) {
    if (transport.sessionId) {
      await transport.terminateSession().catch(() => {});
    }
    await transport.close().catch(() => {});
    throw err;
  }

  return wrapMcpClient(client, transport, {
    fields: { sessionId: transport.sessionId },
    onBeforeClose: () => transport.terminateSession().catch(() => {}),
  });
}

export async function connectSseMcp(opts = {}) {
  const url = new URL(`${opts.mcpHttpUrl ?? MCP_HTTP_URL}/sse`);
  url.searchParams.set('agentName', opts.agentName ?? 'E2E-SSE-Agent');
  url.searchParams.set('model', opts.model ?? 'e2e-sse-model');
  if (opts.agentId) url.searchParams.set('agentId', opts.agentId);
  if (opts.roomCode) url.searchParams.set('roomCode', opts.roomCode);
  if (opts.query && typeof opts.query === 'object') {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }

  const transport = new SSEClientTransport(url);
  const client = new Client(
    { name: opts.clientName ?? 'e2e-sse-client', version: '1.0.0' },
    { capabilities: {} }
  );

  try {
    await client.connect(transport);
  } catch (err) {
    await transport.close().catch(() => {});
    throw err;
  }
  return wrapMcpClient(client, transport);
}
