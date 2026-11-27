import type { AgyModelOption, LocationMode } from '@geoguessr-mcp/shared';

export const FALLBACK_AGY_MODELS: AgyModelOption[] = [
  { id: 'gemini-4-hydrogen-medium', label: 'Gemini 4 Hydrogen', family: 'gemini' },
  { id: 'claude-sonnet-5-5-medium', label: 'Claude Sonnet 5.5', family: 'claude' },
  { id: 'gemini-4-carbon-high', label: 'Gemini 4 Carbon', family: 'gemini' },
  { id: 'gemini-4-neon-high', label: 'Gemini 4 Neon', family: 'gemini' },
  { id: 'claude-opus-5-5-high', label: 'Claude Opus 5.5', family: 'claude' },
];

export interface ModelUiMeta {
  badge: string;
  color: string;
  shortName: string;
  tierLabel: string;
}

const MODEL_META_BY_ID: Record<string, ModelUiMeta> = {
  'gemini-4-hydrogen-medium': {
    badge: 'H',
    color: '#818cf8',
    shortName: 'Gemini Hydrogen',
    tierLabel: 'Fast · casual',
  },
  'claude-sonnet-5-5-medium': {
    badge: 'C',
    color: '#f59e0b',
    shortName: 'Claude Sonnet',
    tierLabel: 'Balanced',
  },
  'gemini-4-carbon-high': {
    badge: 'G4',
    color: '#e879f9',
    shortName: 'Gemini Carbon',
    tierLabel: 'Hard',
  },
  'gemini-4-neon-high': {
    badge: 'N',
    color: '#c084fc',
    shortName: 'Gemini Neon',
    tierLabel: 'Hard',
  },
  'claude-opus-5-5-high': {
    badge: 'CO',
    color: '#fb923c',
    shortName: 'Claude Opus',
    tierLabel: 'Hard',
  },
};

export function getModelUiMeta(
  modelId: string,
  family?: 'gemini' | 'claude' | 'gpt',
  fallbackLabel?: string
): ModelUiMeta {
  if (MODEL_META_BY_ID[modelId]) {
    return MODEL_META_BY_ID[modelId];
  }
  const color =
    family === 'claude' ? '#f59e0b' : family === 'gpt' ? '#2dd4bf' : '#a78bfa';
  const badge =
    family === 'claude' ? 'C' : family === 'gpt' ? 'O' : 'G';
  return {
    badge,
    color,
    shortName: fallbackLabel || modelId,
    tierLabel: 'AI opponent',
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
