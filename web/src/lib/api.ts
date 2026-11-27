import type {
  AgyRunnerStatus,
  GameMode,
  HealthInfo,
  LocationMode,
  McpStatusInfo,
  ModelEffortLevel,
  MoveDirection,
  PanoramaProviderChoice,
  PublicGameState,
} from '@geoguessr-mcp/shared';
import {
  getSessionPlayerId,
  getSessionPlayerName,
  getSessionRoomCode,
  getSessionToken,
  setSessionPlayerId,
  setSessionToken,
} from './playerSession';

export interface StartMatchPayload {
  mode: GameMode;
  locationMode?: LocationMode;
  bettingEnabled?: boolean;
  startingChips?: number;
  totalRounds: number;
  roundDurationSec: number | null;
  provider: PanoramaProviderChoice;
  humanName: string;
  playerId?: string;
  roomCode?: string;
  selectedModels?: string[];
  defaultEffort?: ModelEffortLevel;
  modelEfforts?: Record<string, ModelEffortLevel>;
  maxStepsPerRound?: number;
  timeoutSec?: number;
  autoPlayEnabled?: boolean;
  autoStart?: boolean;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const playerId = getSessionPlayerId();
  const roomCode = getSessionRoomCode();
  const sessionToken = getSessionToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Player-Id': playerId,
    'X-Session-Auto': '1',
  };
  if (sessionToken) {
    headers['X-Session-Token'] = sessionToken;
  }
  if (roomCode) {
    headers['X-Room-Code'] = roomCode;
  }

  const res = await fetch(url, {
    ...init,
    headers: {
      ...headers,
      ...((init?.headers as Record<string, string>) || {}),
    },
  });
  const text = await res.text();
  if (!text.trim()) {
    throw new Error('Backend is starting or restarting — retrying...');
  }

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Backend is starting or restarting — retrying...');
  }

  if (!res.ok) {
    const msg =
      typeof data === 'object' &&
      data !== null &&
      'error' in data &&
      typeof (data as { error?: unknown }).error === 'string'
        ? (data as { error: string }).error
        : res.status >= 500
          ? 'Backend is starting or restarting — retrying...'
          : `HTTP ${res.status}`;
    throw new Error(msg);
  }

  return data as T;
}

export const api = {
  ensureSession: async (): Promise<{
    playerId: string;
    sessionToken: string;
  }> => {
    const res = await requestJson<{ playerId: string; sessionToken: string }>(
      '/api/session',
      {
        method: 'POST',
        body: JSON.stringify({
          playerId: getSessionPlayerId(),
          displayName: getSessionPlayerName(),
        }),
      }
    );
    if (res.playerId) setSessionPlayerId(res.playerId);
    if (res.sessionToken) setSessionToken(res.sessionToken);
    return res;
  },
  getHealth: () => requestJson<HealthInfo>('/api/health'),
  getMcpStatus: () => requestJson<McpStatusInfo>('/api/mcp/status'),
  getMatch: (opts?: { roomCode?: string | null; playerId?: string }) => {
    const params = new URLSearchParams();
    const pid = opts?.playerId || getSessionPlayerId();
    const rcode =
      opts?.roomCode !== undefined ? opts.roomCode : getSessionRoomCode();
    if (pid) params.set('playerId', pid);
    if (rcode) params.set('roomCode', rcode);
    const qs = params.toString();
    return requestJson<PublicGameState>(`/api/match${qs ? `?${qs}` : ''}`);
  },
  startNewMatch: (opts: StartMatchPayload) =>
    requestJson<PublicGameState>('/api/match/new', {
      method: 'POST',
      body: JSON.stringify({
        ...opts,
        playerId: opts.playerId || getSessionPlayerId(),
      }),
    }),
  createRoom: (opts: StartMatchPayload) =>
    requestJson<{
      roomCode: string;
      hostPlayerId: string;
      sessionToken?: string;
      state: PublicGameState;
    }>('/api/rooms', {
      method: 'POST',
      body: JSON.stringify({
        ...opts,
        playerId: opts.playerId || getSessionPlayerId(),
        autoStart: opts.autoStart ?? false,
      }),
    }),
  joinRoom: (
    roomCode: string,
    playerName: string,
    playerId?: string,
    opts?: { preserveExistingName?: boolean }
  ) =>
    requestJson<{
      roomCode: string;
      playerId: string;
      sessionToken?: string;
      state: PublicGameState;
    }>(`/api/rooms/${encodeURIComponent(roomCode.trim().toUpperCase())}/join`, {
      method: 'POST',
      body: JSON.stringify({
        playerId: playerId || getSessionPlayerId(),
        playerName,
        ...(opts?.preserveExistingName ? { preserveExistingName: true } : {}),
      }),
    }),
  startRoom: (roomCode: string, playerId?: string) =>
    requestJson<{ roomCode: string; state: PublicGameState }>(
      `/api/rooms/${encodeURIComponent(roomCode.trim().toUpperCase())}/start`,
      {
        method: 'POST',
        body: JSON.stringify({
          playerId: playerId || getSessionPlayerId(),
        }),
      }
    ),
  leaveRoom: (roomCode: string, playerId?: string) =>
    requestJson<{ ok: true; roomCode: string }>(
      `/api/rooms/${encodeURIComponent(roomCode.trim().toUpperCase())}/leave`,
      {
        method: 'POST',
        body: JSON.stringify({
          playerId: playerId || getSessionPlayerId(),
        }),
      }
    ),
  endRound: (roomCode?: string | null) =>
    requestJson<PublicGameState>('/api/match/end-round', {
      method: 'POST',
      body: JSON.stringify({
        playerId: getSessionPlayerId(),
        roomCode: roomCode || getSessionRoomCode() || undefined,
      }),
    }),
  nextRound: (roomCode?: string | null) =>
    requestJson<PublicGameState>('/api/match/next-round', {
      method: 'POST',
      body: JSON.stringify({
        playerId: getSessionPlayerId(),
        roomCode: roomCode || getSessionRoomCode() || undefined,
      }),
    }),
  updateHumanCamera: (heading: number, pitch: number, zoom: number) =>
    requestJson<PublicGameState>('/api/human/camera', {
      method: 'POST',
      body: JSON.stringify({
        heading,
        pitch,
        zoom,
        playerId: getSessionPlayerId(),
        roomCode: getSessionRoomCode() || undefined,
      }),
    }),
  moveHuman: (opts: { direction?: MoveDirection; nodeId?: string }) =>
    requestJson<PublicGameState>('/api/human/move', {
      method: 'POST',
      body: JSON.stringify({
        ...opts,
        playerId: getSessionPlayerId(),
        roomCode: getSessionRoomCode() || undefined,
      }),
    }),
  returnToStart: () =>
    requestJson<PublicGameState>('/api/human/return-to-start', {
      method: 'POST',
      body: JSON.stringify({
        playerId: getSessionPlayerId(),
        roomCode: getSessionRoomCode() || undefined,
      }),
    }),
  submitHumanGuess: (latitude: number, longitude: number, wager?: number) =>
    requestJson<PublicGameState>('/api/human/guess', {
      method: 'POST',
      body: JSON.stringify({
        latitude,
        longitude,
        ...(typeof wager === 'number' ? { wager } : {}),
        playerId: getSessionPlayerId(),
        roomCode: getSessionRoomCode() || undefined,
      }),
    }),
  getAgyStatus: () => {
    const rcode = getSessionRoomCode();
    return requestJson<AgyRunnerStatus>(
      `/api/agy/status${rcode ? `?roomCode=${encodeURIComponent(rcode)}` : ''}`
    );
  },
  updateAgyConfig: (opts: {
    autoPlayEnabled?: boolean;
    selectedModels?: string[];
    defaultEffort?: ModelEffortLevel;
    modelEfforts?: Record<string, ModelEffortLevel>;
    maxStepsPerRound?: number;
    timeoutSec?: number;
  }) =>
    requestJson<AgyRunnerStatus>('/api/agy/config', {
      method: 'POST',
      body: JSON.stringify({
        ...opts,
        roomCode: getSessionRoomCode() || undefined,
      }),
    }),
  refreshAgyModels: () =>
    requestJson<AgyRunnerStatus>('/api/agy/refresh-models', {
      method: 'POST',
      body: JSON.stringify({
        roomCode: getSessionRoomCode() || undefined,
      }),
    }),
  triggerAgyRound: (models?: string[]) =>
    requestJson<AgyRunnerStatus>('/api/agy/trigger', {
      method: 'POST',
      body: JSON.stringify({
        ...(models ? { models } : {}),
        roomCode: getSessionRoomCode() || undefined,
      }),
    }),
  stopAgyRuns: () =>
    requestJson<AgyRunnerStatus>('/api/agy/stop', {
      method: 'POST',
      body: JSON.stringify({
        roomCode: getSessionRoomCode() || undefined,
      }),
    }),
};
