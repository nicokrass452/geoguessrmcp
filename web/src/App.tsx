import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Check,
  Clock,
  Copy,
  Home,
  Link2,
  Play,
  User,
  Users,
} from 'lucide-react';
import type {
  HealthInfo,
  MoveDirection,
  PublicGameState,
} from '@geoguessr-mcp/shared';
import { api, type StartMatchPayload } from './lib/api';

function mergeHttpState(
  prev: PublicGameState | null,
  next: PublicGameState
): PublicGameState {
  if (!prev || prev.matchId !== next.matchId) {
    return next;
  }
  if (prev.currentRoundNumber > next.currentRoundNumber) {
    return prev;
  }
  if (
    prev.currentRoundNumber === next.currentRoundNumber &&
    (prev.roundStatus === 'round_over' || prev.matchStatus === 'finished') &&
    next.roundStatus === 'active'
  ) {
    return prev;
  }
  return next;
}
import {
  buildRoomInviteUrl,
  clearSavedRoomSession,
  copyTextToClipboard,
  getAutoJoinPlayerName,
  getSessionPlayerId,
  getSessionPlayerName,
  getSessionToken,
  getSessionViewMode,
  getUrlRoomCode,
  restoreRoomSessionToTab,
  saveRoomSession,
  setSessionPlayerName,
  setSessionViewMode,
  syncUrlRoomCode,
} from './lib/playerSession';
import { useGameSocket } from './lib/useGameSocket';
import { AgentHud } from './components/AgentHud';
import { FinalLeaderboardModal } from './components/FinalLeaderboardModal';
import { GuessingMiniMap } from './components/GuessingMiniMap';
import { LobbyModal } from './components/LobbyModal';
import { PanoramaViewer } from './components/PanoramaViewer';
import { RoundSummaryOverlay } from './components/RoundSummaryOverlay';
import { SpectatorStage } from './components/SpectatorStage';
import { TopHud } from './components/TopHud';
import { WelcomeHub } from './components/WelcomeHub';

export default function App() {
  const {
    playerId,
    setPlayerId,
    setSessionToken,
    roomCode,
    setRoomCode,
    state,
    setState,
    wsConnected,
    error,
    setError,
  } = useGameSocket();

  const [view, setViewState] = useState<'home' | 'arena'>(() =>
    getSessionViewMode()
  );
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [busyAction, setBusyAction] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [autoJoiningCode, setAutoJoiningCode] = useState<string | null>(() =>
    getUrlRoomCode()
  );
  const [lobbyNameDraft, setLobbyNameDraft] = useState<string>(() =>
    getSessionPlayerName()
  );
  const handledUrlRoomRef = useRef<string | null>(null);
  const copyCodeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyLinkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyCodeTimerRef.current) clearTimeout(copyCodeTimerRef.current);
      if (copyLinkTimerRef.current) clearTimeout(copyLinkTimerRef.current);
    };
  }, []);

  const setView = useCallback((next: 'home' | 'arena') => {
    setSessionViewMode(next);
    setViewState(next);
  }, []);

  useEffect(() => {
    if (health) return;
    api.getHealth().then(setHealth).catch(() => {});
  }, [health, wsConnected]);

  useEffect(() => {
    if (state?.human?.name) {
      setLobbyNameDraft(state.human.name);
    }
  }, [state?.matchId, state?.roomCode, state?.human?.name]);

  useEffect(() => {
    if (getSessionToken() || getUrlRoomCode()) return;
    let cancelled = false;
    api
      .ensureSession()
      .then((session) => {
        if (cancelled) return;
        if (session.sessionToken) {
          setSessionToken(session.sessionToken);
        }
        if (session.playerId) {
          setPlayerId(session.playerId);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [setPlayerId, setSessionToken]);

  useEffect(() => {
    let cancelled = false;
    let pendingCode: string | null = null;
    let settled = true;

    const tryJoinFromUrl = () => {
      if (cancelled) return;
      const urlCode = getUrlRoomCode();
      if (!urlCode) {
        handledUrlRoomRef.current = null;
        setAutoJoiningCode(null);
        return;
      }
      if (handledUrlRoomRef.current === urlCode) {
        setAutoJoiningCode(null);
        return;
      }
      handledUrlRoomRef.current = urlCode;
      pendingCode = urlCode;
      settled = false;
      setAutoJoiningCode(urlCode);
      const restored = restoreRoomSessionToTab(urlCode);
      const currentPid = getSessionPlayerId();
      const activePlayerId = restored?.playerId || currentPid;
      if (restored?.sessionToken) {
        setSessionToken(restored.sessionToken);
      }
      if (restored?.playerId && restored.playerId !== currentPid) {
        setPlayerId(restored.playerId);
      }
      const joinName = restored?.playerName || getAutoJoinPlayerName();
      setSessionPlayerName(joinName);
      setLobbyNameDraft(joinName);
      api
        .joinRoom(urlCode, joinName, activePlayerId, {
          preserveExistingName: true,
        })
        .then((joined) => {
          settled = true;
          if (cancelled) return;
          handledUrlRoomRef.current = joined.roomCode;
          if (joined.sessionToken) {
            setSessionToken(joined.sessionToken);
          }
          setPlayerId(joined.playerId);
          saveRoomSession(joined.roomCode, {
            playerId: joined.playerId,
            sessionToken: joined.sessionToken || getSessionToken(),
            playerName: joined.state.human.name,
            isCreator: Boolean(joined.state.human.isHost),
          });
          setRoomCode(joined.roomCode);
          syncUrlRoomCode(joined.roomCode);
          setState(joined.state);
          setLobbyNameDraft(joined.state.human.name);
          setShowSetup(false);
          setError(null);
          setView('arena');
        })
        .catch((err) => {
          settled = true;
          if (cancelled) return;
          const msg = err instanceof Error ? err.message : String(err);
          handledUrlRoomRef.current = null;
          if (
            msg.includes('Unknown roomCode') ||
            msg.includes('Valid session token required')
          ) {
            if (msg.includes('Valid session token required')) {
              setSessionToken(null);
            }
            clearSavedRoomSession(urlCode);
            syncUrlRoomCode(null);
            setRoomCode(null);
          }
          setView('home');
          setError(
            msg.includes('Unknown roomCode')
              ? `Room "${urlCode}" was not found or has expired. Create a new room or enter an active code.`
              : msg
          );
        })
        .finally(() => {
          settled = true;
          if (cancelled) return;
          setAutoJoiningCode(null);
        });
    };

    tryJoinFromUrl();
    window.addEventListener('popstate', tryJoinFromUrl);
    return () => {
      cancelled = true;
      if (!settled && pendingCode && handledUrlRoomRef.current === pendingCode) {
        handledUrlRoomRef.current = null;
      }
      window.removeEventListener('popstate', tryJoinFromUrl);
    };
  }, [setPlayerId, setSessionToken, setRoomCode, setState, setView, setError]);

  const handleCameraChange = useCallback(
    (heading: number, pitch: number, zoom: number) => {
      api.updateHumanCamera(heading, pitch, zoom).catch(() => {});
    },
    []
  );

  const handleMove = useCallback(
    async (opts: { direction?: MoveDirection; nodeId?: string }) => {
      try {
        const next = await api.moveHuman(opts);
        setState((prev) => mergeHttpState(prev, next));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [setState, setError]
  );

  const handleReturnToStart = useCallback(async () => {
    try {
      const next = await api.returnToStart();
      setState((prev) => mergeHttpState(prev, next));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [setState, setError]);

  const handleSubmitGuess = useCallback(
    async (latitude: number, longitude: number, wager?: number) => {
      setBusyAction(true);
      try {
        const next = await api.submitHumanGuess(latitude, longitude, wager);
        setState((prev) => mergeHttpState(prev, next));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusyAction(false);
      }
    },
    [setState, setError]
  );

  const handleForceEndRound = useCallback(async () => {
    setBusyAction(true);
    try {
      const next = await api.endRound(state?.roomCode || roomCode);
      setState(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(false);
    }
  }, [state?.roomCode, roomCode, setState, setError]);

  const handleNextRound = useCallback(async () => {
    setBusyAction(true);
    try {
      const next = await api.nextRound(state?.roomCode || roomCode);
      setState(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(false);
    }
  }, [state?.roomCode, roomCode, setState, setError]);

  const handleStartNewMatch = useCallback(
    async (opts: StartMatchPayload) => {
      setBusyAction(true);
      setError(null);
      try {
        setSessionPlayerName(opts.humanName);
        const next = await api.startNewMatch({
          ...opts,
          playerId,
        });
        handledUrlRoomRef.current = next.roomCode;
        setRoomCode(next.roomCode);
        syncUrlRoomCode(next.roomCode);
        setState(next);
        setLobbyNameDraft(next.human.name);
        setShowSetup(false);
        setView('arena');
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusyAction(false);
      }
    },
    [playerId, setRoomCode, setState, setView, setError]
  );

  const handleCreateRoom = useCallback(
    async (opts: StartMatchPayload) => {
      setBusyAction(true);
      setError(null);
      try {
        setSessionPlayerName(opts.humanName);
        const created = await api.createRoom({
          ...opts,
          playerId,
          autoStart: false,
        });
        if (created.sessionToken) {
          setSessionToken(created.sessionToken);
        }
        setPlayerId(created.hostPlayerId);
        saveRoomSession(created.roomCode, {
          playerId: created.hostPlayerId,
          sessionToken: created.sessionToken || getSessionToken(),
          playerName: created.state.human.name,
          isCreator: true,
        });
        handledUrlRoomRef.current = created.roomCode;
        setRoomCode(created.roomCode);
        syncUrlRoomCode(created.roomCode);
        setState(created.state);
        setLobbyNameDraft(created.state.human.name);
        setShowSetup(false);
        setView('arena');
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusyAction(false);
      }
    },
    [playerId, setPlayerId, setSessionToken, setRoomCode, setState, setView, setError]
  );

  const handleJoinRoom = useCallback(
    async (targetCode: string, playerName: string) => {
      setBusyAction(true);
      setError(null);
      try {
        setSessionPlayerName(playerName);
        const joined = await api.joinRoom(targetCode, playerName, playerId);
        if (joined.sessionToken) {
          setSessionToken(joined.sessionToken);
        }
        setPlayerId(joined.playerId);
        saveRoomSession(joined.roomCode, {
          playerId: joined.playerId,
          sessionToken: joined.sessionToken || getSessionToken(),
          playerName: joined.state.human.name,
          isCreator: Boolean(joined.state.human.isHost),
        });
        handledUrlRoomRef.current = joined.roomCode;
        setRoomCode(joined.roomCode);
        syncUrlRoomCode(joined.roomCode);
        setState(joined.state);
        setLobbyNameDraft(joined.state.human.name);
        setShowSetup(false);
        setView('arena');
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusyAction(false);
      }
    },
    [playerId, setPlayerId, setSessionToken, setRoomCode, setState, setView, setError]
  );

  const handleStartWaitingRoom = useCallback(async () => {
    const activeCode = state?.roomCode || roomCode;
    if (!activeCode) return;
    setBusyAction(true);
    setError(null);
    try {
      const started = await api.startRoom(activeCode, playerId);
      setState(started.state);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(false);
    }
  }, [state?.roomCode, roomCode, playerId, setState, setError]);

  const handleReturnHome = useCallback(async () => {
    const activeCode = state?.roomCode || roomCode;
    if (activeCode) {
      await api.leaveRoom(activeCode, playerId).catch(() => {});
      clearSavedRoomSession(activeCode, playerId);
    }
    await api.stopAgyRuns().catch(() => {});
    handledUrlRoomRef.current = null;
    syncUrlRoomCode(null);
    setRoomCode(null);
    setShowSetup(false);
    setError(null);
    setView('home');
  }, [state?.roomCode, roomCode, playerId, setRoomCode, setError, setView]);

  const handleSummonSpectatorAi = useCallback(async () => {
    try {
      await api.triggerAgyRound();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [setError]);

  // 0. Auto-Joining Room via URL Link (?room=CODE)
  if (autoJoiningCode) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center bg-slate-950 text-slate-200 gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent" />
        <p className="text-sm font-semibold text-slate-200">
          Joining Room{' '}
          <span className="font-mono text-emerald-400">{autoJoiningCode}</span>
          ...
        </p>
      </div>
    );
  }

  // 1. Welcome Hub View
  if (view === 'home') {
    return (
      <WelcomeHub
        initialHumanName={
          state?.human.name || getSessionPlayerName() || 'You (Player)'
        }
        initialProvider={state?.provider || health?.defaultProvider || 'auto'}
        health={health}
        mcpStatus={state?.mcpStatus || health?.mcpStatus}
        agyRunner={state?.agyRunner}
        starting={busyAction}
        error={error}
        onClearError={() => setError(null)}
        onStartMatch={handleStartNewMatch}
        onCreateRoom={handleCreateRoom}
        onJoinRoom={handleJoinRoom}
      />
    );
  }

  // 2. Loading Backend State
  if (!state) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center bg-slate-950 text-slate-200 gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-sky-400 border-t-transparent" />
        <p className="text-sm text-slate-400">
          Connecting to GeoGuessr MCP Arena backend...
        </p>
        {error && (
          <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-xs text-rose-300">
            {error}
          </p>
        )}
        <button
          type="button"
          onClick={() => {
            syncUrlRoomCode(null);
            setView('home');
          }}
          className="mt-2 rounded-xl border border-white/15 bg-slate-900 px-4 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800"
        >
          Return to Welcome Hub
        </button>
      </div>
    );
  }

  const isHost =
    !state.hostPlayerId ||
    state.hostPlayerId === playerId ||
    state.human.isHost === true;
  const showAgentHud = state.mode !== 'solo' && state.mode !== 'pvp';

  // 3. Multi-Human Waiting Room Lobby (before Host clicks Start Match)
  if (state.matchStatus === 'lobby') {
    const inviteUrl = state.roomCode ? buildRoomInviteUrl(state.roomCode) : '';
    const trimmedDraft = lobbyNameDraft.trim();
    const canRename =
      trimmedDraft.length > 0 && trimmedDraft !== state.human.name;

    return (
      <main className="flex h-full w-full flex-col overflow-y-auto overflow-x-hidden page-scrollbar bg-slate-950 p-4 sm:p-6 text-slate-100">
        <div className="m-auto w-full max-w-xl rounded-3xl border border-white/15 bg-slate-900 p-5 sm:p-6 shadow-2xl space-y-5">
          <div className="flex items-center justify-between border-b border-white/10 pb-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-500/20 border border-emerald-400/40 text-emerald-300">
                <Users className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-extrabold text-white">
                  Multiplayer Room Lobby ({state.mode.toUpperCase()})
                </h2>
                <p className="text-xs text-slate-400">
                  Share the invite link for instant auto-join, or share the room
                  code to join manually
                </p>
              </div>
            </div>
            <button
              type="button"
              data-testid="quick-return-home"
              onClick={handleReturnHome}
              className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700"
            >
              <Home className="h-3.5 w-3.5 text-sky-400" />
              <span>Home</span>
            </button>
          </div>

          <div className="rounded-2xl border border-emerald-400/30 bg-slate-950 p-4 sm:px-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2.5">
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    Room Code
                  </div>
                  <div
                    data-testid="room-code"
                    aria-label={`Room Code ${state.roomCode}`}
                    className="mt-0.5 font-mono text-2xl font-extrabold tracking-widest text-emerald-400 select-all"
                  >
                    {state.roomCode}
                  </div>
                </div>
                {state.roomCode && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        void copyTextToClipboard(state.roomCode || '').then(
                          (ok) => {
                            if (!ok) return;
                            setCopiedCode(true);
                            if (copyCodeTimerRef.current) {
                              clearTimeout(copyCodeTimerRef.current);
                            }
                            copyCodeTimerRef.current = setTimeout(
                              () => setCopiedCode(false),
                              1800
                            );
                          }
                        );
                      }}
                      className="flex items-center gap-1.5 rounded-xl border border-white/15 bg-slate-900 px-3 py-1.5 text-xs font-bold text-slate-200 hover:border-emerald-400/50 hover:bg-slate-800 transition"
                    >
                      {copiedCode ? (
                        <>
                          <Check className="h-3.5 w-3.5 text-emerald-400" />
                          <span className="text-emerald-300">Code Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5 text-slate-400" />
                          <span>Copy Code</span>
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      data-testid="copy-invite-link"
                      onClick={() => {
                        void copyTextToClipboard(inviteUrl).then((ok) => {
                          if (!ok) return;
                          setCopiedLink(true);
                          if (copyLinkTimerRef.current) {
                            clearTimeout(copyLinkTimerRef.current);
                          }
                          copyLinkTimerRef.current = setTimeout(
                            () => setCopiedLink(false),
                            1800
                          );
                        });
                      }}
                      className="flex items-center gap-1.5 rounded-xl border border-emerald-400/45 bg-emerald-500/20 px-3 py-1.5 text-xs font-bold text-emerald-200 hover:bg-emerald-500/30 transition"
                    >
                      {copiedLink ? (
                        <>
                          <Check className="h-3.5 w-3.5 text-emerald-300" />
                          <span>Link Copied!</span>
                        </>
                      ) : (
                        <>
                          <Link2 className="h-3.5 w-3.5 text-emerald-300" />
                          <span>Copy Invite Link</span>
                        </>
                      )}
                    </button>
                  </>
                )}
              </div>
              <div className="text-right text-xs text-slate-400">
                <div>{state.totalRounds} Rounds</div>
                <div>
                  {state.locationMode === 'big_cities'
                    ? 'Big Cities Only'
                    : state.locationMode === 'mountain_regions'
                      ? 'Mountain Regions Only'
                      : 'Standard'}
                </div>
              </div>
            </div>

            {inviteUrl && (
              <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2 text-[11px] font-mono text-sky-300 overflow-x-auto custom-scrollbar">
                <Link2 className="h-3.5 w-3.5 shrink-0 text-sky-400" />
                <span className="select-all whitespace-nowrap">{inviteUrl}</span>
              </div>
            )}
          </div>

          {/* Inline Display Name Customizer (especially handy after URL auto-join) */}
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label
                htmlFor="lobby-display-name"
                className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-400"
              >
                Your Display Name
              </label>
              <input
                id="lobby-display-name"
                type="text"
                maxLength={40}
                value={lobbyNameDraft}
                onChange={(e) => setLobbyNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && canRename && state.roomCode) {
                    handleJoinRoom(state.roomCode, trimmedDraft);
                  }
                }}
                className="w-full rounded-xl border border-white/15 bg-slate-950 px-3 py-2 text-xs text-white focus:border-sky-400 focus:outline-none"
              />
            </div>
            <button
              type="button"
              disabled={!canRename || busyAction || !state.roomCode}
              onClick={() => {
                if (state.roomCode && canRename) {
                  handleJoinRoom(state.roomCode, trimmedDraft);
                }
              }}
              className="rounded-xl border border-sky-400/40 bg-sky-500/20 px-3.5 py-2 text-xs font-bold text-sky-200 hover:bg-sky-500/30 disabled:opacity-40 transition"
            >
              Update Name
            </button>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Connected Human Players ({state.humans.length})
            </div>
            <div className="space-y-2">
              {state.humans.map((h) => (
                <div
                  key={h.id}
                  className="flex items-center justify-between rounded-xl border border-white/10 bg-slate-950/70 px-4 py-2.5"
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: h.color }}
                    />
                    <User className="h-4 w-4 text-sky-400" />
                    <span className="text-sm font-bold text-white">
                      {h.name}
                    </span>
                    {h.id === playerId && (
                      <span className="rounded bg-sky-500/20 px-1.5 py-0.5 text-[10px] font-bold text-sky-300">
                        You
                      </span>
                    )}
                  </div>
                  {h.isHost && (
                    <span className="rounded-full border border-amber-400/30 bg-amber-500/15 px-2.5 py-0.5 text-[10px] font-bold text-amber-300">
                      Host
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-white/10 pt-4">
            {isHost ? (
              <button
                type="button"
                data-testid="lobby-start-match"
                disabled={busyAction}
                onClick={handleStartWaitingRoom}
                className="flex items-center gap-2 rounded-2xl bg-emerald-500 px-6 py-3 text-sm font-extrabold text-slate-950 hover:bg-emerald-400 disabled:opacity-50 transition"
              >
                <Play className="h-4 w-4 fill-current" />
                <span>{busyAction ? 'Starting...' : 'Start Match'}</span>
              </button>
            ) : (
              <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-800/80 px-4 py-2.5 text-xs font-semibold text-slate-300">
                <Clock className="h-4 w-4 text-amber-400" />
                <span>Waiting for host to start match...</span>
              </div>
            )}
          </div>
        </div>
      </main>
    );
  }

  // 4. Active Arena / Spectator Stage
  return (
    <main className="relative h-full w-full overflow-hidden bg-slate-950">
      {state.mode === 'spectator' ? (
        <SpectatorStage
          roundNumber={state.currentRoundNumber}
          totalRounds={state.totalRounds}
          roundStatus={state.roundStatus}
          agents={state.agents}
          bettingEnabled={state.bettingEnabled}
          agyRunner={state.agyRunner}
          onSummonAi={handleSummonSpectatorAi}
          onForceEndRound={handleForceEndRound}
        />
      ) : (
        <PanoramaViewer
          panoramaUrl={state.human.panoramaUrl}
          currentNodeId={state.human.currentNodeId}
          spawnNodeId={state.human.spawnNodeId}
          initialCamera={state.human.camera}
          availableMoves={state.human.availableMoves}
          mapillaryImageId={state.human.mapillaryImageId}
          // Server-side Mapillary equirectangular panoramas load via /api/panoramas/... without exposing server tokens
          mapillaryAccessToken={
            import.meta.env.VITE_MAPILLARY_CLIENT_TOKEN || null
          }
          disabled={
            state.roundStatus === 'round_over' ||
            state.matchStatus === 'finished'
          }
          onCameraChange={handleCameraChange}
          onMove={handleMove}
          onReturnToStart={handleReturnToStart}
        />
      )}

      <TopHud
        state={state}
        wsConnected={wsConnected}
        onOpenSettings={() => setShowSetup(true)}
        onReturnHome={handleReturnHome}
      />

      {showAgentHud && (
        <AgentHud
          agents={state.agents}
          activityFeed={state.activityFeed}
          agyRunner={state.agyRunner}
          roundStatus={state.roundStatus}
          onError={setError}
        />
      )}

      {state.mode !== 'spectator' &&
        state.roundStatus === 'active' &&
        state.matchStatus === 'active' && (
          <GuessingMiniMap
            roundNumber={state.currentRoundNumber}
            hasGuessed={state.human.hasGuessed}
            myGuess={state.human.myGuess}
            agents={state.agents}
            submitting={busyAction}
            onSubmitGuess={handleSubmitGuess}
            onForceEndRound={handleForceEndRound}
            bettingEnabled={state.bettingEnabled}
            chips={state.human.chips}
            currentWager={state.human.currentWager}
            humans={state.humans}
            selfPlayerId={state.human.id}
          />
        )}

      {error && (
        <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 flex items-center gap-3 rounded-xl border border-rose-500/40 bg-slate-950/95 px-4 py-2 text-xs text-rose-300 shadow-2xl">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="font-bold text-slate-400 hover:text-white"
          >
            ✕
          </button>
        </div>
      )}

      {state.roundStatus === 'round_over' &&
        state.matchStatus !== 'finished' &&
        state.roundSummary && (
          <RoundSummaryOverlay
            summary={state.roundSummary}
            roundNumber={state.currentRoundNumber}
            totalRounds={state.totalRounds}
            advancing={busyAction}
            onNextRound={handleNextRound}
            bettingEnabled={state.bettingEnabled}
            isHost={isHost}
            isSpectator={state.mode === 'spectator'}
          />
        )}

      {state.matchStatus === 'finished' && (
        <FinalLeaderboardModal
          entries={state.leaderboard}
          totalRounds={state.totalRounds}
          bettingEnabled={state.bettingEnabled}
          onPlayAgain={() =>
            handleStartNewMatch({
              mode: state.mode,
              locationMode: state.locationMode,
              bettingEnabled: state.bettingEnabled,
              totalRounds: state.totalRounds,
              roundDurationSec: state.roundDurationSec,
              provider: state.provider,
              humanName: state.human.name,
            })
          }
          onOpenSetup={() => setShowSetup(true)}
          onReturnHome={handleReturnHome}
        />
      )}

      {showSetup && (
        <LobbyModal
          initialMode={state.mode}
          initialLocationMode={state.locationMode}
          initialBettingEnabled={state.bettingEnabled}
          initialRounds={state.totalRounds}
          initialDuration={state.roundDurationSec}
          initialProvider={state.provider}
          initialHumanName={state.human.name}
          health={health}
          starting={busyAction}
          onStart={handleStartNewMatch}
          onClose={() => setShowSetup(false)}
        />
      )}
    </main>
  );
}
