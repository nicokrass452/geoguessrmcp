import { useEffect, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Coins,
  Link2,
  Pencil,
  Play,
  Plus,
  Settings,
  Swords,
  Users,
  X,
} from 'lucide-react';
import type {
  AgyRunnerStatus,
  GameMode,
  HealthInfo,
  LocationMode,
  McpStatusInfo,
  PanoramaProviderChoice,
} from '@geoguessr-mcp/shared';
import type { StartMatchPayload } from '../lib/api';
import { extractRoomCodeInput } from '../lib/playerSession';
import {
  FALLBACK_AGY_MODELS,
  formatDurationLabel,
  formatOrdinalRank,
  getLastGameSummary,
  getModelUiMeta,
  getPlayerInitials,
  LOCATION_META,
  type LastGameSummary,
} from '../lib/uiHelpers';
import { SettingsModal } from './SettingsModal';

type SetupFlowMode = 'player_vs_ai' | 'friends' | 'spectator' | 'solo';

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
  const [subView, setSubView] = useState<'home' | 'setup'>('home');
  const [flowMode, setFlowMode] = useState<SetupFlowMode>('player_vs_ai');
  const [aiSubMode, setAiSubMode] = useState<'1v1' | 'ffa'>('ffa');
  const [friendsWithAi, setFriendsWithAi] = useState<boolean>(true);
  const [joinCode, setJoinCode] = useState('');

  const [locationMode, setLocationMode] = useState<LocationMode>('standard');
  const [bettingEnabled, setBettingEnabled] = useState(false);
  const [humanName, setHumanName] = useState(
    initialHumanName && initialHumanName !== 'You (Player)'
      ? initialHumanName
      : 'You'
  );
  const [totalRounds, setTotalRounds] = useState<number>(5);
  const [roundDurationSec, setRoundDurationSec] = useState<number | null>(null);
  const [maxStepsPerRound, setMaxStepsPerRound] = useState<number>(
    agyRunner?.maxStepsPerRound ?? 5
  );
  const [timeoutSec, setTimeoutSec] = useState<number>(
    agyRunner?.timeoutSec ?? 120
  );
  const [provider, setProvider] = useState<PanoramaProviderChoice>(
    initialProvider || 'auto'
  );
  const [selectedModels, setSelectedModels] = useState<string[]>(
    agyRunner?.selectedModels && agyRunner.selectedModels.length > 0
      ? agyRunner.selectedModels
      : ['gemini-4-hydrogen-medium', 'claude-sonnet-5-5-medium']
  );

  const [showAllModels, setShowAllModels] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [settingsModalTab, setSettingsModalTab] = useState<
    'general' | 'developer' | null
  >(null);
  const [lastGame, setLastGame] = useState<LastGameSummary | null>(null);

  useEffect(() => {
    setLastGame(getLastGameSummary());
  }, []);

  const availableModels =
    agyRunner?.availableModels && agyRunner.availableModels.length > 0
      ? agyRunner.availableModels
      : FALLBACK_AGY_MODELS;

  const effectiveMode: GameMode =
    flowMode === 'player_vs_ai'
      ? aiSubMode
      : flowMode === 'friends'
        ? friendsWithAi
          ? 'pvp_ai'
          : 'pvp'
        : flowMode;

  const isMultiHuman = effectiveMode === 'pvp' || effectiveMode === 'pvp_ai';
  const allowsAi =
    effectiveMode === '1v1' ||
    effectiveMode === 'ffa' ||
    effectiveMode === 'pvp_ai' ||
    effectiveMode === 'spectator';

  const activeSelectedModels =
    effectiveMode === '1v1' ? selectedModels.slice(0, 1) : selectedModels;

  const toggleModel = (modelId: string) => {
    setSelectedModels((prev) => {
      if (effectiveMode === '1v1') {
        return [modelId];
      }
      if (prev.includes(modelId)) {
        return prev.length > 1 ? prev.filter((id) => id !== modelId) : prev;
      }
      return [...prev, modelId];
    });
  };

  const buildPayload = (
    overrideMode?: GameMode,
    overrideModels?: string[]
  ): StartMatchPayload => {
    const modeToUse = overrideMode ?? effectiveMode;
    const modeAllowsAi =
      modeToUse === '1v1' ||
      modeToUse === 'ffa' ||
      modeToUse === 'pvp_ai' ||
      modeToUse === 'spectator';
    const modelsList = overrideModels ?? activeSelectedModels;
    const finalModels = modeAllowsAi
      ? modeToUse === '1v1'
        ? modelsList.slice(0, 1)
        : modelsList
      : [];

    return {
      mode: modeToUse,
      locationMode,
      bettingEnabled,
      startingChips: 1000,
      totalRounds,
      roundDurationSec,
      provider,
      humanName: humanName.trim() || 'You',
      maxStepsPerRound,
      timeoutSec,
      selectedModels: finalModels,
      autoPlayEnabled: modeAllowsAi && finalModels.length > 0,
    };
  };

  const handleQuickPlayVsAi = () => {
    if (starting) return;
    const payload = buildPayload('ffa', selectedModels);
    onStartMatch({ ...payload, autoStart: true });
  };

  const openSetupFor = (target: SetupFlowMode) => {
    setFlowMode(target);
    setSubView('setup');
  };

  const handleStartFromSetup = () => {
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
    onJoinRoom(code, humanName.trim() || 'Player');
  };

  const aiOnline =
    Boolean(agyRunner?.available) || mcpStatus?.status === 'connected';
  const statusDotCls = aiOnline
    ? 'bg-[#22c55e]'
    : mcpStatus?.status === 'bridge_ready'
      ? 'bg-[#fbbf24]'
      : 'bg-[#8d97ae]';
  const statusChipLabel =
    mcpStatus?.status === 'connected'
      ? `AI agents online (${mcpStatus.activeMcpAgents})`
      : agyRunner?.available
        ? 'AI agents online'
        : mcpStatus?.status === 'bridge_ready'
          ? 'Connect AI'
          : 'AI offline';

  const opponentsSummaryText = !allowsAi
    ? effectiveMode === 'solo'
      ? 'Solo'
      : 'Friends only'
    : activeSelectedModels.length === 0
      ? 'External AI'
      : activeSelectedModels
          .map((id) => {
            const found = availableModels.find((m) => m.id === id);
            return getModelUiMeta(id, found?.family, found?.label).shortName;
          })
          .join(', ');

  const visibleModels = showAllModels
    ? availableModels
    : availableModels.slice(0, 4);
  const hiddenModelCount = Math.max(0, availableModels.length - 4);

  const setupTitle =
    flowMode === 'player_vs_ai'
      ? 'Play vs AI'
      : flowMode === 'friends'
        ? 'Play with friends'
        : flowMode === 'spectator'
          ? 'Watch the AIs'
          : 'Solo practice';

  const startButtonLabel = starting
    ? isMultiHuman
      ? 'Creating room…'
      : 'Starting…'
    : isMultiHuman
      ? 'Create room'
      : flowMode === 'spectator'
        ? 'Start show'
        : 'Start game';

  return (
    <div className="geo-bg h-full w-full overflow-y-auto overflow-x-hidden page-scrollbar text-[#eef1f8]">
      {/* Top Nav */}
      <nav className="mx-auto flex max-w-[1200px] items-center justify-between px-5 py-5 sm:px-10">
        <button
          type="button"
          onClick={() => setSubView('home')}
          className="flex items-center gap-2.5 text-[18px] font-extrabold tracking-tight text-white"
        >
          <span className="grid h-[34px] w-[34px] place-items-center rounded-[10px] bg-gradient-to-br from-[#22c55e] to-[#3b82f6] text-lg shadow-md">
            🌍
          </span>
          <span>GeoArena</span>
        </button>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            data-testid="welcome-mcp-badge"
            onClick={() => setSettingsModalTab('developer')}
            className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-3 py-1.5 text-[13px] font-medium text-[#8d97ae] hover:border-white/25 hover:text-white transition"
          >
            <span className={`inline-block h-2 w-2 rounded-full ${statusDotCls}`} />
            <span>{statusChipLabel}</span>
          </button>

          <button
            type="button"
            onClick={() => setSettingsModalTab('general')}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.04] px-3 py-1.5 text-[13px] font-medium text-[#8d97ae] hover:border-white/25 hover:text-white transition"
          >
            <Settings className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Settings</span>
          </button>

          <button
            type="button"
            onClick={() => setSettingsModalTab('general')}
            title="Edit display name"
            className="grid h-[34px] w-[34px] place-items-center rounded-full bg-[#60a5fa] text-[13px] font-extrabold text-[#0b1020] hover:opacity-90 transition"
          >
            {getPlayerInitials(humanName)}
          </button>
        </div>
      </nav>

      {error && (
        <div className="mx-auto max-w-[1120px] px-5 sm:px-10 mb-4">
          <div
            role="alert"
            className="flex items-center justify-between gap-3 rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200"
          >
            <span>{error}</span>
            <button
              type="button"
              onClick={onClearError}
              className="rounded-lg p-1 text-slate-300 hover:bg-white/10 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {subView === 'home' ? (
        <main className="mx-auto max-w-[1120px] px-5 pt-4 pb-10 sm:px-10">
          <h1 className="text-3xl sm:text-[46px] font-extrabold leading-[1.08] tracking-[-0.03em] text-white mb-3">
            Where in the world are you?
          </h1>
          <p className="text-[16px] sm:text-[18px] text-[#8d97ae] max-w-[620px] mb-8">
            Drop into a random 360° street view, look around, and pin your guess
            on the map. Beat your friends — or the AI.
          </p>

          {/* 3 Primary Cards */}
          <div className="grid gap-[18px] lg:grid-cols-[1.35fr_1fr_1fr]">
            {/* Play vs AI (Primary) */}
            <div
              role="button"
              tabIndex={0}
              data-testid="mode-card-player_vs_ai"
              onClick={() => openSetupFor('player_vs_ai')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  openSetupFor('player_vs_ai');
                }
              }}
              style={{
                background:
                  'linear-gradient(160deg, #173a2a 0%, #121a2e 60%)',
                borderColor: 'rgba(34, 197, 94, 0.35)',
              }}
              className="group cursor-pointer rounded-2xl border p-6 sm:p-[26px] flex flex-col gap-2.5 min-h-[260px] transition hover:border-[#22c55e]/60"
            >
              <div className="flex items-center justify-between">
                <span className="text-[28px] leading-none">
                  <Swords className="h-7 w-7 text-[#eef1f8]" />
                </span>
                <span className="text-xs font-semibold text-[#8d97ae] group-hover:text-white transition">
                  Customize →
                </span>
              </div>
              <h2 className="text-[23px] font-bold tracking-[-0.01em] text-white mt-1">
                Play vs AI
              </h2>
              <p className="text-[15px] text-[#8d97ae]">
                Race Gemini and Claude to the right spot. Pick one opponent or
                take them all on.
              </p>
              <div className="flex-1" />
              <div className="flex items-center justify-between gap-3 pt-2">
                <div className="flex items-center">
                  {[
                    { badge: 'H', bg: '#818cf8' },
                    { badge: 'C', bg: '#f59e0b' },
                    { badge: 'G4', bg: '#e879f9' },
                  ].map((av, idx) => (
                    <span
                      key={av.badge}
                      style={{ backgroundColor: av.bg }}
                      className={`grid h-[38px] w-[38px] place-items-center rounded-full border-[3px] border-[#121a2e] text-[13px] font-extrabold text-[#0b1020] ${
                        idx > 0 ? '-ml-2' : ''
                      }`}
                    >
                      {av.badge}
                    </span>
                  ))}
                </div>
                <button
                  type="button"
                  data-testid="quick-play-button"
                  disabled={starting}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleQuickPlayVsAi();
                  }}
                  className="inline-flex items-center gap-2 rounded-[14px] bg-[#22c55e] px-6 py-3.5 text-[16px] font-bold text-[#052e14] shadow-[0_8px_24px_rgba(34,197,94,0.25)] hover:bg-[#34d369] disabled:opacity-50 transition"
                >
                  <Play className="h-4 w-4 fill-current" />
                  <span>{starting ? 'Starting…' : 'Quick Play'}</span>
                </button>
              </div>
            </div>

            {/* Play with friends */}
            <div
              role="button"
              tabIndex={0}
              data-testid="mode-card-pvp_ai"
              onClick={() => openSetupFor('friends')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  openSetupFor('friends');
                }
              }}
              className="geo-card cursor-pointer p-6 sm:p-[26px] flex flex-col gap-2.5 min-h-[260px] transition hover:border-white/25"
            >
              <div className="text-[28px] leading-none">
                <Users className="h-7 w-7 text-[#a78bfa]" />
              </div>
              <h2 className="text-[23px] font-bold tracking-[-0.01em] text-white mt-1">
                Play with friends
              </h2>
              <p className="text-[15px] text-[#8d97ae]">
                Create a private room and share a link. Add AI players if you
                want.
              </p>
              <div className="flex-1" />
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  openSetupFor('friends');
                }}
                className="w-full rounded-xl border border-white/15 bg-[#18223a] px-4 py-3 text-[15px] font-bold text-[#eef1f8] hover:bg-[#1f2c4a] transition"
              >
                Create room
              </button>
            </div>

            {/* Watch the AIs */}
            <div
              role="button"
              tabIndex={0}
              data-testid="mode-card-spectator"
              onClick={() => openSetupFor('spectator')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  openSetupFor('spectator');
                }
              }}
              className="geo-card cursor-pointer p-6 sm:p-[26px] flex flex-col gap-2.5 min-h-[260px] transition hover:border-white/25"
            >
              <div className="text-[28px] leading-none">🍿</div>
              <h2 className="text-[23px] font-bold tracking-[-0.01em] text-white mt-1">
                Watch the AIs
              </h2>
              <p className="text-[15px] text-[#8d97ae]">
                Sit back and see how the models reason their way around the
                globe.
              </p>
              <div className="flex-1" />
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  openSetupFor('spectator');
                }}
                className="w-full rounded-xl border border-white/15 bg-[#18223a] px-4 py-3 text-[15px] font-bold text-[#eef1f8] hover:bg-[#1f2c4a] transition"
              >
                Start show
              </button>
            </div>
          </div>

          {/* 2 Slim Secondary Cards */}
          <div className="mt-[18px] grid gap-[18px] md:grid-cols-2">
            <div className="geo-card flex flex-wrap sm:flex-nowrap items-center gap-4 px-[22px] py-[18px]">
              <div className="text-[26px] leading-none">🔑</div>
              <div className="min-w-[140px]">
                <h3 className="text-[16px] font-bold text-white">
                  Got a room code?
                </h3>
                <p className="text-[14px] text-[#8d97ae] mt-0.5">
                  Or paste an invite link
                </p>
              </div>
              <div className="flex flex-1 min-w-[180px] gap-2">
                <input
                  type="text"
                  aria-label="Room code or invite link"
                  placeholder="AB12CD"
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
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleJoinSubmit();
                  }}
                  className="w-full min-w-0 flex-1 rounded-xl border border-white/15 bg-[#0b1020] px-3.5 py-2.5 font-mono text-[16px] uppercase tracking-[0.15em] text-[#eef1f8] placeholder:text-[#8d97ae]/50 focus:border-[#22c55e] focus:outline-none"
                />
                <button
                  type="button"
                  data-testid="join-room-submit"
                  disabled={
                    starting || extractRoomCodeInput(joinCode).length === 0
                  }
                  onClick={handleJoinSubmit}
                  className="rounded-xl bg-[#22c55e] px-5 py-2.5 text-[15px] font-bold text-[#052e14] shadow-[0_8px_24px_rgba(34,197,94,0.25)] hover:bg-[#34d369] disabled:opacity-40 transition"
                >
                  Join
                </button>
              </div>
            </div>

            <div
              role="button"
              tabIndex={0}
              data-testid="mode-card-solo"
              onClick={() => openSetupFor('solo')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  openSetupFor('solo');
                }
              }}
              className="geo-card cursor-pointer flex items-center gap-4 px-[22px] py-[18px] transition hover:border-white/25"
            >
              <div className="text-[26px] leading-none">🧭</div>
              <div className="flex-1">
                <h3 className="text-[16px] font-bold text-white">
                  Solo practice
                </h3>
                <p className="text-[14px] text-[#8d97ae] mt-0.5">
                  No timer, no pressure. Just you and the map.
                </p>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  openSetupFor('solo');
                }}
                className="rounded-xl border border-white/15 bg-[#18223a] px-5 py-2.5 text-[15px] font-bold text-[#eef1f8] hover:bg-[#1f2c4a] transition"
              >
                Practice
              </button>
            </div>
          </div>

          {/* Quiet Footer */}
          <footer className="mt-7 flex flex-wrap items-center gap-3 text-[13px] text-[#8d97ae]">
            {lastGame && (
              <>
                <span>
                  Last game: {lastGame.score.toLocaleString()} pts ·{' '}
                  {formatOrdinalRank(lastGame.rank)} of {lastGame.totalPlayers}
                </span>
                <span>·</span>
              </>
            )}
            <button
              type="button"
              onClick={() => setSettingsModalTab('developer')}
              className="text-[#8d97ae] hover:text-[#eef1f8] transition"
            >
              Developers: connect your own agent via MCP →
            </button>
          </footer>
        </main>
      ) : (
        /* Screen 2: Setup */
        <div className="mx-auto max-w-[1120px] px-5 pb-10 sm:px-10">
          <button
            type="button"
            onClick={() => setSubView('home')}
            className="mb-2 inline-flex items-center gap-1.5 text-[14px] font-medium text-[#8d97ae] hover:text-white transition"
          >
            <span>← Back</span>
          </button>

          <h1 className="text-[32px] font-extrabold tracking-[-0.02em] text-white mb-5">
            {setupTitle}
          </h1>

          <div className="grid gap-[22px] lg:grid-cols-[1fr_340px] items-start">
            {/* Left Options Column */}
            <div className="space-y-4">
              {/* Opponents Card */}
              {flowMode !== 'solo' && (
                <div className="geo-card p-5 sm:p-6">
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-3.5">
                    <h2 className="text-[17px] font-bold text-white">
                      {flowMode === 'spectator'
                        ? 'Which AI models should compete?'
                        : flowMode === 'friends'
                          ? 'Include AI opponents?'
                          : 'Who do you want to play against?'}
                    </h2>

                    {flowMode === 'player_vs_ai' && (
                      <div className="inline-flex rounded-xl border border-white/10 bg-[#0b1020] p-1 gap-1">
                        <button
                          type="button"
                          data-testid="submode-1v1"
                          onClick={() => setAiSubMode('1v1')}
                          className={`rounded-[9px] px-4 py-1.5 text-[14px] font-semibold transition ${
                            aiSubMode === '1v1'
                              ? 'bg-[#18223a] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)]'
                              : 'text-[#8d97ae] hover:text-white'
                          }`}
                        >
                          1 vs 1
                        </button>
                        <button
                          type="button"
                          data-testid="submode-ffa"
                          onClick={() => setAiSubMode('ffa')}
                          className={`rounded-[9px] px-4 py-1.5 text-[14px] font-semibold transition ${
                            aiSubMode === 'ffa'
                              ? 'bg-[#18223a] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)]'
                              : 'text-[#8d97ae] hover:text-white'
                          }`}
                        >
                          Everyone
                        </button>
                      </div>
                    )}

                    {flowMode === 'friends' && (
                      <div className="inline-flex rounded-xl border border-white/10 bg-[#0b1020] p-1 gap-1">
                        <button
                          type="button"
                          onClick={() => setFriendsWithAi(false)}
                          className={`rounded-[9px] px-3.5 py-1.5 text-[14px] font-semibold transition ${
                            !friendsWithAi
                              ? 'bg-[#18223a] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)]'
                              : 'text-[#8d97ae] hover:text-white'
                          }`}
                        >
                          Friends only
                        </button>
                        <button
                          type="button"
                          onClick={() => setFriendsWithAi(true)}
                          className={`rounded-[9px] px-3.5 py-1.5 text-[14px] font-semibold transition ${
                            friendsWithAi
                              ? 'bg-[#18223a] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)]'
                              : 'text-[#8d97ae] hover:text-white'
                          }`}
                        >
                          Friends + AI
                        </button>
                      </div>
                    )}
                  </div>

                  {allowsAi ? (
                    <>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {visibleModels.map((m) => {
                          const meta = getModelUiMeta(m.id, m.family, m.label);
                          const isOn = activeSelectedModels.includes(m.id);
                          return (
                            <button
                              key={m.id}
                              type="button"
                              onClick={() => toggleModel(m.id)}
                              className={`relative flex flex-col items-center gap-2 rounded-[14px] border p-3.5 text-center transition ${
                                isOn
                                  ? 'border-[#22c55e] bg-[#22c55e]/[0.08]'
                                  : 'border-white/15 bg-transparent hover:border-white/30'
                              }`}
                            >
                              {isOn && (
                                <span className="absolute top-2 right-2.5 grid h-5 w-5 place-items-center rounded-full bg-[#22c55e] text-[12px] font-black text-[#052e14]">
                                  ✓
                                </span>
                              )}
                              <div
                                style={{ backgroundColor: meta.color }}
                                className="grid h-12 w-12 place-items-center rounded-full text-[18px] font-extrabold text-[#0b1020]"
                              >
                                {meta.badge}
                              </div>
                              <b className="text-[14px] font-bold text-white leading-tight">
                                {meta.shortName}
                              </b>
                              <small className="text-[12px] text-[#8d97ae]">
                                {meta.tierLabel}
                              </small>
                            </button>
                          );
                        })}
                      </div>

                      {hiddenModelCount > 0 && (
                        <button
                          type="button"
                          onClick={() => setShowAllModels((v) => !v)}
                          className="mt-3 text-[13px] font-medium text-[#8d97ae] hover:text-white transition"
                        >
                          {showAllModels
                            ? 'Show fewer models'
                            : `+ ${hiddenModelCount} more models`}
                        </button>
                      )}
                    </>
                  ) : (
                    <p className="text-sm text-[#8d97ae]">
                      Human players only. You can still add AI opponents inside
                      the room lobby later.
                    </p>
                  )}
                </div>
              )}

              {/* Map Card */}
              <div className="geo-card p-5 sm:p-6">
                <h2 className="text-[17px] font-bold text-white mb-3.5">Map</h2>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {(['standard', 'big_cities', 'mountain_regions'] as const).map(
                    (loc) => {
                      const info = LOCATION_META[loc];
                      const active = locationMode === loc;
                      return (
                        <button
                          key={loc}
                          type="button"
                          data-testid={`location-${loc}`}
                          onClick={() => setLocationMode(loc)}
                          className={`overflow-hidden rounded-[14px] border text-left transition ${
                            active
                              ? 'border-[#22c55e] shadow-[0_0_0_1px_#22c55e]'
                              : 'border-white/15 hover:border-white/30'
                          }`}
                        >
                          <div
                            style={{ background: info.gradient }}
                            className="h-[84px] w-full"
                          />
                          <div className="px-3 py-2.5 text-[14px] font-bold text-white flex items-center gap-1.5">
                            <span>{info.emoji}</span>
                            <span>{info.title}</span>
                          </div>
                        </button>
                      );
                    }
                  )}
                </div>
              </div>

              {/* Rounds & Timer Card */}
              <div className="geo-card p-5 sm:p-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="mb-2 block text-[14px] font-semibold text-white">
                      Rounds
                    </label>
                    <div className="inline-flex rounded-xl border border-white/10 bg-[#0b1020] p-1 gap-1">
                      {[3, 5, 10].map((r) => (
                        <button
                          key={r}
                          type="button"
                          data-testid={`rounds-${r}`}
                          onClick={() => setTotalRounds(r)}
                          className={`rounded-[9px] px-4 py-2 text-[14px] font-semibold transition ${
                            totalRounds === r
                              ? 'bg-[#18223a] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)]'
                              : 'text-[#8d97ae] hover:text-white'
                          }`}
                        >
                          {r}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="mb-2 block text-[14px] font-semibold text-white">
                      Time per round
                    </label>
                    <div className="inline-flex flex-wrap rounded-xl border border-white/10 bg-[#0b1020] p-1 gap-1">
                      {[
                        { label: 'No limit', value: null },
                        { label: '30s', value: 30 },
                        { label: '1 min', value: 60 },
                        { label: '2 min', value: 120 },
                      ].map((opt) => (
                        <button
                          key={opt.label}
                          type="button"
                          onClick={() => setRoundDurationSec(opt.value)}
                          className={`rounded-[9px] px-3 py-2 text-[14px] font-semibold transition ${
                            roundDurationSec === opt.value
                              ? 'bg-[#18223a] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)]'
                              : 'text-[#8d97ae] hover:text-white'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Collapsible Advanced */}
              <div className="geo-card overflow-hidden">
                <button
                  type="button"
                  onClick={() => setAdvancedOpen((v) => !v)}
                  className="flex w-full items-center justify-between px-6 py-4 text-[15px] font-semibold text-[#8d97ae] hover:text-white transition"
                >
                  <span>⚙ Advanced — image source, AI move limit</span>
                  {advancedOpen ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </button>

                {advancedOpen && (
                  <div className="border-t border-white/10 px-6 py-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label
                        htmlFor="setup-provider"
                        className="mb-1.5 block text-[13px] font-semibold text-[#8d97ae]"
                      >
                        Image source
                      </label>
                      <select
                        id="setup-provider"
                        value={provider}
                        onChange={(e) =>
                          setProvider(e.target.value as PanoramaProviderChoice)
                        }
                        className="w-full rounded-xl border border-white/15 bg-[#0b1020] px-3 py-2 text-sm text-white focus:border-[#22c55e] focus:outline-none"
                      >
                        <option value="auto">Auto (Best available)</option>
                        <option value="open">Open 360° Procedural</option>
                        <option value="wikimedia">Wikimedia Commons 360°</option>
                        <option value="mapillary">
                          Mapillary 360°{' '}
                          {health?.configuredProviders.mapillary
                            ? '(Configured)'
                            : ''}
                        </option>
                        <option value="google">
                          Google Street View{' '}
                          {health?.configuredProviders.google
                            ? '(Configured)'
                            : ''}
                        </option>
                      </select>
                    </div>

                    <div>
                      <label
                        htmlFor="setup-step-cap"
                        className="mb-1.5 block text-[13px] font-semibold text-[#8d97ae]"
                      >
                        AI move limit
                      </label>
                      <select
                        id="setup-step-cap"
                        value={String(maxStepsPerRound)}
                        onChange={(e) =>
                          setMaxStepsPerRound(Number(e.target.value))
                        }
                        className="w-full rounded-xl border border-white/15 bg-[#0b1020] px-3 py-2 text-sm text-white focus:border-[#22c55e] focus:outline-none"
                      >
                        <option value="3">3 moves</option>
                        <option value="5">5 moves</option>
                        <option value="8">8 moves</option>
                        <option value="12">12 moves</option>
                        <option value="15">15 moves</option>
                        <option value="20">20 moves</option>
                      </select>
                    </div>

                    <div>
                      <label
                        htmlFor="setup-ai-timeout"
                        className="mb-1.5 block text-[13px] font-semibold text-[#8d97ae]"
                      >
                        AI turn timeout
                      </label>
                      <select
                        id="setup-ai-timeout"
                        value={String(timeoutSec)}
                        onChange={(e) => setTimeoutSec(Number(e.target.value))}
                        className="w-full rounded-xl border border-white/15 bg-[#0b1020] px-3 py-2 text-sm text-white focus:border-[#22c55e] focus:outline-none"
                      >
                        <option value="60">60 seconds</option>
                        <option value="120">120 seconds</option>
                        <option value="180">180 seconds</option>
                        <option value="240">240 seconds</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Sticky Summary Sidebar */}
            <aside className="geo-card p-6 lg:sticky lg:top-5">
              <h3 className="text-[17px] font-bold text-white mb-4">
                Your game
              </h3>

              <div className="divide-y divide-white/[0.08] text-[14px]">
                <div className="flex justify-between gap-3 py-2.5">
                  <span className="text-[#8d97ae]">Opponents</span>
                  <span className="text-right font-semibold text-white">
                    {opponentsSummaryText}
                  </span>
                </div>
                <div className="flex justify-between gap-3 py-2.5">
                  <span className="text-[#8d97ae]">Map</span>
                  <span className="text-right font-semibold text-white">
                    {LOCATION_META[locationMode].title}
                  </span>
                </div>
                <div className="flex justify-between gap-3 py-2.5">
                  <span className="text-[#8d97ae]">Rounds</span>
                  <span className="text-right font-semibold text-white">
                    {totalRounds}
                  </span>
                </div>
                <div className="flex justify-between gap-3 py-2.5">
                  <span className="text-[#8d97ae]">Timer</span>
                  <span className="text-right font-semibold text-white">
                    {formatDurationLabel(roundDurationSec)}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-3.5 pt-4 pb-1">
                <div className="flex-1">
                  <div className="flex items-center gap-1.5 text-[14px] font-bold text-white">
                    <Coins className="h-4 w-4 text-[#fbbf24]" />
                    <span>Betting</span>
                  </div>
                  <div className="text-[13px] text-[#8d97ae]">
                    Wager chips on how sure you are
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  data-testid="betting-toggle"
                  aria-label="Betting"
                  aria-checked={bettingEnabled}
                  onClick={() => setBettingEnabled((v) => !v)}
                  className={`relative h-[26px] w-[46px] shrink-0 rounded-full transition ${
                    bettingEnabled ? 'bg-[#22c55e]' : 'bg-[#2a3550]'
                  }`}
                >
                  <span
                    className={`absolute top-[3px] h-5 w-5 rounded-full transition-all ${
                      bettingEnabled
                        ? 'left-[23px] bg-white'
                        : 'left-[3px] bg-[#c8d0e0]'
                    }`}
                  />
                </button>
              </div>

              {effectiveMode !== 'spectator' && (
                <div className="mt-4">
                  <label
                    htmlFor="setup-display-name"
                    className="mb-1.5 block text-[14px] font-semibold text-white"
                  >
                    Your name
                  </label>
                  <input
                    id="setup-display-name"
                    type="text"
                    maxLength={40}
                    value={humanName}
                    onChange={(e) => setHumanName(e.target.value)}
                    className="w-full rounded-xl border border-white/15 bg-[#0b1020] px-3.5 py-2.5 text-[15px] text-white focus:border-[#22c55e] focus:outline-none"
                  />
                </div>
              )}

              <button
                type="button"
                data-testid="play-button"
                disabled={starting}
                onClick={handleStartFromSetup}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-[14px] bg-[#22c55e] px-6 py-4 text-[17px] font-bold text-[#052e14] shadow-[0_8px_24px_rgba(34,197,94,0.25)] hover:bg-[#34d369] disabled:opacity-50 transition"
              >
                <Play className="h-4 w-4 fill-current" />
                <span>{startButtonLabel}</span>
              </button>
            </aside>
          </div>
        </div>
      )}

      {settingsModalTab && (
        <SettingsModal
          initialTab={settingsModalTab}
          humanName={humanName}
          provider={provider}
          maxStepsPerRound={maxStepsPerRound}
          timeoutSec={timeoutSec}
          health={health}
          mcpStatus={mcpStatus}
          agyRunner={agyRunner}
          onSaveGeneral={(patch) => {
            setHumanName(patch.humanName);
            setProvider(patch.provider);
            setMaxStepsPerRound(patch.maxStepsPerRound);
            setTimeoutSec(patch.timeoutSec);
          }}
          onClose={() => setSettingsModalTab(null)}
        />
      )}
    </div>
  );
}
