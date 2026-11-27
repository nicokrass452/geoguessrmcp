import type {
  AgyModelOption,
  CliProviderId,
  LocationMode,
  ModelEffortLevel,
} from '@geoguessr-mcp/shared';

export const EFFORT_LABELS: Record<ModelEffortLevel, string> = {
  low: 'Low',
  medium: 'Med',
  high: 'High',
  xhigh: 'XHigh',
  max: 'Max',
  ultra: 'Ultra',
};

export const PROVIDER_META: Record<
  CliProviderId,
  { label: string; shortLabel: string; color: string }
> = {
  agy: { label: 'Antigravity (agy)', shortLabel: 'AGY', color: '#22c55e' },
  codex: { label: 'Codex CLI', shortLabel: 'Codex', color: '#2dd4bf' },
  claude: { label: 'Claude Code CLI', shortLabel: 'Claude', color: '#f59e0b' },
};

export const FALLBACK_AGY_MODELS: AgyModelOption[] = [
  {
    id: 'agy:gemini-4-hydrogen',
    label: 'Gemini 4 Hydrogen',
    family: 'gemini',
    provider: 'agy',
    cliModel: 'gemini-4-hydrogen',
    supportedEfforts: ['low', 'medium', 'high', 'xhigh'],
    defaultEffort: 'medium',
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
    badge: 'O55',
  },
];

export interface ModelUiMeta {
  badge: string;
  color: string;
  shortName: string;
  tierLabel: string;
  providerShort: string;
}

const MODEL_META_BY_ID: Record<string, ModelUiMeta> = {
  'gemini-4-hydrogen-medium': {
    badge: '4H',
    color: '#818cf8',
    shortName: 'Gemini Hydrogen',
    tierLabel: 'Fast · casual',
    providerShort: 'AGY',
  },
  'agy:gemini-4-hydrogen': {
    badge: '4H',
    color: '#818cf8',
    shortName: 'Gemini 4 Hydrogen',
    tierLabel: 'AGY · Fast',
    providerShort: 'AGY',
  },
  'claude-sonnet-5-5-medium': {
    badge: 'S55',
    color: '#f59e0b',
    shortName: 'Claude Sonnet 5.5',
    tierLabel: 'AGY · Balanced',
    providerShort: 'AGY',
  },
  'agy:claude-sonnet-5-5': {
    badge: 'S55',
    color: '#f59e0b',
    shortName: 'Claude Sonnet 5.5',
    tierLabel: 'AGY · Balanced',
    providerShort: 'AGY',
  },
  'gemini-4-carbon-high': {
    badge: '4C',
    color: '#e879f9',
    shortName: 'Gemini 4 Carbon',
    tierLabel: 'AGY · Strong',
    providerShort: 'AGY',
  },
  'agy:gemini-4-carbon': {
    badge: '4C',
    color: '#e879f9',
    shortName: 'Gemini 4 Carbon',
    tierLabel: 'AGY · Strong',
    providerShort: 'AGY',
  },
  'gemini-4-neon-high': {
    badge: '4N',
    color: '#c084fc',
    shortName: 'Gemini 4 Neon',
    tierLabel: 'AGY · Strong',
    providerShort: 'AGY',
  },
  'agy:gemini-4-neon': {
    badge: '4N',
    color: '#c084fc',
    shortName: 'Gemini 4 Neon',
    tierLabel: 'AGY · Strong',
    providerShort: 'AGY',
  },
  'claude-opus-5-5-high': {
    badge: 'O55',
    color: '#fb923c',
    shortName: 'Claude Opus 5.5',
    tierLabel: 'AGY · Flagship',
    providerShort: 'AGY',
  },
  'agy:claude-opus-5-5': {
    badge: 'O55',
    color: '#fb923c',
    shortName: 'Claude Opus 5.5',
    tierLabel: 'AGY · Flagship',
    providerShort: 'AGY',
  },
};

function inferProviderShort(modelId: string, option?: AgyModelOption): string {
  if (option?.provider) return PROVIDER_META[option.provider].shortLabel;
  if (modelId.startsWith('codex:')) return 'Codex';
  if (modelId.startsWith('claude:')) return 'Claude';
  return 'AGY';
}

function inferFamilyColor(
  modelId: string,
  family?: AgyModelOption['family']
): string {
  const f =
    family ??
    (/claude|opus|sonnet|haiku|fable/i.test(modelId)
      ? 'claude'
      : /gpt|codex/i.test(modelId)
        ? 'gpt'
        : 'gemini');
  if (f === 'claude') {
    if (/opus|fable/i.test(modelId)) return '#fb923c';
    if (/haiku/i.test(modelId)) return '#fbbf24';
    return '#f59e0b';
  }
  if (f === 'gpt') {
    if (/sol/i.test(modelId)) return '#34d399';
    if (/terra/i.test(modelId)) return '#2dd4bf';
    if (/luna/i.test(modelId)) return '#38bdf8';
    return '#14b8a6';
  }
  if (/carbon/i.test(modelId)) return '#e879f9';
  if (/neon/i.test(modelId)) return '#c084fc';
  if (/hydrogen/i.test(modelId)) return '#818cf8';
  return '#a78bfa';
}

function inferBadge(
  modelId: string,
  fallbackLabel?: string,
  option?: AgyModelOption
): string {
  if (option?.badge) return option.badge;
  const raw = modelId.replace(/^(agy|codex|claude):/, '').toLowerCase();
  if (raw.includes('4-carbon')) return '4C';
  if (raw.includes('4-hydrogen')) return '4H';
  if (raw.includes('4-neon')) return '4N';
  if (raw.includes('4-argon')) return '4A';
  if (raw.includes('3.8-flash')) return '3.8';
  if (raw.includes('opus-5-5')) return 'O55';
  if (raw.includes('sonnet-5-5')) return 'S55';
  if (raw.includes('5.6-sol')) return '5.6S';
  if (raw.includes('5.6-terra')) return '5.6T';
  if (raw.includes('5.6-luna')) return '5.6L';
  if (raw.includes('5.4-mini')) return '5.4m';
  const gptVer = raw.match(/gpt-(\d+\.\d+)/);
  if (gptVer) return gptVer[1];
  if (raw === 'opus') return 'Opus';
  if (raw === 'sonnet') return 'Son';
  if (raw === 'haiku') return 'Hai';
  if (raw === 'fable') return 'Fab';
  const clean = (fallbackLabel || raw).replace(/[^a-zA-Z0-9.\s-]/g, ' ').trim();
  const tokens = clean.split(/[\s-]+/).filter(Boolean);
  if (tokens.length >= 2) {
    return (tokens[0][0] + tokens[1].slice(0, 2)).toUpperCase();
  }
  return clean.slice(0, 3).toUpperCase() || 'AI';
}

export function getEffectiveEffort(
  model: AgyModelOption,
  defaultEffort?: ModelEffortLevel,
  overrides?: Record<string, ModelEffortLevel>
): ModelEffortLevel {
  const rank: Record<ModelEffortLevel, number> = {
    low: 0,
    medium: 1,
    high: 2,
    xhigh: 3,
    max: 4,
    ultra: 5,
  };
  const supported =
    model.supportedEfforts && model.supportedEfforts.length > 0
      ? model.supportedEfforts
      : [model.defaultEffort || 'medium'];
  const requested = overrides?.[model.id] ?? defaultEffort ?? model.defaultEffort;
  if (supported.includes(requested)) return requested;
  const reqRank = rank[requested] ?? 1;
  let best = supported[0];
  let bestDist = Infinity;
  for (const cand of supported) {
    const cRank = rank[cand] ?? 1;
    const dist = Math.abs(cRank - reqRank) + (cRank > reqRank ? 0.1 : 0);
    if (dist < bestDist) {
      bestDist = dist;
      best = cand;
    }
  }
  return best;
}

export function getModelUiMeta(
  modelId: string,
  family?: AgyModelOption['family'],
  fallbackLabel?: string,
  option?: AgyModelOption
): ModelUiMeta {
  const providerShort = inferProviderShort(modelId, option);
  if (MODEL_META_BY_ID[modelId] && !option?.badge) {
    return MODEL_META_BY_ID[modelId];
  }
  const preset = MODEL_META_BY_ID[modelId];
  if (preset) return preset;

  const effCount = option?.supportedEfforts?.length ?? 0;
  return {
    badge: inferBadge(modelId, fallbackLabel, option),
    color: inferFamilyColor(modelId, family ?? option?.family),
    shortName:
      option?.label ||
      fallbackLabel ||
      modelId.replace(/^(agy|codex|claude):/, ''),
    tierLabel:
      effCount > 0 ? `${providerShort} · ${effCount} efforts` : providerShort,
    providerShort,
  };
}

export function getPlayerInitials(name: string): string {
  const clean = name
    .replace(/\(.*?\)/g, '')
    .trim();
  if (!clean) return 'YO';
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return clean.slice(0, 2).toUpperCase();
}

export const LOCATION_META: Record<
  LocationMode,
  {
    title: string;
    subtitle: string;
    emoji: string;
    gradient: string;
  }
> = {
  standard: {
    title: 'Whole world',
    subtitle: 'Capitals, coastlines, streets & passes',
    emoji: '🌍',
    gradient: 'linear-gradient(135deg, #1e3a8a, #065f46)',
  },
  big_cities: {
    title: 'Big cities',
    subtitle: 'Dense streets, signs & transit',
    emoji: '🏙',
    gradient: 'linear-gradient(135deg, #374151, #b45309)',
  },
  mountain_regions: {
    title: 'Mountains',
    subtitle: 'Alpine valleys, fjords & passes',
    emoji: '⛰',
    gradient: 'linear-gradient(135deg, #1f2937, #4d7c0f)',
  },
};

export function formatDurationLabel(sec: number | null): string {
  if (sec === null) return 'No limit';
  if (sec < 60) return `${sec}s`;
  const mins = sec / 60;
  return Number.isInteger(mins) ? `${mins} min` : `${sec}s`;
}

export interface LastGameSummary {
  score: number;
  rank: number;
  totalPlayers: number;
  savedAt: string;
}

const LAST_GAME_KEY = 'geoarena_last_game';

export function getLastGameSummary(): LastGameSummary | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LAST_GAME_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LastGameSummary>;
    if (
      typeof parsed.score === 'number' &&
      typeof parsed.rank === 'number' &&
      typeof parsed.totalPlayers === 'number'
    ) {
      return {
        score: parsed.score,
        rank: parsed.rank,
        totalPlayers: parsed.totalPlayers,
        savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : '',
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function saveLastGameSummary(summary: LastGameSummary): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LAST_GAME_KEY, JSON.stringify(summary));
  } catch {
    // ignore storage errors
  }
}

export function formatOrdinalRank(rank: number): string {
  const mod100 = rank % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${rank}th`;
  switch (rank % 10) {
    case 1:
      return `${rank}st`;
    case 2:
      return `${rank}nd`;
    case 3:
      return `${rank}rd`;
    default:
      return `${rank}th`;
  }
}

export const MCP_SNIPPET_STDIO = `{
  "mcpServers": {
    "geoguessr-arena": {
      "command": "node",
      "args": [
        "C:/Users/CP/.gemini/antigravity/scratch/geoguessr-mcp/mcp-server/dist/index.js",
        "--transport", "stdio",
        "--backend-url", "http://localhost:3001",
        "--agent-name", "Antigravity"
      ]
    }
  }
}`;

export const MCP_SNIPPET_HTTP = `# 1. Start Streamable HTTP + SSE bridge (port 3002):
npm run mcp:http

# 2a. Antigravity remote Streamable HTTP mcp_config.json:
{ "mcpServers": { "geoguessr": { "url": "http://localhost:3002/mcp?agentName=Antigravity" } } }

# 2b. ChatGPT / ChatGPT Work (expose via HTTPS tunnel):
cloudflared tunnel --url http://localhost:3002
# Then add Developer Mode connector URL:
https://<tunnel-url>.trycloudflare.com/mcp?agentName=ChatGPT`;
