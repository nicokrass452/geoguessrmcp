import { useRef, useState } from 'react';
import {
  Bot,
  Building2,
  Check,
  Coins,
  Compass,
  Eye,
  Globe2,
  Layers,
  Mountain,
  Play,
  Sparkles,
  Swords,
  User,
  Users,
  Wifi,
} from 'lucide-react';
import type {
  AgyModelOption,
  AgyRunnerStatus,
  GameMode,
  HealthInfo,
  LocationMode,
  McpStatusInfo,
  PanoramaProviderChoice,
} from '@geoguessr-mcp/shared';
import type { StartMatchPayload } from '../lib/api';
import { extractRoomCodeInput } from '../lib/playerSession';

const FALLBACK_MODELS: AgyModelOption[] = [
  { id: 'gemini-3.8-flash-medium', label: 'Gemini 3.8 Flash', family: 'gemini' },
  { id: 'gemini-4-hydrogen-medium', label: 'Gemini 4 Hydrogen', family: 'gemini' },
  { id: 'gemini-4-neon-high', label: 'Gemini 4 Neon', family: 'gemini' },
  { id: 'gemini-4-argon-high', label: 'Gemini 4 Argon', family: 'gemini' },
  { id: 'claude-sonnet-5-5-medium', label: 'Claude Sonnet 5.5', family: 'claude' },
  { id: 'claude-opus-5-5-high', label: 'Claude Opus 5.5', family: 'claude' },
  { id: 'gpt-oss-120b-medium', label: 'GPT-OSS 120B', family: 'gpt' },
];

type PrimaryModeGroup =
  | 'player_vs_ai'
  | 'pvp_ai'
  | 'pvp'
  | 'solo'
  | 'spectator';

export interface WelcomeHubProps {
  initialHumanName: string;
  initialProvider: PanoramaProviderChoice;
  health: HealthInfo | null;
  mcpStatus?: McpStatusInfo;
  agyRunner?: AgyRunnerStatus;
  starting: boolean;
  error: string | null;
  onClearError: () => void;
  onStartMatch: (opts: StartMatchPayload) => void;
  onCreateRoom: (opts: StartMatchPayload) => void;
  onJoinRoom: (roomCode: string, playerName: string) => void;
}

export function WelcomeHub({
  initialHumanName,
  initialProvider,
  health,
  mcpStatus,
  agyRunner,
  starting,
  error,
  onClearError,
  onStartMatch,
  onCreateRoom,
  onJoinRoom,
}: WelcomeHubProps) {
  const step2Ref = useRef<HTMLElement | null>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [primaryGroup, setPrimaryGroup] =
    useState<PrimaryModeGroup>('player_vs_ai');
  const [aiSubMode, setAiSubMode] = useState<'1v1' | 'ffa'>('ffa');
  const [roomAction, setRoomAction] = useState<'create' | 'join'>('create');
  const [joinCode, setJoinCode] = useState('');

  const [locationMode, setLocationMode] = useState<LocationMode>('standard');
  const [bettingEnabled, setBettingEnabled] = useState(false);
  const [humanName, setHumanName] = useState(
    initialHumanName || 'You (Player)'
  );
  const [totalRounds, setTotalRounds] = useState<number>(5);
  const [roundDurationSec, setRoundDurationSec] = useState<number | null>(null);
  const [maxStepsPerRound, setMaxStepsPerRound] = useState<number>(
    agyRunner?.maxStepsPerRound ?? 5
  );
  const [provider, setProvider] = useState<PanoramaProviderChoice>(
    initialProvider || 'auto'
  );
  const [selectedModels, setSelectedModels] = useState<string[]>(
    agyRunner?.selectedModels ?? [
      'gemini-3.8-flash-medium',
      'claude-sonnet-5-5-medium',
    ]
  );

  const effectiveMode: GameMode =
    primaryGroup === 'player_vs_ai' ? aiSubMode : primaryGroup;
  const isMultiHuman = effectiveMode === 'pvp' || effectiveMode === 'pvp_ai';
  const allowsAi =
    effectiveMode === '1v1' ||
    effectiveMode === 'ffa' ||
    effectiveMode === 'pvp_ai' ||
    effectiveMode === 'spectator';

  const availableModels =
    agyRunner?.availableModels && agyRunner.availableModels.length > 0
      ? agyRunner.availableModels
      : FALLBACK_MODELS;

  const toggleModel = (modelId: string) => {
    setSelectedModels((prev) => {
      if (effectiveMode === '1v1') {
        return [modelId];
      }
      return prev.includes(modelId)
        ? prev.filter((id) => id !== modelId)
        : [...prev, modelId];
    });
  };

  const buildPayload = (): StartMatchPayload => {
    const cleanName = humanName.trim() || 'You (Player)';
    return {
      mode: effectiveMode,
      locationMode,
      bettingEnabled,
      startingChips: 1000,
      totalRounds,
      roundDurationSec,
      provider,
      humanName: cleanName,
      maxStepsPerRound,
      selectedModels: allowsAi
        ? effectiveMode === '1v1'
          ? selectedModels.slice(0, 1)
          : selectedModels
        : [],
    };
  };

  const handlePrimaryPlay = () => {
    if (starting) return;
    const payload = buildPayload();
    if (isMultiHuman) {
      onCreateRoom({ ...payload, autoStart: false });
    } else {
      onStartMatch({ ...payload, autoStart: true });
    }
  };

  const handleJoinSubmit = () => {
    const code = extractRoomCodeInput(joinCode);
    if (!code || starting) return;
    const cleanName = humanName.trim() || 'Player';
    onJoinRoom(code, cleanName);
  };

  const mcpBadgeText =
    mcpStatus?.status === 'connected'
      ? `MCP Connected (${mcpStatus.activeMcpAgents})`
      : mcpStatus?.status === 'bridge_ready'
        ? 'MCP Bridge Ready'
        : 'MCP Offline';

  const mcpBadgeCls =
    mcpStatus?.status === 'connected'
      ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-300'
      : mcpStatus?.status === 'bridge_ready'
        ? 'border-sky-400/40 bg-sky-500/15 text-sky-300'
        : 'border-slate-700 bg-slate-900/80 text-slate-400';

  return (
    <div className="h-full w-full overflow-y-auto overflow-x-hidden page-scrollbar bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-6xl px-4 pt-5 pb-10 sm:px-6 lg:pt-8 lg:pb-12 space-y-5 sm:space-y-6">
        {/* Top Hero Header */}
        <header className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-white/10 bg-slate-900/75 px-6 py-4 backdrop-blur-md shadow-2xl">
          <div className="flex items-center gap-3.5">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-400 via-cyan-300 to-emerald-400 text-slate-950 shadow-lg">
              <Globe2 className="h-6 w-6 stroke-[2.2]" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-xl font-extrabold tracking-tight text-white">
                  GeoGuessr MCP Arena
                </h1>
                <span className="rounded-full border border-sky-400/30 bg-sky-500/15 px-2.5 py-0.5 text-[11px] font-bold text-sky-300">
                  Welcome Hub
                </span>
              </div>
              <p className="text-xs text-slate-400">
                360° Street View Arena for Human Explorers &amp; Live MCP AI
                Agents
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div
              data-testid="welcome-mcp-badge"
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${mcpBadgeCls}`}
            >
              <Wifi className="h-3.5 w-3.5" />
              <span>{mcpBadgeText}</span>
            </div>
            <div className="flex items-center gap-1 rounded-full border border-white/10 bg-slate-950/70 px-3 py-1 text-xs text-slate-300">
              <span
                className={
                  step === 1 ? 'font-bold text-sky-300' : 'text-slate-400'
                }
              >
                1. Mode
              </span>
              <span className="text-slate-600">→</span>
              <span
                className={
                  step === 2 ? 'font-bold text-emerald-300' : 'text-slate-400'
                }
              >
                2. Gamemode &amp; Setup
              </span>
            </div>
          </div>
        </header>

        {error && (
          <div
            role="alert"
            className="flex items-center justify-between gap-3 rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-xs text-rose-200"
          >
            <span>{error}</span>
            <button
              type="button"
              onClick={onClearError}
              className="rounded-lg px-2 py-0.5 font-bold text-slate-300 hover:bg-white/10 hover:text-white"
            >
              ✕
            </button>
          </div>
        )}

        {/* STEP 1: Matchup Mode Selection */}
        <section
          aria-label="Step 1 Matchup Mode Selection"
          className="rounded-3xl border border-white/10 bg-slate-900/60 p-5 sm:p-6 shadow-xl space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-sky-400">
                Step 1 of 2 · Who Plays
              </span>
              <h2 className="text-lg font-extrabold text-white">
                Select Matchup Mode
              </h2>
            </div>
            <button
              type="button"
              data-testid="welcome-next-step"
              onClick={() => {
                setStep(2);
                step2Ref.current?.scrollIntoView({
                  behavior: 'smooth',
                  block: 'start',
                });
              }}
              className="rounded-xl border border-sky-400/30 bg-sky-500/15 px-3.5 py-1.5 text-xs font-bold text-sky-300 hover:bg-sky-500/25 transition"
            >
              Continue to Step 2 →
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {/* 1. Player vs AI */}
            <div
              data-testid="mode-card-player_vs_ai"
              aria-label="Player vs AI"
              onClick={() => {
                setPrimaryGroup('player_vs_ai');
                setRoomAction('create');
                setStep(2);
              }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  setPrimaryGroup('player_vs_ai');
                  setRoomAction('create');
                  setStep(2);
                }
              }}
              className={`cursor-pointer rounded-2xl border p-4 text-left transition ${
                primaryGroup === 'player_vs_ai'
                  ? 'border-sky-400 bg-sky-500/15 shadow-lg shadow-sky-500/10'
                  : 'border-white/10 bg-slate-950/60 hover:border-white/25'
              }`}
            >
              <div className="flex items-center justify-between">
                <Swords className="h-5 w-5 text-sky-400" />
                <span className="rounded-md bg-sky-500/20 px-1.5 py-0.5 text-[10px] font-bold text-sky-300">
                  {aiSubMode.toUpperCase()}
                </span>
              </div>
              <div className="mt-2.5 text-sm font-extrabold text-white">
                Player vs AI
              </div>
              <p className="mt-1 text-[11px] text-slate-400 leading-snug">
                Duel a single AI model (1v1) or battle Gemini, Claude &amp;
                GPT-OSS in Free-For-All.
              </p>
              <div
                className="mt-3 grid grid-cols-2 gap-1.5"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  data-testid="submode-1v1"
                  aria-label="1v1"
                  onClick={() => {
                    setPrimaryGroup('player_vs_ai');
                    setAiSubMode('1v1');
                    setStep(2);
                  }}
                  className={`rounded-lg border px-2 py-1 text-[10px] font-bold transition ${
                    primaryGroup === 'player_vs_ai' && aiSubMode === '1v1'
                      ? 'border-sky-400 bg-sky-400 text-slate-950'
                      : 'border-white/10 bg-slate-900 text-slate-300 hover:text-white'
                  }`}
                >
                  1v1 Duel
                </button>
                <button
                  type="button"
                  data-testid="submode-ffa"
                  aria-label="Free-For-All"
                  onClick={() => {
                    setPrimaryGroup('player_vs_ai');
                    setAiSubMode('ffa');
                    setStep(2);
                  }}
                  className={`rounded-lg border px-2 py-1 text-[10px] font-bold transition ${
                    primaryGroup === 'player_vs_ai' && aiSubMode === 'ffa'
                      ? 'border-sky-400 bg-sky-400 text-slate-950'
                      : 'border-white/10 bg-slate-900 text-slate-300 hover:text-white'
                  }`}
                >
                  Free-For-All
                </button>
              </div>
            </div>

            {/* 2. Player vs Player vs AI */}
            <button
              type="button"
              data-testid="mode-card-pvp_ai"
              aria-label="Player vs Player vs AI"
              onClick={() => {
                setPrimaryGroup('pvp_ai');
                setStep(2);
              }}
              className={`rounded-2xl border p-4 text-left transition flex flex-col justify-between ${
                primaryGroup === 'pvp_ai'
                  ? 'border-violet-400 bg-violet-500/15 shadow-lg shadow-violet-500/10'
                  : 'border-white/10 bg-slate-950/60 hover:border-white/25'
              }`}
            >
              <div>
                <div className="flex items-center justify-between">
                  <Sparkles className="h-5 w-5 text-violet-400" />
                  <span className="rounded-md bg-violet-500/20 px-1.5 py-0.5 text-[10px] font-bold text-violet-300">
                    ROOM + AI
                  </span>
                </div>
                <div className="mt-2.5 text-sm font-extrabold text-white">
                  Player vs Player vs AI
                </div>
                <p className="mt-1 text-[11px] text-slate-400 leading-snug">
                  Multi-human room sync via WebSocket competing together against
                  live MCP AI models.
                </p>
              </div>
            </button>

            {/* 3. Player vs Player */}
            <button
              type="button"
              data-testid="mode-card-pvp"
              aria-label="Player vs Player"
              onClick={() => {
                setPrimaryGroup('pvp');
                setStep(2);
              }}
              className={`rounded-2xl border p-4 text-left transition flex flex-col justify-between ${
                primaryGroup === 'pvp'
                  ? 'border-emerald-400 bg-emerald-500/15 shadow-lg shadow-emerald-500/10'
                  : 'border-white/10 bg-slate-950/60 hover:border-white/25'
              }`}
            >
              <div>
                <div className="flex items-center justify-between">
                  <Users className="h-5 w-5 text-emerald-400" />
                  <span className="rounded-md bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">
                    MULTI-TAB
                  </span>
                </div>
                <div className="mt-2.5 text-sm font-extrabold text-white">
                  Player vs Player
                </div>
                <p className="mt-1 text-[11px] text-slate-400 leading-snug">
                  Head-to-head human room duel with instant room-code sync across
                  browser tabs.
                </p>
              </div>
            </button>

            {/* 4. Solo Practice */}
            <button
              type="button"
              data-testid="mode-card-solo"
              aria-label="Solo Practice"
              onClick={() => {
                setPrimaryGroup('solo');
                setRoomAction('create');
                setStep(2);
              }}
              className={`rounded-2xl border p-4 text-left transition flex flex-col justify-between ${
                primaryGroup === 'solo'
                  ? 'border-amber-400 bg-amber-500/15 shadow-lg shadow-amber-500/10'
                  : 'border-white/10 bg-slate-950/60 hover:border-white/25'
              }`}
            >
              <div>
                <div className="flex items-center justify-between">
                  <Compass className="h-5 w-5 text-amber-400" />
                  <span className="rounded-md bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
                    SOLO
                  </span>
                </div>
                <div className="mt-2.5 text-sm font-extrabold text-white">
                  Solo Practice
                </div>
                <p className="mt-1 text-[11px] text-slate-400 leading-snug">
                  Human-only 360° exploration at your own pace with instant
                  post-guess reveals.
                </p>
              </div>
            </button>

            {/* 5. AI-Only Spectator Mode */}
            <button
              type="button"
              data-testid="mode-card-spectator"
              aria-label="AI-Only Spectator Mode"
              onClick={() => {
                setPrimaryGroup('spectator');
                setRoomAction('create');
                setStep(2);
              }}
              className={`rounded-2xl border p-4 text-left transition flex flex-col justify-between ${
                primaryGroup === 'spectator'
                  ? 'border-rose-400 bg-rose-500/15 shadow-lg shadow-rose-500/10'
                  : 'border-white/10 bg-slate-950/60 hover:border-white/25'
              }`}
            >
              <div>
                <div className="flex items-center justify-between">
                  <Eye className="h-5 w-5 text-rose-400" />
                  <span className="rounded-md bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-bold text-rose-300">
                    AI ONLY
                  </span>
                </div>
                <div className="mt-2.5 text-sm font-extrabold text-white">
                  AI-Only Spectator Mode
                </div>
                <p className="mt-1 text-[11px] text-slate-400 leading-snug">
                  Watch Gemini vs Claude vs GPT-OSS compete autonomously with
                  live multi-POV feeds.
                </p>
              </div>
            </button>
          </div>

          {/* Multi-Human Room Create / Join Panel */}
          {isMultiHuman && (
            <div className="mt-4 rounded-2xl border border-emerald-400/35 bg-slate-950/90 p-4 space-y-4 shadow-lg shadow-emerald-500/5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs font-bold text-emerald-300">
                  <Users className="h-4 w-4" />
                  <span>
                    Multiplayer Room Sync ({effectiveMode.toUpperCase()})
                  </span>
                </div>
                <div
                  role="tablist"
                  aria-label="Room Mode"
                  className="inline-flex items-center rounded-xl border border-white/10 bg-slate-900/90 p-1 gap-1"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={roomAction === 'create'}
                    data-testid="mode-create-room-tab"
                    onClick={() => setRoomAction('create')}
                    className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                      roomAction === 'create'
                        ? 'bg-sky-500/25 text-sky-200 border border-sky-400/50 shadow-sm'
                        : 'text-slate-400 hover:text-slate-200 border border-transparent'
                    }`}
                  >
                    Host / Create Room
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={roomAction === 'join'}
                    disabled={roomAction === 'join'}
                    data-testid="switch-to-join-room"
                    onClick={() => setRoomAction('join')}
                    className={`rounded-lg px-3 py-1.5 text-xs font-bold transition disabled:opacity-100 disabled:cursor-default ${
                      roomAction === 'join'
                        ? 'bg-emerald-500/25 text-emerald-200 border border-emerald-400/50 shadow-sm'
                        : 'text-slate-400 hover:text-slate-200 border border-transparent'
                    }`}
                  >
                    Join Room
                  </button>
                </div>
              </div>

              {roomAction === 'create' ? (
                <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] items-end pt-1 border-t border-white/10">
                  <div>
                    <label
                      htmlFor="host-player-name-input"
                      className="mb-1 block text-[11px] font-semibold text-slate-300"
                    >
                      Your Host Name
                    </label>
                    <input
                      id="host-player-name-input"
                      type="text"
                      value={humanName}
                      onChange={(e) => setHumanName(e.target.value)}
                      maxLength={40}
                      placeholder="You (Player)"
                      className="w-full rounded-xl border border-white/15 bg-slate-900 px-3 py-2 text-sm text-white focus:border-sky-400 focus:outline-none"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setStep(2);
                      step2Ref.current?.scrollIntoView({
                        behavior: 'smooth',
                        block: 'start',
                      });
                    }}
                    className="rounded-xl border border-white/15 bg-slate-900 px-3.5 py-2.5 text-xs font-bold text-slate-200 hover:border-sky-400/40 hover:bg-slate-800 transition"
                  >
                    Customize Rules ↓
                  </button>
                  <button
                    type="button"
                    data-testid="open-room-lobby"
                    disabled={starting}
                    onClick={handlePrimaryPlay}
                    className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-400 to-sky-400 px-5 py-2.5 text-xs font-extrabold text-slate-950 shadow-lg shadow-emerald-500/20 hover:from-emerald-300 hover:to-sky-300 disabled:opacity-50 transition"
                  >
                    <Play className="h-3.5 w-3.5 fill-current" />
                    <span>
                      {starting ? 'Creating Room...' : 'Open Room Lobby →'}
                    </span>
                  </button>
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-3 items-end pt-1 border-t border-white/10">
                  <div>
                    <label
                      htmlFor="join-room-code-input"
                      className="mb-1 block text-[11px] font-semibold text-slate-300"
                    >
                      Room Code
                    </label>
                    <input
                      id="join-room-code-input"
                      type="text"
                      aria-label="Room Code"
                      placeholder="e.g. AB12CD or invite link"
                      value={joinCode}
                      onChange={(e) => setJoinCode(e.target.value)}
                      onPaste={(e) => {
                        const pasted = e.clipboardData?.getData('text');
                        if (
                          pasted &&
                          (pasted.includes('://') ||
                            pasted.includes('?room=') ||
                            pasted.includes('/room/'))
                        ) {
                          e.preventDefault();
                          setJoinCode(extractRoomCodeInput(pasted));
                        }
                      }}
                      maxLength={256}
                      className="w-full rounded-xl border border-white/15 bg-slate-900 px-3 py-2 font-mono text-sm uppercase text-white focus:border-emerald-400 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="join-player-name-input"
                      className="mb-1 block text-[11px] font-semibold text-slate-300"
                    >
                      Your Name
                    </label>
                    <input
                      id="join-player-name-input"
                      type="text"
                      aria-label="Player Name"
                      value={humanName}
                      onChange={(e) => setHumanName(e.target.value)}
                      maxLength={40}
                      className="w-full rounded-xl border border-white/15 bg-slate-900 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
                    />
                  </div>
                  <button
                    type="button"
                    data-testid="join-room-submit"
                    disabled={
                      starting || extractRoomCodeInput(joinCode).length === 0
                    }
                    onClick={handleJoinSubmit}
                    className="rounded-xl bg-emerald-500 px-4 py-2.5 text-xs font-extrabold text-slate-950 hover:bg-emerald-400 disabled:opacity-40 transition"
                  >
                    {starting ? 'Joining...' : 'Join Room →'}
                  </button>
                </div>
              )}
            </div>
          )}
        </section>

        {/* STEP 2: Gamemode & Pre-Match Setup */}
        <section
          ref={step2Ref}
          aria-label="Step 2 Gamemode and Pre-Match Setup"
          className="scroll-mt-4 rounded-3xl border border-white/10 bg-slate-900/60 p-5 sm:p-6 shadow-xl space-y-6"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-400">
                Step 2 of 2 · Gamemode &amp; Pre-Match Setup
              </span>
              <h2 className="text-lg font-extrabold text-white">
                Choose Region Gamemode, Confidence Betting &amp; Match Rules
              </h2>
            </div>
          </div>

          {/* Location / Region Gamemodes */}
          <div className="space-y-2">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-300">
              Location / Region Gamemode
            </label>
            <div className="grid gap-3 sm:grid-cols-3">
              <button
                type="button"
                data-testid="location-standard"
                onClick={() => setLocationMode('standard')}
                className={`rounded-2xl border p-4 text-left transition ${
                  locationMode === 'standard'
                    ? 'border-sky-400 bg-sky-500/15 text-white'
                    : 'border-white/10 bg-slate-950/60 text-slate-300 hover:border-white/25'
                }`}
              >
                <div className="flex items-center gap-2 font-extrabold text-sm">
                  <Layers className="h-4 w-4 text-sky-400" />
                  <span>Standard (All regions)</span>
                </div>
                <p className="mt-1 text-[11px] text-slate-400">
                  Full global mix of capitals, landmarks, coastlines, and
                  alpine passes.
                </p>
              </button>

              <button
                type="button"
                data-testid="location-big_cities"
                onClick={() => setLocationMode('big_cities')}
                className={`rounded-2xl border p-4 text-left transition ${
                  locationMode === 'big_cities'
                    ? 'border-amber-400 bg-amber-500/15 text-white'
                    : 'border-white/10 bg-slate-950/60 text-slate-300 hover:border-white/25'
                }`}
              >
                <div className="flex items-center gap-2 font-extrabold text-sm">
                  <Building2 className="h-4 w-4 text-amber-400" />
                  <span>Big Cities Only</span>
                </div>
                <p className="mt-1 text-[11px] text-slate-400">
                  Dense metropolitan intersections, street signage, and transit
                  corridors.
                </p>
              </button>

              <button
                type="button"
                data-testid="location-mountain_regions"
                onClick={() => setLocationMode('mountain_regions')}
                className={`rounded-2xl border p-4 text-left transition ${
                  locationMode === 'mountain_regions'
                    ? 'border-emerald-400 bg-emerald-500/15 text-white'
                    : 'border-white/10 bg-slate-950/60 text-slate-300 hover:border-white/25'
                }`}
              >
                <div className="flex items-center gap-2 font-extrabold text-sm">
                  <Mountain className="h-4 w-4 text-emerald-400" />
                  <span>Mountain Regions Only</span>
                </div>
                <p className="mt-1 text-[11px] text-slate-400">
                  Alpine valleys, dolomites, Andean passes, glacial fjords, and
                  volcanoes.
                </p>
              </button>
            </div>
          </div>

          {/* Confidence Chip-Betting Mode Toggle */}
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-amber-400/25 bg-slate-950/75 p-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-amber-400/30 bg-amber-500/15 text-amber-300">
                <Coins className="h-5 w-5" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-extrabold text-white">
                    Confidence Betting Mode
                  </span>
                  <span className="rounded-full border border-amber-400/30 bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                    1,000 Starting Chips
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-slate-400">
                  Human players and AI agents wager chips each round based on
                  deduction confidence. Top round scorer wins their wager!
                </p>
              </div>
            </div>

            <label className="flex items-center gap-2.5 cursor-pointer">
              <span className="text-xs font-bold text-slate-300">
                Confidence Betting
              </span>
              <button
                type="button"
                role="switch"
                data-testid="betting-toggle"
                aria-label="Confidence Betting Mode"
                aria-checked={bettingEnabled}
                onClick={() => setBettingEnabled((v) => !v)}
                className={`relative inline-flex h-7 w-13 items-center rounded-full border transition ${
                  bettingEnabled
                    ? 'border-amber-400 bg-amber-500/30'
                    : 'border-white/15 bg-slate-800'
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full transition ${
                    bettingEnabled
                      ? 'translate-x-6 bg-amber-400'
                      : 'translate-x-1 bg-slate-400'
                  }`}
                />
              </button>
            </label>
          </div>

          {/* Pre-Match Configuration Grid */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {/* Display Name */}
            <div>
              <label
                htmlFor="welcome-display-name"
                className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-300"
              >
                <User className="h-3.5 w-3.5 text-sky-400" />
                <span>Display Name</span>
              </label>
              <input
                id="welcome-display-name"
                type="text"
                aria-label="Display Name"
                value={humanName}
                onChange={(e) => setHumanName(e.target.value)}
                maxLength={40}
                className="w-full rounded-xl border border-white/15 bg-slate-950 px-3 py-2 text-xs text-white focus:border-sky-400 focus:outline-none"
              />
            </div>

            {/* Rounds */}
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-300">
                Rounds
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                {[3, 5, 10].map((r) => (
                  <button
                    key={r}
                    type="button"
                    data-testid={`rounds-${r}`}
                    onClick={() => setTotalRounds(r)}
                    className={`rounded-xl border py-2 text-xs font-extrabold transition ${
                      totalRounds === r
                        ? 'border-sky-400 bg-sky-500/20 text-white'
                        : 'border-white/10 bg-slate-950 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>

            {/* Round Timer */}
            <div>
              <label
                htmlFor="welcome-round-timer"
                className="mb-1.5 block text-xs font-semibold text-slate-300"
              >
                Round Timer
              </label>
              <select
                id="welcome-round-timer"
                aria-label="Round Timer"
                value={
                  roundDurationSec === null ? 'none' : String(roundDurationSec)
                }
                onChange={(e) =>
                  setRoundDurationSec(
                    e.target.value === 'none' ? null : Number(e.target.value)
                  )
                }
                className="w-full rounded-xl border border-white/15 bg-slate-950 px-3 py-2 text-xs text-white focus:border-sky-400 focus:outline-none"
              >
                <option value="none">No Time Limit</option>
                <option value="10">10 seconds</option>
                <option value="30">30 seconds</option>
                <option value="60">60 seconds</option>
                <option value="120">120 seconds</option>
                <option value="180">180 seconds</option>
              </select>
            </div>

            {/* Step Cap */}
            <div>
              <label
                htmlFor="welcome-step-cap"
                className="mb-1.5 block text-xs font-semibold text-slate-300"
              >
                Step Cap
              </label>
              <select
                id="welcome-step-cap"
                aria-label="Step Cap"
                value={String(maxStepsPerRound)}
                onChange={(e) => setMaxStepsPerRound(Number(e.target.value))}
                className="w-full rounded-xl border border-white/15 bg-slate-950 px-3 py-2 text-xs text-white focus:border-sky-400 focus:outline-none"
              >
                <option value="2">2 steps</option>
                <option value="3">3 steps</option>
                <option value="4">4 steps</option>
                <option value="5">5 steps</option>
                <option value="8">8 steps</option>
                <option value="12">12 steps</option>
                <option value="15">15 steps</option>
                <option value="20">20 steps</option>
              </select>
            </div>

            {/* Panorama Provider */}
            <div>
              <label
                htmlFor="welcome-provider"
                className="mb-1.5 block text-xs font-semibold text-slate-300"
              >
                Panorama Provider
              </label>
              <select
                id="welcome-provider"
                aria-label="Panorama Provider"
                value={provider}
                onChange={(e) =>
                  setProvider(e.target.value as PanoramaProviderChoice)
                }
                className="w-full rounded-xl border border-white/15 bg-slate-950 px-3 py-2 text-xs text-white focus:border-sky-400 focus:outline-none"
              >
                <option value="auto">Auto (Best Configured)</option>
                <option value="open">Open 360° Procedural</option>
                <option value="wikimedia">Wikimedia Commons 360°</option>
                <option value="mapillary">
                  Mapillary 360°{' '}
                  {health?.configuredProviders.mapillary ? '(Configured)' : ''}
                </option>
                <option value="google">
                  Google Street View{' '}
                  {health?.configuredProviders.google ? '(Configured)' : ''}
                </option>
              </select>
            </div>
          </div>

          {/* AI Model Lineup (only shown for modes that include AI) */}
          {allowsAi && (
            <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
                  <Bot className="h-4 w-4 text-sky-400" />
                  <span>
                    AI Model Lineup{' '}
                    {effectiveMode === '1v1'
                      ? '(Pick 1 Opponent)'
                      : `(${selectedModels.length} Selected)`}
                  </span>
                </div>
                <span className="text-[11px] text-slate-400">
                  External MCP clients can also connect live via stdio, /mcp, or
                  /sse
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {availableModels.map((m) => {
                  const isSelected = selectedModels.includes(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => toggleModel(m.id)}
                      className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
                        isSelected
                          ? 'border-sky-400/60 bg-sky-500/20 text-sky-200'
                          : 'border-white/10 bg-slate-900 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {isSelected && <Check className="h-3.5 w-3.5" />}
                      <span>{m.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Launch Action Footer */}
          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-4">
            <div className="text-xs text-slate-400">
              Selected:{' '}
              <strong className="text-slate-200">
                {effectiveMode.toUpperCase()}
              </strong>{' '}
              ·{' '}
              <strong className="text-slate-200">
                {locationMode === 'big_cities'
                  ? 'Big Cities Only'
                  : locationMode === 'mountain_regions'
                    ? 'Mountain Regions Only'
                    : 'Standard (All regions)'}
              </strong>{' '}
              · <strong className="text-slate-200">{totalRounds} Rounds</strong>
              {bettingEnabled ? (
                <>
                  {' '}
                  ·{' '}
                  <strong className="text-amber-300">
                    Confidence Betting (1,000 chips)
                  </strong>
                </>
              ) : null}
            </div>

            <button
              type="button"
              data-testid="play-button"
              aria-label={isMultiHuman ? 'Create Room & Open Lobby' : 'Play'}
              disabled={starting}
              onClick={handlePrimaryPlay}
              className="flex items-center gap-2.5 rounded-2xl bg-gradient-to-r from-emerald-400 to-sky-400 px-7 py-3 text-sm font-extrabold text-slate-950 shadow-xl shadow-emerald-500/20 hover:from-emerald-300 hover:to-sky-300 disabled:opacity-50 transition"
            >
              <Play className="h-4 w-4 fill-current" />
              <span>
                {starting
                  ? isMultiHuman
                    ? 'Creating Room...'
                    : 'Starting...'
                  : isMultiHuman
                    ? 'Create Room & Open Lobby'
                    : 'Play'}
              </span>
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
