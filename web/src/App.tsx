import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  HealthInfo,
  MoveDirection,
  PublicGameState,
} from '@geoguessr-mcp/shared';
import { api, type StartMatchPayload } from './lib/api';
import {
  clearSavedRoomSession,
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
import { saveLastGameSummary } from './lib/uiHelpers';
import { useGameSocket } from './lib/useGameSocket';
import { AgentHud } from './components/AgentHud';
import { FinalLeaderboardModal } from './components/FinalLeaderboardModal';
import { GuessingMiniMap } from './components/GuessingMiniMap';
import { LobbyModal } from './components/LobbyModal';
import { PanoramaViewer } from './components/PanoramaViewer';
import { RoundSummaryOverlay } from './components/RoundSummaryOverlay';
import { SettingsModal } from './components/SettingsModal';
import { SpectatorStage } from './components/SpectatorStage';
import { TopHud } from './components/TopHud';
import { WaitingRoomLobby } from './components/WaitingRoomLobby';
import { WelcomeHub } from './components/WelcomeHub';

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
  const [homeAgyRunner, setHomeAgyRunner] = useState<
    import('@geoguessr-mcp/shared').AgyRunnerStatus | undefined
  >(undefined);
  const [showSetup, setShowSetup] = useState(false);
  const [showDeveloperModal, setShowDeveloperModal] = useState(false);
  const [busyAction, setBusyAction] = useState(false);
  const [autoJoiningCode, setAutoJoiningCode] = useState<string | null>(() =>
    getUrlRoomCode()
  );
  const handledUrlRoomRef = useRef<string | null>(null);
  const savedFinishMatchRef = useRef<string | null>(null);

  const setView = useCallback((next: 'home' | 'arena') => {
    setSessionViewMode(next);
    setViewState(next);
  }, []);

  useEffect(() => {
    if (!health) {
      api.getHealth().then(setHealth).catch(() => {});
    }
    if (!homeAgyRunner && !state?.agyRunner) {
      api.getAgyStatus().then(setHomeAgyRunner).catch(() => {});
    }
  }, [health, homeAgyRunner, state?.agyRunner, wsConnected]);

  const handleRefreshModels = useCallback(async () => {
    try {
      const updated = await api.refreshAgyModels();
      setHomeAgyRunner(updated);
      setState((prev) =>
        prev ? { ...prev, agyRunner: updated } : prev
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [setError, setState]);

  // Save last game summary for Home screen footer
  useEffect(() => {
    if (
      state?.matchStatus === 'finished' &&
      state.leaderboard.length > 0 &&
      savedFinishMatchRef.current !== state.matchId
    ) {
      savedFinishMatchRef.current = state.matchId;
      const targetEntry =
        state.mode === 'spectator'
          ? state.leaderboard[0]
          : state.leaderboard.find((e) => e.playerId === state.human.id) ??
            state.leaderboard[0];
      if (targetEntry) {
        saveLastGameSummary({
          score: targetEntry.totalScore,
          rank: targetEntry.rank,
          totalPlayers: state.leaderboard.length,
          savedAt: new Date().toISOString(),
        });
      }
    }
  }, [state]);

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
    setShowDeveloperModal(false);
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
      <div className="geo-bg flex h-full w-full flex-col items-center justify-center text-[#eef1f8] gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#22c55e] border-t-transparent" />
        <p className="text-sm font-semibold">
          Joining room{' '}
          <span className="font-mono text-[#22c55e]">{autoJoiningCode}</span>…
        </p>
      </div>
    );
  }

  // 1. Welcome Hub View (Home + Setup)
  if (view === 'home') {
    return (
      <WelcomeHub
        initialHumanName={
          state?.human.name || getSessionPlayerName() || 'You'
        }
        initialProvider={state?.provider || health?.defaultProvider || 'auto'}
        health={health}
        mcpStatus={state?.mcpStatus || health?.mcpStatus}
        agyRunner={state?.agyRunner ?? homeAgyRunner}
        onRefreshModels={handleRefreshModels}
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
      <div className="geo-bg flex h-full w-full flex-col items-center justify-center text-[#eef1f8] gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#22c55e] border-t-transparent" />
        <p className="text-sm text-[#8d97ae]">Connecting to GeoArena…</p>
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
          className="mt-2 rounded-xl border border-white/15 bg-[#121a2e] px-4 py-2 text-sm font-semibold text-white hover:bg-[#18223a]"
        >
          Back to home
        </button>
      </div>
    );
  }

  const isHost =
    !state.hostPlayerId ||
    state.hostPlayerId === playerId ||
    state.human.isHost === true;
  const showAiControls = state.mode !== 'solo' && state.mode !== 'pvp';
  const isMultiHuman =
    state.mode === 'pvp' ||
    state.mode === 'pvp_ai' ||
    state.humans.length > 1;
  const showPlayersList =
    state.mode !== 'spectator' && (showAiControls || isMultiHuman);

  // 3. Multi-Human Waiting Room Lobby
  if (state.matchStatus === 'lobby') {
    return (
      <>
        <WaitingRoomLobby
          state={state}
          playerId={playerId}
          isHost={isHost}
          busyAction={busyAction}
          onStartMatch={handleStartWaitingRoom}
          onLeaveRoom={handleReturnHome}
          onRenamePlayer={(nextName) => {
            if (state.roomCode) {
              void handleJoinRoom(state.roomCode, nextName);
            }
          }}
          onOpenEditRules={() => setShowSetup(true)}
          onError={setError}
        />
        {showSetup && (
          <LobbyModal
            initialMode={state.mode}
            initialLocationMode={state.locationMode}
            initialBettingEnabled={state.bettingEnabled}
            initialRounds={state.totalRounds}
            initialDuration={state.roundDurationSec}
            initialProvider={state.provider}
            initialHumanName={state.human.name}
            agyRunner={state.agyRunner}
            health={health}
            starting={busyAction}
            onStart={(opts) => {
              if (opts.mode === 'pvp' || opts.mode === 'pvp_ai') {
                void handleCreateRoom({ ...opts, autoStart: false });
              } else {
                void handleStartNewMatch(opts);
              }
            }}
            onClose={() => setShowSetup(false)}
          />
        )}
      </>
    );
  }

  // 4. Active Arena / Spectator Stage
  const allowAiForPlayAgain = state.mode !== 'solo' && state.mode !== 'pvp';
  const playAgainModels = state.agyRunner?.selectedModels ?? [];

  return (
    <main className="relative h-full w-full overflow-hidden bg-[#0b1020]">
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
        onOpenDeveloper={() => setShowDeveloperModal(true)}
        onReturnHome={handleReturnHome}
      />

      {showPlayersList && (
        <AgentHud
          agents={state.agents}
          humans={state.humans}
          selfPlayerId={state.human.id}
          isSpectator={false}
          showAiControls={showAiControls}
          activityFeed={state.activityFeed}
          agyRunner={state.agyRunner}
          roundStatus={state.roundStatus}
          onOpenDeveloper={() => setShowDeveloperModal(true)}
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
        <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 flex items-center gap-3 rounded-xl border border-rose-500/40 bg-[#121a2e]/95 px-4 py-2.5 text-sm text-rose-200 shadow-2xl">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="font-bold text-[#8d97ae] hover:text-white"
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
            selfPlayerId={state.human.id}
          />
        )}

      {state.matchStatus === 'finished' && (
        <FinalLeaderboardModal
          entries={state.leaderboard}
          totalRounds={state.totalRounds}
          bettingEnabled={state.bettingEnabled}
          selfPlayerId={state.human.id}
          isSpectator={state.mode === 'spectator'}
          onPlayAgain={() =>
            handleStartNewMatch({
              mode: state.mode,
              locationMode: state.locationMode,
              bettingEnabled: state.bettingEnabled,
              totalRounds: state.totalRounds,
              roundDurationSec: state.roundDurationSec,
              provider: state.provider,
              humanName: state.human.name,
              selectedModels: allowAiForPlayAgain ? playAgainModels : [],
              defaultEffort: state.agyRunner?.defaultEffort,
              modelEfforts: state.agyRunner?.modelEfforts,
              maxStepsPerRound: state.agyRunner?.maxStepsPerRound,
              timeoutSec: state.agyRunner?.timeoutSec,
              autoPlayEnabled:
                allowAiForPlayAgain && playAgainModels.length > 0,
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
          agyRunner={state.agyRunner}
          health={health}
          starting={busyAction}
          onStart={handleStartNewMatch}
          onClose={() => setShowSetup(false)}
        />
      )}

      {showDeveloperModal && (
        <SettingsModal
          initialTab="developer"
          humanName={state.human.name}
          provider={state.provider}
          maxStepsPerRound={state.agyRunner?.maxStepsPerRound ?? 5}
          timeoutSec={state.agyRunner?.timeoutSec ?? 120}
          health={health}
          mcpStatus={state.mcpStatus}
          agyRunner={state.agyRunner}
          onRefreshModels={handleRefreshModels}
          onSaveGeneral={(patch) => {
            void api.updateAgyConfig({
              maxStepsPerRound: patch.maxStepsPerRound,
              timeoutSec: patch.timeoutSec,
            });
          }}
          onClose={() => setShowDeveloperModal(false)}
        />
      )}
    </main>
  );
}
