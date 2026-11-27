#!/usr/bin/env node
/**
 * Standalone CLI model & effort discovery utility for GeoArena.
 * Inspects locally installed AI CLIs (`agy`, `codex`, `claude`) strictly as
 * metadata data sources (never runs billable inference or reads user secrets).
 *
 * Usage:
 *   node scripts/discover-models.mjs
 *   node scripts/discover-models.mjs --json
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ALL_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
const EFFORT_RANK = Object.fromEntries(ALL_EFFORTS.map((e, i) => [e, i]));
const EFFORT_SUFFIX_RE = /-(low|medium|high|xhigh|max|ultra)$/i;
const LABEL_EFFORT_SUFFIX_RE = /\s*\((low|medium|high|xhigh|max|ultra)\)\s*$/i;

function isEffort(val) {
  return typeof val === 'string' && val.toLowerCase() in EFFORT_RANK;
}

function sortEfforts(levels) {
  const uniq = new Set();
  for (const l of levels) {
    const norm = String(l).toLowerCase();
    if (norm in EFFORT_RANK) uniq.add(norm);
  }
  return Array.from(uniq).sort((a, b) => EFFORT_RANK[a] - EFFORT_RANK[b]);
}

function chooseDefaultEffort(efforts, preferred) {
  if (preferred && isEffort(preferred)) {
    const norm = preferred.toLowerCase();
    if (efforts.includes(norm)) return norm;
  }
  if (efforts.includes('medium')) return 'medium';
  if (efforts.includes('high')) return 'high';
  return efforts[0] || 'medium';
}

function detectFamily(rawId) {
  const lower = rawId.toLowerCase();
  if (/claude|opus|sonnet|haiku|fable/.test(lower)) return 'claude';
  if (/gpt|codex|^o[134]/.test(lower)) return 'gpt';
  if (/gemini/.test(lower)) return 'gemini';
  return 'other';
}

function formatLabel(rawId) {
  return rawId
    .split('-')
    .map((p) => {
      if (!p) return p;
      if (/^gpt$/i.test(p)) return 'GPT';
      if (/^\d+(\.\d+)?$/.test(p)) return p;
      return p[0].toUpperCase() + p.slice(1);
    })
    .join(' ');
}

function resolveOnPath(candidates) {
  const pathEnv = process.env.PATH || process.env.Path || '';
  for (const dir of pathEnv.split(path.delimiter).filter(Boolean)) {
    for (const name of candidates) {
      const full = path.join(dir, name);
      try {
        if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
      } catch {
        // ignore invalid PATH entry
      }
    }
  }
  return null;
}

function resolveCodexFromBinDir(binDir, displayPath) {
  const npmRoot = path.join(binDir, 'node_modules', '@openai', 'codex');
  const pairs = [
    ['codex-win32-x64', 'x86_64-pc-windows-msvc', 'codex.exe'],
    ['codex-win32-arm64', 'aarch64-pc-windows-msvc', 'codex.exe'],
    ['codex-linux-x64', 'x86_64-unknown-linux-musl', 'codex'],
    ['codex-darwin-arm64', 'aarch64-apple-darwin', 'codex'],
    ['codex-darwin-x64', 'x86_64-apple-darwin', 'codex'],
  ];
  for (const [pkg, triple, bin] of pairs) {
    const exePath = path.join(npmRoot, 'node_modules', '@openai', pkg, 'vendor', triple, 'bin', bin);
    if (fs.existsSync(exePath)) {
      return { command: exePath, prefixArgs: [], displayPath };
    }
  }
  const jsEntry = path.join(npmRoot, 'bin', 'codex.js');
  if (fs.existsSync(jsEntry)) {
    return { command: process.execPath, prefixArgs: [jsEntry], displayPath };
  }
  return null;
}

function findBinaries() {
  const home = os.homedir();
  const isWin = process.platform === 'win32';

  let agy = null;
  for (const c of [
    process.env.AGY_BIN?.trim(),
    process.env.AGY_PATH?.trim(),
    isWin ? path.join(home, 'AppData', 'Local', 'agy', 'bin', 'agy.exe') : path.join(home, '.local', 'bin', 'agy'),
    resolveOnPath(isWin ? ['agy.exe', 'agy.cmd', 'agy'] : ['agy']),
  ].filter(Boolean)) {
    if (fs.existsSync(c)) {
      agy = { command: c, prefixArgs: [], displayPath: c };
      break;
    }
  }

  let codex = null;
  const pathCodex = resolveOnPath(isWin ? ['codex.exe', 'codex.cmd', 'codex'] : ['codex']);
  if (pathCodex && !/\.(cmd|ps1|bat)$/i.test(pathCodex)) {
    codex = { command: pathCodex, prefixArgs: [], displayPath: pathCodex };
  } else {
    const npmDir = path.join(home, 'AppData', 'Roaming', 'npm');
    for (const dir of [pathCodex ? path.dirname(pathCodex) : null, isWin ? npmDir : null].filter(Boolean)) {
      const display = pathCodex || path.join(dir, isWin ? 'codex.cmd' : 'codex');
      codex = resolveCodexFromBinDir(dir, fs.existsSync(display) ? display : dir);
      if (codex) break;
    }
  }

  let claude = null;
  for (const c of [
    process.env.CLAUDE_BIN?.trim(),
    process.env.CLAUDE_PATH?.trim(),
    isWin ? path.join(home, '.local', 'bin', 'claude.exe') : path.join(home, '.local', 'bin', 'claude'),
    resolveOnPath(isWin ? ['claude.exe', 'claude.cmd', 'claude'] : ['claude']),
  ].filter(Boolean)) {
    if (fs.existsSync(c)) {
      claude = { command: c, prefixArgs: [], displayPath: c };
      break;
    }
  }

  return { agy, codex, claude };
}

function execCli(spec, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(
      spec.command,
      [...spec.prefixArgs, ...args],
      {
        encoding: 'utf8',
        windowsHide: true,
        timeout: opts.timeoutMs ?? 12000,
        maxBuffer: 8 * 1024 * 1024,
        env: opts.env ?? process.env,
      },
      (err, stdout, stderr) => {
        resolve({
          stdout: typeof stdout === 'string' ? stdout : '',
          stderr: typeof stderr === 'string' ? stderr : '',
          code: err ? 1 : 0,
        });
      }
    );
  });
}

async function discoverAgy(spec) {
  if (!spec) return { status: { provider: 'agy', label: 'Antigravity (agy)', available: false, path: null, version: null, modelCount: 0 }, models: [] };
  const [verRes, modRes] = await Promise.all([
    execCli(spec, ['--version'], { timeoutMs: 5000 }),
    execCli(spec, ['models'], { timeoutMs: 12000 }),
  ]);
  const version = verRes.stdout.trim().split(/\r?\n/)[0]?.trim() || null;
  const grouped = new Map();
  for (const rawLine of modRes.stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^[-=]+$/.test(line)) continue;
    const parts = line.includes('\t') ? line.split('\t').map((s) => s.trim()) : line.split(/\s{2,}/).map((s) => s.trim());
    const rawId = parts[0];
    if (!rawId || rawId.includes(' ') || /^id$/i.test(rawId) || /^model$/i.test(rawId)) continue;
    if (/orchestrator/i.test(rawId)) continue;
    const m = rawId.match(EFFORT_SUFFIX_RE);
    const effort = m ? m[1].toLowerCase() : 'medium';
    const baseId = rawId.replace(EFFORT_SUFFIX_RE, '');
    const baseLabel = (parts[1] || formatLabel(rawId)).replace(LABEL_EFFORT_SUFFIX_RE, '').trim();
    if (!grouped.has(baseId)) grouped.set(baseId, { baseId, baseLabel, efforts: new Set(), variants: {} });
    const entry = grouped.get(baseId);
    entry.efforts.add(effort);
    entry.variants[effort] = rawId;
  }
  const models = Array.from(grouped.values()).map((g) => {
    const supportedEfforts = sortEfforts(g.efforts);
    return {
      id: `agy:${g.baseId}`,
      label: g.baseLabel,
      family: detectFamily(g.baseId),
      provider: 'agy',
      cliModel: g.baseId,
      supportedEfforts,
      defaultEffort: chooseDefaultEffort(supportedEfforts),
      effortVariantIds: g.variants,
    };
  });
  return {
    status: { provider: 'agy', label: 'Antigravity (agy)', available: true, path: spec.displayPath, version, modelCount: models.length },
    models,
  };
}

function parseCodexJson(stdout) {
  const s = stdout.indexOf('{');
  const e = stdout.lastIndexOf('}');
  if (s === -1 || e <= s) return null;
  try {
    const parsed = JSON.parse(stdout.slice(s, e + 1));
    return Array.isArray(parsed.models) ? parsed.models : null;
  } catch {
    return null;
  }
}

async function discoverCodex(spec) {
  if (!spec) return { status: { provider: 'codex', label: 'Codex CLI', available: false, path: null, version: null, modelCount: 0 }, models: [] };
  const verRes = await execCli(spec, ['--version'], { timeoutMs: 5000 });
  const version = verRes.stdout.trim().split(/\r?\n/)[0]?.trim() || null;
  let rawModels = null;
  const direct = await execCli(spec, ['debug', 'models'], { timeoutMs: 10000 });
  if (direct.code === 0) rawModels = parseCodexJson(direct.stdout);
  if (!rawModels || rawModels.length === 0) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geoarena-codex-'));
    try {
      const bundled = await execCli(spec, ['debug', 'models', '--bundled'], {
        timeoutMs: 12000,
        env: { ...process.env, CODEX_HOME: tmpDir },
      });
      if (bundled.code === 0) rawModels = parseCodexJson(bundled.stdout);
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  }
  const models = (rawModels || [])
    .filter((m) => m.slug && m.visibility !== 'hide')
    .map((m) => {
      const extracted = [];
      for (const l of m.supported_reasoning_levels || []) {
        const val = typeof l === 'string' ? l : l?.effort;
        if (val && isEffort(val)) extracted.push(val.toLowerCase());
      }
      const supportedEfforts = extracted.length > 0 ? sortEfforts(extracted) : ['low', 'medium', 'high'];
      return {
        id: `codex:${m.slug}`,
        label: m.display_name || formatLabel(m.slug),
        family: detectFamily(m.slug),
        provider: 'codex',
        cliModel: m.slug,
        supportedEfforts,
        defaultEffort: chooseDefaultEffort(supportedEfforts, m.default_reasoning_level),
      };
    });
  return {
    status: { provider: 'codex', label: 'Codex CLI', available: true, path: spec.displayPath, version, modelCount: models.length },
    models,
  };
}

function extractOptionBlock(helpText, flagPrefix) {
  const lines = helpText.split(/\r?\n/);
  const idx = lines.findIndex((l) => l.includes(flagPrefix));
  if (idx === -1) return '';
  const out = [lines[idx]];
  for (let i = idx + 1; i < lines.length; i++) {
    if (/^\s{0,4}-/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out.join(' ');
}

async function discoverClaude(spec) {
  if (!spec) return { status: { provider: 'claude', label: 'Claude Code CLI', available: false, path: null, version: null, modelCount: 0 }, models: [] };
  const [verRes, helpRes] = await Promise.all([
    execCli(spec, ['--version'], { timeoutMs: 5000 }),
    execCli(spec, ['--help'], { timeoutMs: 8000 }),
  ]);
  const version = verRes.stdout.trim().split(/\r?\n/)[0]?.trim() || null;
  const helpText = helpRes.stdout || helpRes.stderr || '';
  const effortBlock = extractOptionBlock(helpText, '--effort');
  const foundEfforts = ALL_EFFORTS.filter((l) => new RegExp(`\\b${l}\\b`, 'i').test(effortBlock));
  const supportedEfforts = foundEfforts.length > 0 ? sortEfforts(foundEfforts) : ['low', 'medium', 'high', 'xhigh', 'max'];

  const modelBlock = extractOptionBlock(helpText, '--model');
  const aliases = new Set();
  const re = /['"`]([a-z0-9._-]+)['"`]/gi;
  let m;
  while ((m = re.exec(modelBlock)) !== null) {
    const tok = m[1].toLowerCase();
    if (tok !== 'latest' && tok !== 'model' && tok !== 'claude-sonnet-4-6') aliases.add(tok);
  }
  if (aliases.size === 0 || aliases.has('sonnet') || aliases.has('opus')) {
    for (const s of ['sonnet', 'opus', 'haiku']) aliases.add(s);
  }
  const names = { sonnet: 'Claude Sonnet', opus: 'Claude Opus', haiku: 'Claude Haiku', fable: 'Claude Fable' };
  const models = Array.from(aliases).map((alias) => ({
    id: `claude:${alias}`,
    label:
      names[alias] ||
      (/^claude/i.test(alias)
        ? formatLabel(alias)
        : `Claude ${formatLabel(alias)}`),
    family: 'claude',
    provider: 'claude',
    cliModel: alias,
    supportedEfforts,
    defaultEffort: chooseDefaultEffort(supportedEfforts),
  }));
  return {
    status: { provider: 'claude', label: 'Claude Code CLI', available: true, path: spec.displayPath, version, modelCount: models.length },
    models,
  };
}

const bins = findBinaries();
const [agyRes, codexRes, claudeRes] = await Promise.all([
  discoverAgy(bins.agy),
  discoverCodex(bins.codex),
  discoverClaude(bins.claude),
]);

const catalog = {
  discoveredAt: new Date().toISOString(),
  providers: [agyRes.status, codexRes.status, claudeRes.status],
  models: [...agyRes.models, ...codexRes.models, ...claudeRes.models],
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(catalog, null, 2));
} else {
  console.log('\n=== GeoArena CLI Model Discovery ===\n');
  for (const p of catalog.providers) {
    const state = p.available ? 'READY' : 'MISSING';
    console.log(`[${state}] ${p.label} ${p.version || ''} -> ${p.modelCount} model(s)`);
    if (p.path) console.log(`        path: ${p.path}`);
  }
  console.log(`\nDiscovered ${catalog.models.length} model(s):\n`);
  for (const m of catalog.models) {
    console.log(
      `  ${m.id.padEnd(28)} ${m.label.padEnd(24)} [${m.provider}] efforts: ${m.supportedEfforts.join(', ')} (default: ${m.defaultEffort})`
    );
  }
  console.log('');
}
