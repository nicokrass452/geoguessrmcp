import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Coins,
  Compass,
  Eye,
  KeyRound,
  Play,
  Plus,
  Settings,
  SlidersHorizontal,
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
import { calculateScore, haversineDistanceKm } from '@geoguessr-mcp/shared';
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
import { Logo } from './Logo';
import { project, WorldMap } from './WorldMap';

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
    ? 'bg-[#ff7a2f]'
    : mcpStatus?.status === 'bridge_ready'
      ? 'bg-[#e3b65c]'
      : 'bg-[#8a91a3]';
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

  const segWrap =
    'inline-flex flex-wrap gap-1 rounded-[10px] border border-white/[0.08] bg-[#0b0d14] p-1';
  const segItem = (active: boolean) =>
    `h-8 rounded-md px-3 text-[14px] font-medium ${
      active
        ? 'bg-[#1a1e28] text-[#eef0f5] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]'
        : 'text-[#8a91a3] hover:text-[#eef0f5]'
    }`;
  const btnPrimary =
    'inline-flex h-11 items-center justify-center gap-2 rounded-[10px] bg-[#ff7a2f] px-5 text-[15px] font-medium text-[#1f0e03] shadow-[inset_0_1px_0_rgba(255,255,255,0.25)] hover:bg-[#ff8d4d] disabled:opacity-50';
  const btnSecondary =
    'inline-flex h-11 items-center justify-center gap-2 rounded-[10px] border border-white/[0.08] bg-[#1a1e28] px-5 text-[15px] font-medium text-[#eef0f5] hover:bg-[#222734]';
  const btnSmall =
    'inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-white/[0.08] bg-[#1a1e28] px-4 text-[14px] font-medium text-[#eef0f5] hover:bg-[#222734]';
  const inputCls =
    'h-10 w-full rounded-[10px] border border-white/[0.08] bg-[#0b0d14] px-3 text-[15px] text-[#eef0f5] placeholder:text-[#8a91a3]/60 focus:border-[#ff7a2f]/70 focus:outline-none';
  const cardKeyDown =
    (target: SetupFlowMode) => (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openSetupFor(target);
      }
    };
  const iconCls = 'h-[18px] w-[18px] text-[#a3a9b8]';

  return (
    <div className="geo-bg h-full w-full overflow-y-auto overflow-x-hidden page-scrollbar text-[#eef0f5]">
      {/* Top nav */}
      <nav className="mx-auto flex h-16 max-w-[1240px] items-center justify-between px-4 sm:px-8">
        <button
          type="button"
          onClick={() => setSubView('home')}
          aria-label="GeoArena home"
          className="rounded-md"
        >
          <Logo />
        </button>

        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="welcome-mcp-badge"
            onClick={() => setSettingsModalTab('developer')}
            className="inline-flex h-8 items-center gap-2 rounded-lg px-3 text-[13px] text-[#a3a9b8] hover:bg-white/[0.05] hover:text-[#eef0f5]"
          >
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${statusDotCls}`} />
            <span>{statusChipLabel}</span>
          </button>

          <button
            type="button"
            onClick={() => setSettingsModalTab('general')}
            className="inline-flex h-8 items-center gap-2 rounded-lg px-3 text-[13px] text-[#a3a9b8] hover:bg-white/[0.05] hover:text-[#eef0f5]"
          >
            <Settings className="h-4 w-4" strokeWidth={1.5} />
            <span className="hidden sm:inline">Settings</span>
          </button>

          <button
            type="button"
            onClick={() => setSettingsModalTab('general')}
            title="Edit display name"
            className="ml-1 grid h-8 w-8 place-items-center rounded-full bg-[#60a5fa] text-[12px] font-medium text-[#0b0d14] hover:opacity-90"
          >
            {getPlayerInitials(humanName)}
          </button>
        </div>
      </nav>

      {error && (
        <div className="mx-auto mb-4 max-w-[1240px] px-4 sm:px-8">
          <div
            role="alert"
            className="flex items-center justify-between gap-3 rounded-xl border border-[#e5484d]/30 bg-[#e5484d]/[0.08] px-4 py-3 text-[14px] text-[#eef0f5]"
          >
            <span>{error}</span>
            <button
              type="button"
              onClick={onClearError}
              aria-label="Dismiss"
              className="grid h-7 w-7 place-items-center rounded-md text-[#a3a9b8] hover:bg-white/10 hover:text-[#eef0f5]"
            >
              <X className="h-4 w-4" strokeWidth={1.5} />
            </button>
          </div>
        </div>
      )}

      {subView === 'home' ? (
        <main className="mx-auto max-w-[1240px] px-4 pb-16 sm:px-8">
          {/* Hero: text left, a finished round on the right */}
          <section className="geo-rise grid items-center gap-10 pt-8 pb-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-16 lg:pt-12 lg:pb-16">
            <div>
              <div className="geo-coord mb-5 text-[12px] text-[#8a91a3]">
                360° street view · humans vs AI models
              </div>
              <h1 className="max-w-[560px] text-[40px] font-medium leading-[1.05] tracking-[-0.02em] text-[#eef0f5] sm:text-[56px] sm:tracking-[-0.03em]">
                Where in the world are you?
              </h1>
              <p className="mt-5 max-w-[480px] text-[18px] leading-[28px] text-[#a3a9b8]">
                Drop into a random 360° street view, look around and pin your
                guess on the map. Beat your friends, or race Gemini and Claude
                to the right spot
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  data-testid="quick-play-button"
                  disabled={starting}
                  onClick={handleQuickPlayVsAi}
                  className={btnPrimary}
                >
                  <Play className="h-4 w-4 fill-current" strokeWidth={1.5} />
                  <span>{starting ? 'Starting…' : 'Quick play vs AI'}</span>
                </button>
                <div
                  role="button"
                  tabIndex={0}
                  data-testid="mode-card-player_vs_ai"
                  onClick={() => openSetupFor('player_vs_ai')}
                  onKeyDown={cardKeyDown('player_vs_ai')}
                  className={btnSecondary}
                >
                  Choose opponents
                </div>
              </div>
            </div>

            <RoundPreview />
          </section>

          {/* Other ways to play */}
          <section className="grid gap-4 md:grid-cols-3">
            <div
              role="button"
              tabIndex={0}
              data-testid="mode-card-pvp_ai"
              onClick={() => openSetupFor('friends')}
              onKeyDown={cardKeyDown('friends')}
              className="geo-card flex flex-col gap-2 p-6 hover:border-white/[0.16] hover:bg-[#141821]"
            >
              <Users className={iconCls} strokeWidth={1.5} />
              <h2 className="mt-2 text-[17px] font-medium text-[#eef0f5]">
                Play with friends
              </h2>
              <p className="text-[14px] leading-[20px] text-[#a3a9b8]">
                Create a private room and share a link. Add AI players if you
                want
              </p>
              <div className="mt-auto pt-4">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    openSetupFor('friends');
                  }}
                  className={btnSmall}
                >
                  Create room
                </button>
              </div>
            </div>

            <div
              role="button"
              tabIndex={0}
              data-testid="mode-card-spectator"
              onClick={() => openSetupFor('spectator')}
              onKeyDown={cardKeyDown('spectator')}
              className="geo-card flex flex-col gap-2 p-6 hover:border-white/[0.16] hover:bg-[#141821]"
            >
              <Eye className={iconCls} strokeWidth={1.5} />
              <h2 className="mt-2 text-[17px] font-medium text-[#eef0f5]">
                Watch the AIs
              </h2>
              <p className="text-[14px] leading-[20px] text-[#a3a9b8]">
                Sit back and see how the models reason their way around the
                globe
              </p>
              <div className="mt-auto pt-4">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    openSetupFor('spectator');
                  }}
                  className={btnSmall}
                >
                  Start show
                </button>
              </div>
            </div>

            <div
              role="button"
              tabIndex={0}
              data-testid="mode-card-solo"
              onClick={() => openSetupFor('solo')}
              onKeyDown={cardKeyDown('solo')}
              className="geo-card flex flex-col gap-2 p-6 hover:border-white/[0.16] hover:bg-[#141821]"
            >
              <Compass className={iconCls} strokeWidth={1.5} />
              <h2 className="mt-2 text-[17px] font-medium text-[#eef0f5]">
                Solo practice
              </h2>
              <p className="text-[14px] leading-[20px] text-[#a3a9b8]">
                No timer, no pressure. Just you and the map
              </p>
              <div className="mt-auto pt-4">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    openSetupFor('solo');
                  }}
                  className={btnSmall}
                >
                  Practice
                </button>
              </div>
            </div>
          </section>

          {/* Join by code */}
          <section className="geo-card mt-4 flex flex-wrap items-center gap-4 px-6 py-4 sm:flex-nowrap">
            <KeyRound className={iconCls} strokeWidth={1.5} />
            <div className="min-w-[160px]">
              <h3 className="text-[15px] font-medium text-[#eef0f5]">
                Got a room code?
              </h3>
              <p className="text-[13px] text-[#8a91a3]">Or paste an invite link</p>
            </div>
            <div className="flex min-w-[200px] flex-1 gap-2 sm:max-w-[420px] sm:ml-auto">
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
                className={`${inputCls} geo-coord min-w-0 flex-1 uppercase`}
              />
              <button
                type="button"
                data-testid="join-room-submit"
                disabled={starting || extractRoomCodeInput(joinCode).length === 0}
                onClick={handleJoinSubmit}
                className="inline-flex h-10 items-center rounded-[10px] bg-[#eef0f5] px-4 text-[14px] font-medium text-[#0b0d14] hover:bg-white disabled:opacity-40"
              >
                Join
              </button>
            </div>
          </section>

          {/* Quiet footer */}
          <footer className="mt-8 flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-[#8a91a3]">
            {lastGame && (
              <>
                <span>
                  Last game{' '}
                  <span className="geo-coord text-[#a3a9b8]">
                    {lastGame.score.toLocaleString()} pts
                  </span>{' '}
                  · {formatOrdinalRank(lastGame.rank)} of {lastGame.totalPlayers}
                </span>
                <span aria-hidden="true">·</span>
              </>
            )}
            <button
              type="button"
              onClick={() => setSettingsModalTab('developer')}
              className="inline-flex items-center gap-1 rounded-md hover:text-[#eef0f5]"
            >
              Developers: connect your own agent via MCP
              <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
          </footer>
        </main>
      ) : (
        /* Screen 2: Setup */
        <div className="geo-rise mx-auto max-w-[1240px] px-4 pb-16 sm:px-8">
          <button
            type="button"
            onClick={() => setSubView('home')}
            className="-ml-2 mt-2 inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[14px] text-[#a3a9b8] hover:bg-white/[0.05] hover:text-[#eef0f5]"
          >
            <ArrowLeft className="h-4 w-4" strokeWidth={1.5} />
            <span>Back</span>
          </button>

          <h1 className="mt-4 mb-6 text-[32px] font-medium tracking-[-0.02em] text-[#eef0f5]">
            {setupTitle}
          </h1>

          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
            {/* Options */}
            <div className="space-y-4">
              {flowMode !== 'solo' && (
                <div className="geo-card p-6">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-[17px] font-medium text-[#eef0f5]">
                      {flowMode === 'spectator'
                        ? 'Which AI models should compete?'
                        : flowMode === 'friends'
                          ? 'Include AI opponents?'
                          : 'Who do you want to play against?'}
                    </h2>

                    {flowMode === 'player_vs_ai' && (
                      <div className={segWrap}>
                        <button
                          type="button"
                          data-testid="submode-1v1"
                          onClick={() => setAiSubMode('1v1')}
                          className={segItem(aiSubMode === '1v1')}
                        >
                          1 vs 1
                        </button>
                        <button
                          type="button"
                          data-testid="submode-ffa"
                          onClick={() => setAiSubMode('ffa')}
                          className={segItem(aiSubMode === 'ffa')}
                        >
                          Everyone
                        </button>
                      </div>
                    )}

                    {flowMode === 'friends' && (
                      <div className={segWrap}>
                        <button
                          type="button"
                          onClick={() => setFriendsWithAi(false)}
                          className={segItem(!friendsWithAi)}
                        >
                          Friends only
                        </button>
                        <button
                          type="button"
                          onClick={() => setFriendsWithAi(true)}
                          className={segItem(friendsWithAi)}
                        >
                          Friends + AI
                        </button>
                      </div>
                    )}
                  </div>

                  {allowsAi ? (
                    <>
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        {visibleModels.map((m) => {
                          const meta = getModelUiMeta(m.id, m.family, m.label);
                          const isOn = activeSelectedModels.includes(m.id);
                          return (
                            <button
                              key={m.id}
                              type="button"
                              aria-pressed={isOn}
                              onClick={() => toggleModel(m.id)}
                              className={`relative flex flex-col items-center gap-2 rounded-xl border px-3 py-4 text-center ${
                                isOn
                                  ? 'border-[#ff7a2f]/70 bg-[#ff7a2f]/[0.06]'
                                  : 'border-white/[0.08] hover:border-white/[0.18] hover:bg-white/[0.02]'
                              }`}
                            >
                              {isOn && (
                                <span className="absolute top-2 right-2 grid h-5 w-5 place-items-center rounded-full bg-[#ff7a2f] text-[#1f0e03]">
                                  <Check className="h-3 w-3" strokeWidth={2.5} />
                                </span>
                              )}
                              <div
                                style={{ backgroundColor: meta.color }}
                                className="grid h-11 w-11 place-items-center rounded-full text-[15px] font-medium text-[#0b0d14]"
                              >
                                {meta.badge}
                              </div>
                              <span className="text-[14px] font-medium leading-tight text-[#eef0f5]">
                                {meta.shortName}
                              </span>
                              <span className="text-[12px] text-[#8a91a3]">
                                {meta.tierLabel}
                              </span>
                            </button>
                          );
                        })}
                      </div>

                      {hiddenModelCount > 0 && (
                        <button
                          type="button"
                          onClick={() => setShowAllModels((v) => !v)}
                          className="mt-3 inline-flex h-8 items-center gap-1 rounded-lg px-2 -ml-2 text-[13px] text-[#a3a9b8] hover:bg-white/[0.05] hover:text-[#eef0f5]"
                        >
                          {showAllModels ? (
                            <>
                              <ChevronUp className="h-3.5 w-3.5" strokeWidth={1.5} />
                              Show fewer models
                            </>
                          ) : (
                            <>
                              <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
                              {hiddenModelCount} more model{hiddenModelCount === 1 ? "" : "s"}
                            </>
                          )}
                        </button>
                      )}
                    </>
                  ) : (
                    <p className="text-[14px] text-[#a3a9b8]">
                      Human players only. You can still add AI opponents inside
                      the room lobby later.
                    </p>
                  )}
                </div>
              )}

              {/* Map */}
              <div className="geo-card p-6">
                <h2 className="mb-4 text-[17px] font-medium text-[#eef0f5]">Map</h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {(['standard', 'big_cities', 'mountain_regions'] as const).map(
                    (loc) => {
                      const info = LOCATION_META[loc];
                      const active = locationMode === loc;
                      return (
                        <button
                          key={loc}
                          type="button"
                          aria-pressed={active}
                          data-testid={`location-${loc}`}
                          onClick={() => setLocationMode(loc)}
                          className={`overflow-hidden rounded-xl border text-left ${
                            active
                              ? 'border-[#ff7a2f]/70 shadow-[0_0_0_1px_rgba(255,122,47,0.7)]'
                              : 'border-white/[0.08] hover:border-white/[0.18]'
                          }`}
                        >
                          <WorldMap
                            dots={info.dots}
                            viewBox="0 8 360 150"
                            className="block h-[88px] w-full"
                          />
                          <div className="px-3 py-3">
                            <div className="text-[14px] font-medium text-[#eef0f5]">
                              {info.title}
                            </div>
                            <div className="mt-0.5 text-[12px] text-[#8a91a3]">
                              {info.subtitle}
                            </div>
                          </div>
                        </button>
                      );
                    }
                  )}
                </div>
              </div>

              {/* Rounds and timer */}
              <div className="geo-card p-6">
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                  <div>
                    <div className="mb-2 text-[14px] font-medium text-[#eef0f5]">
                      Rounds
                    </div>
                    <div className={segWrap}>
                      {[3, 5, 10].map((r) => (
                        <button
                          key={r}
                          type="button"
                          data-testid={`rounds-${r}`}
                          onClick={() => setTotalRounds(r)}
                          className={`${segItem(totalRounds === r)} tabular min-w-10`}
                        >
                          {r}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="mb-2 text-[14px] font-medium text-[#eef0f5]">
                      Time per round
                    </div>
                    <div className={segWrap}>
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
                          className={segItem(roundDurationSec === opt.value)}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Advanced */}
              <div className="geo-card overflow-hidden">
                <button
                  type="button"
                  aria-expanded={advancedOpen}
                  onClick={() => setAdvancedOpen((v) => !v)}
                  className="flex h-14 w-full items-center gap-3 px-6 text-left text-[15px] hover:bg-white/[0.02]"
                >
                  <SlidersHorizontal className={iconCls} strokeWidth={1.5} />
                  <span className="font-medium text-[#eef0f5]">Advanced</span>
                  <span className="text-[13px] text-[#8a91a3]">
                    Image source, AI move limit
                  </span>
                  <ChevronDown
                    className={`ml-auto h-4 w-4 text-[#8a91a3] transition-transform duration-200 ${
                      advancedOpen ? 'rotate-180' : ''
                    }`}
                    strokeWidth={1.5}
                  />
                </button>

                {advancedOpen && (
                  <div className="grid grid-cols-1 gap-4 border-t border-white/[0.08] px-6 py-5 sm:grid-cols-3">
                    <div>
                      <label
                        htmlFor="setup-provider"
                        className="mb-2 block text-[13px] text-[#a3a9b8]"
                      >
                        Image source
                      </label>
                      <select
                        id="setup-provider"
                        value={provider}
                        onChange={(e) =>
                          setProvider(e.target.value as PanoramaProviderChoice)
                        }
                        className={inputCls}
                      >
                        <option value="auto">Auto (best available)</option>
                        <option value="open">Open 360° procedural</option>
                        <option value="wikimedia">Wikimedia Commons 360°</option>
                        <option value="mapillary">
                          Mapillary 360°{' '}
                          {health?.configuredProviders.mapillary
                            ? '(configured)'
                            : ''}
                        </option>
                        <option value="google">
                          Google Street View{' '}
                          {health?.configuredProviders.google
                            ? '(configured)'
                            : ''}
                        </option>
                      </select>
                    </div>

                    <div>
                      <label
                        htmlFor="setup-step-cap"
                        className="mb-2 block text-[13px] text-[#a3a9b8]"
                      >
                        AI move limit
                      </label>
                      <select
                        id="setup-step-cap"
                        value={String(maxStepsPerRound)}
                        onChange={(e) =>
                          setMaxStepsPerRound(Number(e.target.value))
                        }
                        className={inputCls}
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
                        className="mb-2 block text-[13px] text-[#a3a9b8]"
                      >
                        AI turn timeout
                      </label>
                      <select
                        id="setup-ai-timeout"
                        value={String(timeoutSec)}
                        onChange={(e) => setTimeoutSec(Number(e.target.value))}
                        className={inputCls}
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

            {/* Summary */}
            <aside className="geo-card p-6 lg:sticky lg:top-6">
              <h3 className="mb-2 text-[17px] font-medium text-[#eef0f5]">
                Your game
              </h3>

              <dl className="divide-y divide-white/[0.06] text-[14px]">
                {[
                  ['Opponents', opponentsSummaryText],
                  ['Map', LOCATION_META[locationMode].title],
                  ['Rounds', String(totalRounds)],
                  ['Timer', formatDurationLabel(roundDurationSec)],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3 py-3">
                    <dt className="text-[#8a91a3]">{k}</dt>
                    <dd className="tabular text-right font-medium text-[#eef0f5]">
                      {v}
                    </dd>
                  </div>
                ))}
              </dl>

              <div className="flex items-center gap-4 border-t border-white/[0.06] pt-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 text-[14px] font-medium text-[#eef0f5]">
                    <Coins className="h-4 w-4 text-[#a3a9b8]" strokeWidth={1.5} />
                    <span>Betting</span>
                  </div>
                  <div className="mt-0.5 text-[13px] text-[#8a91a3]">
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
                  className={`relative h-6 w-11 shrink-0 rounded-full ${
                    bettingEnabled ? 'bg-[#ff7a2f]' : 'bg-[#2a2f3b]'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-[#eef0f5] shadow-sm transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] ${
                      bettingEnabled ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {effectiveMode !== 'spectator' && (
                <div className="mt-5">
                  <label
                    htmlFor="setup-display-name"
                    className="mb-2 block text-[13px] text-[#a3a9b8]"
                  >
                    Your name
                  </label>
                  <input
                    id="setup-display-name"
                    type="text"
                    maxLength={40}
                    value={humanName}
                    onChange={(e) => setHumanName(e.target.value)}
                    className={inputCls}
                  />
                </div>
              )}

              <button
                type="button"
                data-testid="play-button"
                disabled={starting}
                onClick={handleStartFromSetup}
                className={`${btnPrimary} mt-6 h-12 w-full text-[16px]`}
              >
                <Play className="h-4 w-4 fill-current" strokeWidth={1.5} />
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

/* ------------------------------------------------------------------ */
/* Hero moment: a finished round, drawn on the map                     */
/* ------------------------------------------------------------------ */

const PREVIEW_TARGET = { city: 'Cape Town', country: 'South Africa', lat: -33.92, lng: 18.42 };

const PREVIEW_GUESSES = [
  { name: 'You', badge: 'YO', color: '#60a5fa', lat: -33.96, lng: 25.6 },
  { name: 'Claude Sonnet', badge: 'C', color: '#f59e0b', lat: -29.86, lng: 31.02 },
  { name: 'Gemini Hydrogen', badge: 'H', color: '#818cf8', lat: -34.6, lng: -58.38 },
].map((g) => {
  const km = haversineDistanceKm(g.lat, g.lng, PREVIEW_TARGET.lat, PREVIEW_TARGET.lng);
  return { ...g, km, score: calculateScore(km) };
}).sort((a, b) => b.score - a.score);

function formatCoord(lat: number, lng: number) {
  const ns = lat < 0 ? 'S' : 'N';
  const ew = lng < 0 ? 'W' : 'E';
  return `${Math.abs(lat).toFixed(2)}° ${ns}  ${Math.abs(lng).toFixed(2)}° ${ew}`;
}

function RoundPreview() {
  const [tx, ty] = project(PREVIEW_TARGET.lng, PREVIEW_TARGET.lat);
  const best = PREVIEW_GUESSES[0];

  return (
    <figure
      aria-label="Example round result"
      className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#11141c] shadow-[0_24px_64px_rgba(0,0,0,0.45)]"
    >
      <div className="flex h-12 items-center justify-between border-b border-white/[0.06] px-5">
        <span className="text-[13px] text-[#a3a9b8]">
          Round 3 of 5 · {PREVIEW_TARGET.city}, {PREVIEW_TARGET.country}
        </span>
        <span className="geo-coord hidden text-[12px] text-[#8a91a3] sm:inline">
          {formatCoord(PREVIEW_TARGET.lat, PREVIEW_TARGET.lng)}
        </span>
      </div>

      <WorldMap viewBox="96 70 144 72" className="block aspect-[2/1] w-full">
        {PREVIEW_GUESSES.map((g) => {
          const [gx, gy] = project(g.lng, g.lat);
          return (
            <g key={g.name}>
              <line
                x1={gx}
                y1={gy}
                x2={tx}
                y2={ty}
                stroke={g.color}
                strokeOpacity="0.8"
                strokeWidth="1.25"
                strokeDasharray="3 3"
                vectorEffect="non-scaling-stroke"
              />
              <circle cx={gx} cy={gy} r="1.5" fill={g.color} stroke="#0b0d14" strokeWidth="0.5" />
            </g>
          );
        })}
        {/* Control flag at the true location */}
        <g transform={`translate(${tx - 2.4} ${ty - 2.4}) scale(0.24)`}>
          <rect x="1" y="1" width="18" height="18" rx="3" fill="#eef0f5" stroke="#0b0d14" strokeWidth="1.5" />
          <path d="M19 1v15a3 3 0 0 1-3 3H1z" fill="#ff7a2f" />
        </g>
      </WorldMap>

      <ol className="divide-y divide-white/[0.06]">
        {PREVIEW_GUESSES.map((g, i) => (
          <li key={g.name} className="flex h-12 items-center gap-3 px-5 text-[14px]">
            <span className="geo-coord w-4 text-[12px] text-[#8a91a3]">{i + 1}</span>
            <span
              style={{ backgroundColor: g.color }}
              className="grid h-6 w-6 place-items-center rounded-full text-[10px] font-medium text-[#0b0d14]"
            >
              {g.badge}
            </span>
            <span className="flex-1 truncate text-[#eef0f5]">{g.name}</span>
            <span className="geo-coord w-24 text-right text-[13px] text-[#a3a9b8]">
              {Math.round(g.km).toLocaleString()} km
            </span>
            <span
              className={`geo-coord w-16 text-right text-[13px] ${
                g === best ? 'text-[#ff7a2f]' : 'text-[#eef0f5]'
              }`}
            >
              {g.score.toLocaleString()}
            </span>
          </li>
        ))}
      </ol>
    </figure>
  );
}
