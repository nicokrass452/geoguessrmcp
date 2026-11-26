import { useCallback, useEffect, useRef, useState } from 'react';
import type { PublicGameState, WsServerMessage } from '@geoguessr-mcp/shared';
import { api } from './api';
import {
  claimActiveRoomTab,
  getSessionPlayerId,
  getSessionRoomCode,
  getSessionToken,
  getUrlRoomCode,
  releaseActiveRoomTab,
  restoreRoomSessionToTab,
  setSessionPlayerId,
  setSessionRoomCode,
  setSessionToken as setSessionTokenStorage,
} from './playerSession';

function initTabSessionIdentity(): {
  playerId: string;
  sessionToken: string | null;
} {
  const urlCode = getUrlRoomCode();
  if (urlCode) {
    restoreRoomSessionToTab(urlCode);
  }
  return {
    playerId: getSessionPlayerId(),
    sessionToken: getSessionToken(),
  };
}

export function useGameSocket() {
  const [initialIdentity] = useState(initTabSessionIdentity);
  const [playerId, setPlayerIdState] = useState<string>(
    initialIdentity.playerId
  );
  const [sessionToken, setSessionTokenState] = useState<string | null>(
    initialIdentity.sessionToken
  );
  const [roomCode, setRoomCodeState] = useState<string | null>(() =>
    getSessionRoomCode()
  );
  const [state, setState] = useState<PublicGameState | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reconnectAttempt = useRef(0);

  const setPlayerId = useCallback((next: string) => {
    const clean = next.trim();
    if (!clean) return;
    setSessionPlayerId(clean);
    setPlayerIdState(clean);
  }, []);

  const setSessionToken = useCallback((next: string | null) => {
    const clean = next?.trim() || null;
    setSessionTokenStorage(clean);
    setSessionTokenState(clean);
  }, []);

  const setRoomCode = useCallback((next: string | null) => {
    setSessionRoomCode(next);
    setRoomCodeState(next ? next.trim().toUpperCase() : null);
  }, []);

  useEffect(() => {
    const clean = roomCode?.trim().toUpperCase();
    if (!clean || clean === 'ARENA1' || clean === 'DEFAULT') {
      releaseActiveRoomTab();
      return;
    }
    claimActiveRoomTab(clean, playerId);
    const heartbeat = setInterval(() => {
      claimActiveRoomTab(clean, playerId);
    }, 2000);
    const onUnload = () => releaseActiveRoomTab();
    window.addEventListener('pagehide', onUnload);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      clearInterval(heartbeat);
      window.removeEventListener('pagehide', onUnload);
      window.removeEventListener('beforeunload', onUnload);
      releaseActiveRoomTab();
    };
  }, [roomCode, playerId]);

  useEffect(() => {
    let cancelled = false;
    let hasState = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const loadInitialState = () => {
      if (cancelled || hasState) return;
      api
        .getMatch({ roomCode, playerId })
        .then((initial) => {
          if (cancelled || hasState) return;
          hasState = true;
          if (retryTimer) {
            clearTimeout(retryTimer);
            retryTimer = null;
          }
          setState(initial);
          setError(null);
        })
        .catch((err) => {
          if (cancelled || hasState) return;
          const msg = err instanceof Error ? err.message : String(err);
          // If stored roomCode expired across server restart, clear it and retry default room
          if (roomCode && msg.includes('Unknown roomCode')) {
            setSessionRoomCode(null);
            setRoomCodeState(null);
            return;
          }
          if (msg.includes('Valid session token required')) {
            setSessionTokenStorage(null);
            setSessionTokenState(null);
            setError(msg);
            return;
          }
          setError(msg);
          retryTimer = setTimeout(loadInitialState, 1200);
        });
    };

    loadInitialState();

    const connect = () => {
      if (cancelled) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const params = new URLSearchParams({
        role: 'ui',
        playerId,
      });
      const activeToken = sessionToken || getSessionToken();
      if (activeToken) {
        params.set('sessionToken', activeToken);
      }
      if (roomCode) {
        params.set('roomCode', roomCode);
      }
      const wsUrl = `${proto}//${window.location.host}/ws?${params.toString()}`;
      socket = new WebSocket(wsUrl);

      socket.onopen = () => {
        if (cancelled) return;
        setWsConnected(true);
        setError(null);
        reconnectAttempt.current = 0;
      };

      socket.onmessage = (evt) => {
        if (cancelled) return;
        try {
          const msg = JSON.parse(String(evt.data)) as WsServerMessage;
          if (
            msg.type === 'state_sync' ||
            msg.type === 'round_ended' ||
            msg.type === 'match_ended'
          ) {
            hasState = true;
            if (retryTimer) {
              clearTimeout(retryTimer);
              retryTimer = null;
            }
            setError(null);
            setState(msg.state);
          } else if (msg.type === 'mcp_status_updated') {
            setState((prev) =>
              prev ? { ...prev, mcpStatus: msg.mcpStatus } : prev
            );
          } else if (msg.type === 'timer_tick') {
            setState((prev) =>
              prev ? { ...prev, timeRemainingSec: msg.timeRemainingSec } : prev
            );
          } else if (msg.type === 'activity_event') {
            setState((prev) => {
              if (!prev) return prev;
              const exists = prev.activityFeed.some((e) => e.id === msg.event.id);
              if (exists) return prev;
              return {
                ...prev,
                activityFeed: [msg.event, ...prev.activityFeed].slice(0, 60),
              };
            });
          } else if (msg.type === 'agent_camera_updated') {
            setState((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                agents: prev.agents.map((a) =>
                  a.id === msg.agentId
                    ? {
                        ...a,
                        camera: msg.camera,
                        currentNodeId: msg.currentNodeId,
                        frameVersion: msg.frameVersion,
                        status: msg.status,
                      }
                    : a
                ),
              };
            });
          }
        } catch {
          // Ignore malformed frame
        }
      };

      socket.onclose = (evt) => {
        if (cancelled) return;
        setWsConnected(false);
        if (evt.code === 4003) {
          setError(evt.reason || 'Valid session token required');
          return;
        }
        const delay = Math.min(
          2000,
          600 * Math.pow(1.4, reconnectAttempt.current)
        );
        reconnectAttempt.current += 1;
        reconnectTimer = setTimeout(connect, delay);
      };

      socket.onerror = () => {
        socket?.close();
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (retryTimer) clearTimeout(retryTimer);
      socket?.close();
    };
  }, [roomCode, playerId, sessionToken]);

  return {
    playerId,
    setPlayerId,
    sessionToken,
    setSessionToken,
    roomCode,
    setRoomCode,
    state,
    setState,
    wsConnected,
    error,
    setError,
  };
}
