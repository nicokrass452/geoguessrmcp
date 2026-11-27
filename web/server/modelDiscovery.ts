import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  AgyModelOption,
  CliProviderId,
  CliProviderStatus,
  ModelEffortLevel,
} from '@geoguessr-mcp/shared';

export interface CliExecutableSpec {
  provider: CliProviderId;
  command: string;
  prefixArgs: string[];
  displayPath: string;
}

export interface DiscoveredCliCatalog {
  executables: Record<CliProviderId, CliExecutableSpec | null>;
  providers: CliProviderStatus[];
  models: AgyModelOption[];
  discoveredAt: string;
}

export const ALL_EFFORT_LEVELS: readonly ModelEffortLevel[] = [
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
];

const EFFORT_RANK: Record<ModelEffortLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
  xhigh: 3,
  max: 4,
  ultra: 5,
};

const EFFORT_SUFFIX_RE = /-(low|medium|high|xhigh|max|ultra)$/i;
const LABEL_EFFORT_SUFFIX_RE = /\s*\((low|medium|high|xhigh|max|ultra)\)\s*$/i;

export function isEffortLevel(value: unknown): value is ModelEffortLevel {
  return (
    typeof value === 'string' &&
    (ALL_EFFORT_LEVELS as readonly string[]).includes(value.toLowerCase())
  );
}

export function sortEfforts(levels: Iterable<ModelEffortLevel>): ModelEffortLevel[] {
  const unique = new Set<ModelEffortLevel>();
  for (const l of levels) {
    const norm = l.toLowerCase() as ModelEffortLevel;
    if (norm in EFFORT_RANK) unique.add(norm);
  }
  return Array.from(unique).sort((a, b) => EFFORT_RANK[a] - EFFORT_RANK[b]);
}

export function detectModelFamily(rawId: string): AgyModelOption['family'] {
  const lower = rawId.toLowerCase();
  if (/claude|opus|sonnet|haiku|fable/.test(lower)) return 'claude';
  if (/gpt|codex|^o[134]/.test(lower)) return 'gpt';
  if (/gemini/.test(lower)) return 'gemini';
  return 'other';
}

export function deriveModelBadge(rawId: string, label?: string): string {
  const lower = rawId.toLowerCase();
  if (lower.includes('4-carbon')) return '4C';
  if (lower.includes('4-hydrogen')) return '4H';
  if (lower.includes('4-neon')) return '4N';
  if (lower.includes('4-argon')) return '4A';
  if (lower.includes('3.8-flash') || lower.includes('3-8-flash')) return '3.8';
  if (lower.includes('opus-5-5') || lower.includes('opus-5.5')) return 'O55';
  if (lower.includes('sonnet-5-5') || lower.includes('sonnet-5.5')) return 'S55';
  if (lower.includes('5.6-sol')) return '5.6S';
  if (lower.includes('5.6-terra')) return '5.6T';
  if (lower.includes('5.6-luna')) return '5.6L';
  if (lower.includes('5.4-mini')) return '5.4m';

  const gptVer = lower.match(/gpt-(\d+\.\d+)/);
  if (gptVer) return gptVer[1];
  if (lower.includes('120b')) return '120B';
  if (lower === 'opus') return 'Opus';
  if (lower === 'sonnet') return 'Son';
  if (lower === 'haiku') return 'Hai';
  if (lower === 'fable') return 'Fab';

  const source = (label || rawId).replace(/[^a-zA-Z0-9.\s-]/g, ' ').trim();
  const tokens = source.split(/[\s-]+/).filter(Boolean);
  if (tokens.length >= 2) {
    return (tokens[0][0] + tokens[1].slice(0, 2)).toUpperCase();
  }
  return source.slice(0, 4).toUpperCase() || 'AI';
}

function formatModelLabel(rawId: string): string {
  return rawId
    .split('-')
    .map((part) => {
      if (!part) return part;
      if (/^gpt$/i.test(part)) return 'GPT';
      if (/^\d+(\.\d+)?$/.test(part)) return part;
      return part[0].toUpperCase() + part.slice(1);
    })
    .join(' ');
}

function execCli(
  spec: CliExecutableSpec,
  args: string[],
  opts?: { timeoutMs?: number; env?: NodeJS.ProcessEnv }
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    execFile(
      spec.command,
      [...spec.prefixArgs, ...args],
      {
        encoding: 'utf8',
        windowsHide: true,
        timeout: opts?.timeoutMs ?? 12000,
        maxBuffer: 8 * 1024 * 1024,
        env: opts?.env ?? process.env,
      },
      (err, stdout, stderr) => {
        const code =
          err && typeof (err as { code?: unknown }).code === 'number'
            ? ((err as { code: number }).code ?? 1)
            : err
              ? 1
              : 0;
        resolve({
          stdout: typeof stdout === 'string' ? stdout : '',
          stderr: typeof stderr === 'string' ? stderr : '',
          code,
        });
      }
    );
  });
}

function resolveOnPath(candidates: string[]): string | null {
  const pathEnv = process.env.PATH || process.env.Path || '';
  const dirs = pathEnv.split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const name of candidates) {
      const full = path.join(dir, name);
      try {
        if (fs.existsSync(full) && fs.statSync(full).isFile()) {
          return full;
        }
      } catch {
        // ignore invalid path entry
      }
    }
  }
  return null;
}

function resolveCodexFromBinDir(binDir: string, displayPath: string): CliExecutableSpec | null {
  const npmNodeModules = path.join(binDir, 'node_modules', '@openai', 'codex');
  const vendorPairs: Array<[string, string, string]> = [
    ['codex-win32-x64', 'x86_64-pc-windows-msvc', 'codex.exe'],
    ['codex-win32-arm64', 'aarch64-pc-windows-msvc', 'codex.exe'],
    ['codex-linux-x64', 'x86_64-unknown-linux-musl', 'codex'],
    ['codex-darwin-arm64', 'aarch64-apple-darwin', 'codex'],
    ['codex-darwin-x64', 'x86_64-apple-darwin', 'codex'],
  ];

  for (const [pkg, triple, bin] of vendorPairs) {
    const exePath = path.join(npmNodeModules, 'node_modules', '@openai', pkg, 'vendor', triple, 'bin', bin);
    if (fs.existsSync(exePath)) {
      return {
        provider: 'codex',
        command: exePath,
        prefixArgs: [],
        displayPath,
      };
    }
  }

  const jsEntry = path.join(npmNodeModules, 'bin', 'codex.js');
  if (fs.existsSync(jsEntry)) {
    return {
      provider: 'codex',
      command: process.execPath,
      prefixArgs: [jsEntry],
      displayPath,
    };
  }
  return null;
}

export function findCliBinaries(): Record<CliProviderId, CliExecutableSpec | null> {
  const home = os.homedir();
  const isWin = process.platform === 'win32';

  // 1. AGY
  let agySpec: CliExecutableSpec | null = null;
  const agyCandidates = [
    process.env.AGY_BIN?.trim(),
    process.env.AGY_PATH?.trim(),
    isWin ? path.join(home, 'AppData', 'Local', 'agy', 'bin', 'agy.exe') : null,
    isWin ? null : path.join(home, '.local', 'bin', 'agy'),
    resolveOnPath(isWin ? ['agy.exe', 'agy.cmd', 'agy'] : ['agy']),
  ].filter(Boolean) as string[];

  for (const c of agyCandidates) {
    if (fs.existsSync(c)) {
      agySpec = {
        provider: 'agy',
        command: c,
        prefixArgs: [],
        displayPath: c,
      };
      break;
    }
  }

  // 2. Codex (prefer native binary or node+codex.js over .cmd/.ps1 shim)
  let codexSpec: CliExecutableSpec | null = null;
  const explicitCodex = process.env.CODEX_BIN?.trim() || process.env.CODEX_PATH?.trim();
  if (explicitCodex && fs.existsSync(explicitCodex)) {
    if (explicitCodex.endsWith('.js') || explicitCodex.endsWith('.mjs')) {
      codexSpec = {
        provider: 'codex',
        command: process.execPath,
        prefixArgs: [explicitCodex],
        displayPath: explicitCodex,
      };
    } else if (!/\.(cmd|ps1|bat)$/i.test(explicitCodex)) {
      codexSpec = {
        provider: 'codex',
        command: explicitCodex,
        prefixArgs: [],
        displayPath: explicitCodex,
      };
    } else {
      codexSpec = resolveCodexFromBinDir(path.dirname(explicitCodex), explicitCodex);
    }
  }

  if (!codexSpec) {
    const pathCodex = resolveOnPath(
      isWin ? ['codex.exe', 'codex.cmd', 'codex'] : ['codex']
    );
    const npmDir = path.join(home, 'AppData', 'Roaming', 'npm');
    const searchDirs = [
      pathCodex ? path.dirname(pathCodex) : null,
      isWin ? npmDir : null,
    ].filter(Boolean) as string[];

    if (pathCodex && !/\.(cmd|ps1|bat)$/i.test(pathCodex)) {
      codexSpec = {
        provider: 'codex',
        command: pathCodex,
        prefixArgs: [],
        displayPath: pathCodex,
      };
    }
    for (const dir of searchDirs) {
      if (codexSpec) break;
      const shimDisplay =
        pathCodex || (isWin ? path.join(dir, 'codex.cmd') : path.join(dir, 'codex'));
      codexSpec = resolveCodexFromBinDir(dir, fs.existsSync(shimDisplay) ? shimDisplay : dir);
    }
  }

  // 3. Claude Code
  let claudeSpec: CliExecutableSpec | null = null;
  const claudeCandidates = [
    process.env.CLAUDE_BIN?.trim(),
    process.env.CLAUDE_PATH?.trim(),
    isWin ? path.join(home, '.local', 'bin', 'claude.exe') : null,
    isWin ? null : path.join(home, '.local', 'bin', 'claude'),
    resolveOnPath(isWin ? ['claude.exe', 'claude.cmd', 'claude'] : ['claude']),
  ].filter(Boolean) as string[];

  for (const c of claudeCandidates) {
    if (fs.existsSync(c)) {
      claudeSpec = {
        provider: 'claude',
        command: c,
        prefixArgs: [],
        displayPath: c,
      };
      break;
    }
  }

  return {
    agy: agySpec,
    codex: codexSpec,
    claude: claudeSpec,
  };
}

function chooseDefaultEffort(
  efforts: ModelEffortLevel[],
  preferred?: string
): ModelEffortLevel {
  if (preferred && isEffortLevel(preferred)) {
    const norm = preferred.toLowerCase() as ModelEffortLevel;
    if (efforts.includes(norm)) return norm;
  }
  if (efforts.includes('medium')) return 'medium';
  if (efforts.includes('high')) return 'high';
  return efforts[0] ?? 'medium';
}

async function discoverAgy(
  spec: CliExecutableSpec | null
): Promise<{ status: CliProviderStatus; models: AgyModelOption[] }> {
  if (!spec) {
    return {
      status: {
        provider: 'agy',
        label: 'Antigravity (agy)',
        available: false,
        path: null,
        version: null,
        modelCount: 0,
      },
      models: [],
    };
  }

  const [verRes, modelsRes] = await Promise.all([
    execCli(spec, ['--version'], { timeoutMs: 5000 }),
    execCli(spec, ['models'], { timeoutMs: 12000 }),
  ]);

  const version =
    verRes.stdout.trim().split(/\r?\n/)[0]?.trim() || null;

  if (modelsRes.code !== 0 && !modelsRes.stdout.trim()) {
    return {
      status: {
        provider: 'agy',
        label: 'Antigravity (agy)',
        available: true,
        path: spec.displayPath,
        version,
        modelCount: 0,
        error: modelsRes.stderr.trim() || 'agy models returned no output',
      },
      models: [],
    };
  }

  const grouped = new Map<
    string,
    {
      baseId: string;
      baseLabel: string;
      efforts: Set<ModelEffortLevel>;
      variants: Partial<Record<ModelEffortLevel, string>>;
    }
  >();

  for (const rawLine of modelsRes.stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^[-=]+$/.test(line)) continue;
    const parts = line.includes('\t')
      ? line.split('\t').map((s) => s.trim())
      : line.split(/\s{2,}/).map((s) => s.trim());
    const rawId = parts[0];
    if (!rawId || rawId.includes(' ') || /^id$/i.test(rawId) || /^model$/i.test(rawId)) {
      continue;
    }
    if (/orchestrator/i.test(rawId)) continue;

    const rawLabel = parts[1] || formatModelLabel(rawId);
    const suffixMatch = rawId.match(EFFORT_SUFFIX_RE);
    const effort: ModelEffortLevel = suffixMatch
      ? (suffixMatch[1].toLowerCase() as ModelEffortLevel)
      : 'medium';
    const baseId = rawId.replace(EFFORT_SUFFIX_RE, '');
    const baseLabel =
      rawLabel.replace(LABEL_EFFORT_SUFFIX_RE, '').trim() ||
      formatModelLabel(baseId);

    let entry = grouped.get(baseId);
    if (!entry) {
      entry = {
        baseId,
        baseLabel,
        efforts: new Set<ModelEffortLevel>(),
        variants: {},
      };
      grouped.set(baseId, entry);
    }
    entry.efforts.add(effort);
    entry.variants[effort] = rawId;
  }

  const models: AgyModelOption[] = [];
  for (const g of grouped.values()) {
    const supportedEfforts = sortEfforts(g.efforts);
    const defaultEffort = chooseDefaultEffort(supportedEfforts);
    models.push({
      id: `agy:${g.baseId}`,
      label: g.baseLabel,
      family: detectModelFamily(g.baseId),
      provider: 'agy',
      cliModel: g.baseId,
      supportedEfforts,
      defaultEffort,
      effortVariantIds: g.variants,
      badge: deriveModelBadge(g.baseId, g.baseLabel),
    });
  }

  return {
    status: {
      provider: 'agy',
      label: 'Antigravity (agy)',
      available: true,
      path: spec.displayPath,
      version,
      modelCount: models.length,
    },
    models,
  };
}

interface CodexModelJsonEntry {
  slug?: string;
  display_name?: string;
  description?: string;
  visibility?: string;
  default_reasoning_level?: string;
  supported_reasoning_levels?: Array<string | { effort?: string }>;
}

function parseCodexModelsJson(stdout: string): CodexModelJsonEntry[] | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1)) as {
      models?: CodexModelJsonEntry[];
    };
    return Array.isArray(parsed.models) ? parsed.models : null;
  } catch {
    return null;
  }
}

async function discoverCodex(
  spec: CliExecutableSpec | null
): Promise<{ status: CliProviderStatus; models: AgyModelOption[] }> {
  if (!spec) {
    return {
      status: {
        provider: 'codex',
        label: 'Codex CLI',
        available: false,
        path: null,
        version: null,
        modelCount: 0,
      },
      models: [],
    };
  }

  const verRes = await execCli(spec, ['--version'], { timeoutMs: 5000 });
  const version = verRes.stdout.trim().split(/\r?\n/)[0]?.trim() || null;

  let rawModels: CodexModelJsonEntry[] | null = null;
  const directRes = await execCli(spec, ['debug', 'models'], { timeoutMs: 10000 });
  if (directRes.code === 0) {
    rawModels = parseCodexModelsJson(directRes.stdout);
  }

  let lastErr: string | undefined;
  if (!rawModels || rawModels.length === 0) {
    const tmpCodexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'geoarena-codex-'));
    try {
      const bundledRes = await execCli(spec, ['debug', 'models', '--bundled'], {
        timeoutMs: 12000,
        env: { ...process.env, CODEX_HOME: tmpCodexHome },
      });
      if (bundledRes.code === 0) {
        rawModels = parseCodexModelsJson(bundledRes.stdout);
      } else {
        lastErr = bundledRes.stderr.trim() || directRes.stderr.trim() || undefined;
      }
    } finally {
      try {
        fs.rmSync(tmpCodexHome, { recursive: true, force: true });
      } catch {
        // ignore cleanup error
      }
    }
  }

  if (!rawModels) {
    return {
      status: {
        provider: 'codex',
        label: 'Codex CLI',
        available: true,
        path: spec.displayPath,
        version,
        modelCount: 0,
        error: lastErr || 'Could not parse codex debug models output',
      },
      models: [],
    };
  }

  const models: AgyModelOption[] = [];
  for (const item of rawModels) {
    if (!item.slug || item.visibility === 'hide') continue;
    const slug = item.slug.trim();
    const label = item.display_name?.trim() || formatModelLabel(slug);
    const extractedEfforts: ModelEffortLevel[] = [];
    for (const lvl of item.supported_reasoning_levels ?? []) {
      const candidate = typeof lvl === 'string' ? lvl : lvl?.effort;
      if (candidate && isEffortLevel(candidate)) {
        extractedEfforts.push(candidate.toLowerCase() as ModelEffortLevel);
      }
    }
    const supportedEfforts =
      extractedEfforts.length > 0
        ? sortEfforts(extractedEfforts)
        : (['low', 'medium', 'high'] as ModelEffortLevel[]);
    const defaultEffort = chooseDefaultEffort(
      supportedEfforts,
      item.default_reasoning_level
    );

    models.push({
      id: `codex:${slug}`,
      label,
      family: detectModelFamily(slug),
      provider: 'codex',
      cliModel: slug,
      supportedEfforts,
      defaultEffort,
      badge: deriveModelBadge(slug, label),
      description: item.description?.trim() || undefined,
    });
  }

  return {
    status: {
      provider: 'codex',
      label: 'Codex CLI',
      available: true,
      path: spec.displayPath,
      version,
      modelCount: models.length,
    },
    models,
  };
}

function extractOptionBlock(helpText: string, flagPrefix: string): string {
  const lines = helpText.split(/\r?\n/);
  const startIdx = lines.findIndex((line) => line.includes(flagPrefix));
  if (startIdx === -1) return '';
  const collected = [lines[startIdx]];
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s{0,4}-/.test(line)) break;
    collected.push(line);
  }
  return collected.join(' ');
}

async function discoverClaude(
  spec: CliExecutableSpec | null
): Promise<{ status: CliProviderStatus; models: AgyModelOption[] }> {
  if (!spec) {
    return {
      status: {
        provider: 'claude',
        label: 'Claude Code CLI',
        available: false,
        path: null,
        version: null,
        modelCount: 0,
      },
      models: [],
    };
  }

  const [verRes, helpRes] = await Promise.all([
    execCli(spec, ['--version'], { timeoutMs: 5000 }),
    execCli(spec, ['--help'], { timeoutMs: 8000 }),
  ]);

  const version = verRes.stdout.trim().split(/\r?\n/)[0]?.trim() || null;
  const helpText = helpRes.stdout || helpRes.stderr || '';

  if (!helpText.trim()) {
    return {
      status: {
        provider: 'claude',
        label: 'Claude Code CLI',
        available: true,
        path: spec.displayPath,
        version,
        modelCount: 0,
        error: 'claude --help produced no output',
      },
      models: [],
    };
  }

  // Parse supported effort levels from --effort option block
  const effortBlock = extractOptionBlock(helpText, '--effort');
  const foundEfforts: ModelEffortLevel[] = [];
  for (const level of ALL_EFFORT_LEVELS) {
    if (new RegExp(`\\b${level}\\b`, 'i').test(effortBlock)) {
      foundEfforts.push(level);
    }
  }
  const supportedEfforts =
    foundEfforts.length > 0
      ? sortEfforts(foundEfforts)
      : (['low', 'medium', 'high', 'xhigh', 'max'] as ModelEffortLevel[]);

  // Parse model aliases documented in --model block (never touching auth files)
  const modelBlock = extractOptionBlock(helpText, '--model');
  const aliasSet = new Set<string>();
  const quotedRe = /['"`]([a-z0-9._-]+)['"`]/gi;
  let m: RegExpExecArray | null;
  while ((m = quotedRe.exec(modelBlock)) !== null) {
    const token = m[1].toLowerCase();
    if (token !== 'latest' && token !== 'model' && token !== 'claude-sonnet-4-6') {
      aliasSet.add(token);
    }
  }
  // Ensure core standard Claude Code aliases if documented section mentions sonnet/opus
  if (aliasSet.size === 0 || aliasSet.has('sonnet') || aliasSet.has('opus')) {
    for (const std of ['sonnet', 'opus', 'haiku']) {
      aliasSet.add(std);
    }
  }

  const aliasDisplay: Record<string, string> = {
    sonnet: 'Claude Sonnet',
    opus: 'Claude Opus',
    haiku: 'Claude Haiku',
    fable: 'Claude Fable',
  };

  const models: AgyModelOption[] = Array.from(aliasSet).map((alias) => {
    const label =
      aliasDisplay[alias] ||
      (/^claude/i.test(alias)
        ? formatModelLabel(alias)
        : `Claude ${formatModelLabel(alias)}`);
    return {
      id: `claude:${alias}`,
      label,
      family: 'claude',
      provider: 'claude',
      cliModel: alias,
      supportedEfforts,
      defaultEffort: chooseDefaultEffort(supportedEfforts),
      badge: deriveModelBadge(alias, label),
      description: `Claude Code CLI (--model ${alias})`,
    };
  });

  return {
    status: {
      provider: 'claude',
      label: 'Claude Code CLI',
      available: true,
      path: spec.displayPath,
      version,
      modelCount: models.length,
    },
    models,
  };
}

export function getCuratedFallbackModels(): AgyModelOption[] {
  return [
    {
      id: 'agy:gemini-4-hydrogen',
      label: 'Gemini 4 Hydrogen',
      family: 'gemini',
      provider: 'agy',
      cliModel: 'gemini-4-hydrogen',
      supportedEfforts: ['low', 'medium', 'high', 'xhigh'],
      defaultEffort: 'medium',
      effortVariantIds: {
        low: 'gemini-4-hydrogen-low',
        medium: 'gemini-4-hydrogen-medium',
        high: 'gemini-4-hydrogen-high',
        xhigh: 'gemini-4-hydrogen-xhigh',
      },
      badge: '4H',
    },
    {
      id: 'agy:claude-sonnet-5-5',
      label: 'Claude Sonnet 5.5',
      family: 'claude',
      provider: 'agy',
      cliModel: 'claude-sonnet-5-5',
      supportedEfforts: ['low', 'medium', 'high'],
      defaultEffort: 'medium',
      effortVariantIds: {
        low: 'claude-sonnet-5-5-low',
        medium: 'claude-sonnet-5-5-medium',
        high: 'claude-sonnet-5-5-high',
      },
      badge: 'S55',
    },
    {
      id: 'agy:gemini-4-carbon',
      label: 'Gemini 4 Carbon',
      family: 'gemini',
      provider: 'agy',
      cliModel: 'gemini-4-carbon',
      supportedEfforts: ['low', 'medium', 'high'],
      defaultEffort: 'high',
      effortVariantIds: {
        low: 'gemini-4-carbon-low',
        medium: 'gemini-4-carbon-medium',
        high: 'gemini-4-carbon-high',
      },
      badge: '4C',
    },
    {
      id: 'agy:gemini-4-neon',
      label: 'Gemini 4 Neon',
      family: 'gemini',
      provider: 'agy',
      cliModel: 'gemini-4-neon',
      supportedEfforts: ['low', 'medium', 'high', 'xhigh'],
      defaultEffort: 'high',
      effortVariantIds: {
        low: 'gemini-4-neon-low',
        medium: 'gemini-4-neon-medium',
        high: 'gemini-4-neon-high',
        xhigh: 'gemini-4-neon-xhigh',
      },
      badge: '4N',
    },
    {
      id: 'agy:claude-opus-5-5',
      label: 'Claude Opus 5.5',
      family: 'claude',
      provider: 'agy',
      cliModel: 'claude-opus-5-5',
      supportedEfforts: ['low', 'medium', 'high'],
      defaultEffort: 'high',
      effortVariantIds: {
        low: 'claude-opus-5-5-low',
        medium: 'claude-opus-5-5-medium',
        high: 'claude-opus-5-5-high',
      },
      badge: 'O55',
    },
  ];
}

export async function discoverCliModels(): Promise<DiscoveredCliCatalog> {
  const executables = findCliBinaries();
  const [agyRes, codexRes, claudeRes] = await Promise.all([
    discoverAgy(executables.agy),
    discoverCodex(executables.codex),
    discoverClaude(executables.claude),
  ]);

  const providers = [agyRes.status, codexRes.status, claudeRes.status];
  const models = [...agyRes.models, ...codexRes.models, ...claudeRes.models];

  return {
    executables,
    providers,
    models,
    discoveredAt: new Date().toISOString(),
  };
}
