import crypto from 'node:crypto';
import {
  calculateScore,
  clampCamera,
  classifyRelativeDirection,
  haversineDistanceKm,
  headingToCompass,
  resolveMoveByDirection,
  type ActivityEvent,
  type AgentBudgetInfo,
  type AgentFramePayload,
  type AgentGameState,
  type AgentStatus,
  type AgyRunnerStatus,
  type AvailableMove,
  type CameraView,
  type GameMode,
  type HumanPlayerView,
  type LeaderboardEntry,
  type LeaderboardPayload,
  type LocationMode,
  type MatchStatus,
  type McpStatusInfo,
  type MoveDirection,
  type PanoramaProviderChoice,
  type PlayerGuess,
  type PlayerInfo,
  type PublicGameState,
  type RoundPlayerScore,
  type RoundStatus,
  type RoundSummary,
} from '@geoguessr-mcp/shared';
import type { ServerConfig } from './config.js';
import type { CatalogLocation } from './panorama/catalog.js';
import {
  PanoramaProviderManager,
  type BuiltRoundScene,
  type InternalRoundNode,
} from './panorama/providers.js';
import type { WsHub } from './wsHub.js';

const AGENT_COLORS = [
  '#f43f5e', // rose
  '#a855f7', // purple
  '#f59e0b', // amber
  '#10b981', // emerald
  '#ec4899', // pink
  '#6366f1', // indigo
];

const HUMAN_COLORS = [
  '#38bdf8', // sky
  '#22d3ee', // cyan
  '#34d399', // emerald
  '#818cf8', // indigo
  '#fb923c', // orange
];

interface RoundRuntime {
  roundId: string;
  roundNumber: number;
  status: RoundStatus;
  scene: BuiltRoundScene;
  opaqueToReal: Map<string, string>;
  realToOpaque: Map<string, string>;
  spawnOpaqueId: string;
  summary: RoundSummary | null;
}

interface MutablePlayerState {
  id: string;
  name: string;
  isHuman: boolean;
  isHost?: boolean;
  model?: string;
  transport?: string;
  color: string;
  status: AgentStatus;
  connected: boolean;
  currentOpaqueNodeId: string;
  camera: CameraView;
  stepCount: number;
  frameVersion: number;
  managed: boolean;
  explorationCalls: number;
  maxExplorationCalls: number | null;
  roundDeadlineMs: number | null;
  participatedThisRound: boolean;
  hasGuessed: boolean;
  myGuess: PlayerGuess | null;
  totalScore: number;
  chips: number;
  currentWager: number | null;
  roundScores: Array<{
    roundNumber: number;
    score: number;
    distanceKm: number | null;
  }>;
}

interface RoomRuntime {
  roomCode: string;
  matchId: string;
  hostPlayerId: string | null;
  matchStatus: MatchStatus;
  mode: GameMode;
  locationMode: LocationMode;
  bettingEnabled: boolean;
  startingChips: number;
  providerChoice: PanoramaProviderChoice;
  totalRounds: number;
  roundDurationSec: number | null;
  maxStepsPerRound: number | null;
  currentRoundNumber: number;
  timeRemainingSec: number | null;
  locations: CatalogLocation[];
  usedMapillarySeedIds: Set<string>;
  currentRound: RoundRuntime;
  completedRounds: RoundSummary[];
  activityFeed: ActivityEvent[];
  humans: Map<string, MutablePlayerState>;
  agents: Map<string, MutablePlayerState>;
  colorCursor: number;
  humanColorCursor: number;
  timerHandle: NodeJS.Timeout | null;
}

export interface EngineLifecycleHooks {
  onRoundStarted?: (roundNumber: number) => void;
  onRoundEnded?: (roundNumber: number) => void;
  onMatchReset?: () => void;
  getAgyStatus?: () => AgyRunnerStatus;
}

export interface MatchSetupOptions {
  roomCode?: string;
  playerId?: string;
  humanName?: string;
  mode?: GameMode;
  locationMode?: LocationMode;
  bettingEnabled?: boolean;
  startingChips?: number;
  totalRounds?: number;
  roundDurationSec?: number | null;
  maxStepsPerRound?: number | null;
  provider?: PanoramaProviderChoice;
  autoStart?: boolean;
}

const HEARTBEAT_TTL_MS = 18_000;

interface HeartbeatRecord {
  transport: string;
  activeSessions: number;
  agentId?: string;
  timestamp: number;
}

function generateRoomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  const bytes = crypto.randomBytes(6);
  for (let i = 0; i < 6; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

export class GameEngine {
  public readonly config: ServerConfig;
  public readonly panoramas: PanoramaProviderManager;
  private readonly wsHub: WsHub;

  private readonly rooms = new Map<string, RoomRuntime>();
  private readonly agentToRoom = new Map<string, string>();
  private activeRoomCode = 'ARENA1';
  private lifecycleHooks: EngineLifecycleHooks = {};

  // MCP Telemetry State
  private readonly heartbeats = new Map<string, HeartbeatRecord>();
  private lastMcpActivityAt: number | null = null;
  private httpBridgeReachable = false;
  private lastSerializedMcpStatus = '';
  private mcpPollHandle: NodeJS.Timeout | null = null;

  constructor(config: ServerConfig, wsHub: WsHub) {
    this.config = config;
    this.wsHub = wsHub;
    this.panoramas = new PanoramaProviderManager(config);

    this.wsHub.setOnAgentConnect((agentId, roomCode) => {
      this.lastMcpActivityAt = Date.now();
      const room = this.resolveRoom(roomCode ?? this.agentToRoom.get(agentId));
      if (!room.agents.has(agentId) && !agentId.startsWith('agy_')) {
        try {
          this.registerAgent({
            agentId,
            name: 'Antigravity',
            model: 'antigravity',
            transport: 'stdio',
            roomCode: room.roomCode,
          });
        } catch {
          // ignore if mode rejects AI
        }
      }
      this.broadcastMcpStatusIfChanged();
    });

    this.wsHub.setOnAgentDisconnect((agentId) => {
      this.handleAgentDisconnected(agentId);
      this.broadcastMcpStatusIfChanged();
    });

    this.mcpPollHandle = setInterval(() => {
      void this.refreshMcpBridgeProbe();
    }, 2500);
    this.mcpPollHandle.unref?.();
  }

  public setLifecycleHooks(hooks: EngineLifecycleHooks): void {
    this.lifecycleHooks = hooks;
  }

  public notifyStateChanged(roomCode?: string): void {
    const room = this.resolveRoom(roomCode);
    this.broadcastRoomStateSync(room);
  }

  public async init(): Promise<void> {
    await this.startNewMatch({
      roomCode: this.activeRoomCode,
      playerId: 'human',
      humanName: 'You (Player)',
      mode: 'ffa',
      locationMode: 'standard',
      bettingEnabled: false,
      startingChips: 1000,
      totalRounds: 5,
      roundDurationSec: null,
      provider: this.config.defaultProvider,
    });
    void this.refreshMcpBridgeProbe();
  }

  // ==================== MCP Telemetry ====================

  private getMcpHttpHealthUrl(): string {
    const rawUrl = process.env.MCP_HTTP_URL?.trim();
    if (rawUrl) {
      return `${rawUrl.replace(/\/+$/, '')}/health`;
    }
    const rawPort =
      process.env.MCP_HTTP_PORT?.trim() ||
      process.env.MCP_PORT?.trim() ||
      process.env.MCP_SSE_PORT?.trim();
    const port = rawPort ? Number(rawPort) : this.config.port + 1;
    return `http://127.0.0.1:${port}/health`;
  }

  public async refreshMcpBridgeProbe(): Promise<McpStatusInfo> {
    const url = this.getMcpHttpHealthUrl();
    let reachable = false;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(400) });
      if (res.ok) {
        reachable = true;
      }
    } catch {
      reachable = false;
    }

    if (!reachable) {
      for (const [k, hb] of this.heartbeats.entries()) {
        if (hb.transport === 'streamable-http' || hb.transport === 'sse') {
          this.heartbeats.delete(k);
        }
      }
    }
    this.httpBridgeReachable = reachable;
    this.broadcastMcpStatusIfChanged();
    return this.getMcpStatusSync();
  }

  public recordMcpHeartbeat(opts: {
    transport: string;
    activeSessions?: number;
    agentId?: string;
  }): McpStatusInfo {
    const transport = opts.transport.trim().toLowerCase();
    const activeSessions =
      typeof opts.activeSessions === 'number' && Number.isFinite(opts.activeSessions)
        ? Math.max(0, Math.floor(opts.activeSessions))
        : 1;
    const now = Date.now();
    this.lastMcpActivityAt = now;

    if (transport === 'streamable-http' || transport === 'sse') {
      this.httpBridgeReachable = true;
    }

    const key = opts.agentId ? `${transport}:${opts.agentId}` : transport;
    this.heartbeats.set(key, {
      transport,
      activeSessions,
      agentId: opts.agentId,
      timestamp: now,
    });

    if (opts.agentId) {
      const roomCode = this.agentToRoom.get(opts.agentId);
      const room = roomCode ? this.rooms.get(roomCode) : undefined;
      const agent = room?.agents.get(opts.agentId);
      if (agent && !agent.transport) {
        agent.transport = transport;
      }
    }

    this.broadcastMcpStatusIfChanged();
    return this.getMcpStatusSync();
  }

  public getMcpStatusSync(): McpStatusInfo {
    const now = Date.now();
    for (const [key, hb] of this.heartbeats.entries()) {
      if (now - hb.timestamp > HEARTBEAT_TTL_MS) {
        this.heartbeats.delete(key);
      }
    }

    const activeAgentSockets = this.wsHub.getActiveAgentSocketCount();
    const transportsSet = new Set<string>();
    let connectedAgentCount = 0;

    for (const room of this.rooms.values()) {
      for (const agent of room.agents.values()) {
        if (agent.connected && !agent.managed) {
          connectedAgentCount += 1;
          transportsSet.add(agent.transport || 'stdio');
        }
      }
    }

    for (const hb of this.heartbeats.values()) {
      if (hb.activeSessions > 0) {
        transportsSet.add(hb.transport);
      }
    }

    const activeMcpAgents = connectedAgentCount;
    const connected = activeMcpAgents > 0 || activeAgentSockets > 0;
    const status: McpStatusInfo['status'] = connected
      ? 'connected'
      : this.httpBridgeReachable
        ? 'bridge_ready'
        : 'offline';

    const agyStatus = this.lifecycleHooks.getAgyStatus?.();

    return {
      connected,
      status,
      httpBridgeReachable: this.httpBridgeReachable,
      activeAgentSockets,
      activeMcpAgents,
      transports: Array.from(transportsSet),
      lastActivityAt: this.lastMcpActivityAt,
      agyAvailable: Boolean(agyStatus?.available),
    };
  }

  public async getMcpStatus(): Promise<McpStatusInfo> {
    return this.refreshMcpBridgeProbe();
  }

  private broadcastMcpStatusIfChanged(): void {
    if (this.rooms.size === 0) return;
    const mcpStatus = this.getMcpStatusSync();
    const sig = JSON.stringify({
      status: mcpStatus.status,
      connected: mcpStatus.connected,
      httpBridgeReachable: mcpStatus.httpBridgeReachable,
      activeMcpAgents: mcpStatus.activeMcpAgents,
      transports: mcpStatus.transports,
    });
    if (sig === this.lastSerializedMcpStatus) return;
    this.lastSerializedMcpStatus = sig;

    this.wsHub.broadcast({ type: 'mcp_status_updated', mcpStatus });
    for (const room of this.rooms.values()) {
      if (room.currentRound) {
        this.broadcastRoomStateSync(room);
      }
    }
  }

  // ==================== Room Resolution ====================

  private resolveRoom(roomCode?: string, playerId?: string): RoomRuntime {
    if (roomCode && roomCode.trim() && roomCode.trim().toUpperCase() !== 'DEFAULT') {
      const code = roomCode.trim().toUpperCase();
      const found = this.rooms.get(code);
      if (!found) {
        throw new Error(`Unknown roomCode: ${code}`);
      }
      return found;
    }

    if (playerId && playerId !== 'human') {
      const active = this.rooms.get(this.activeRoomCode);
      if (active && active.humans.has(playerId)) {
        return active;
      }
      const roomsArr = Array.from(this.rooms.values()).reverse();
      for (const r of roomsArr) {
        if (r.humans.has(playerId)) {
          return r;
        }
      }
    }

    const fallback =
      this.rooms.get(this.activeRoomCode) ??
      Array.from(this.rooms.values())[0];
    if (!fallback) {
      throw new Error('GameEngine has no initialized room.');
    }
    return fallback;
  }

  private createHumanState(
    room: RoomRuntime,
    playerId: string,
    playerName: string,
    isHost: boolean
  ): MutablePlayerState {
    const spawnOpaqueId = room.currentRound?.spawnOpaqueId || 'node_0';
    const spawnNode = room.currentRound
      ? this.getInternalNode(room, spawnOpaqueId)
      : null;
    const initialCam = clampCamera(spawnNode?.initialHeading ?? 0, 0, 0);
    const color =
      HUMAN_COLORS[room.humanColorCursor % HUMAN_COLORS.length];
    room.humanColorCursor += 1;

    return {
      id: playerId,
      name: playerName.trim() || 'You (Player)',
      isHuman: true,
      isHost,
      color,
      status: 'exploring',
      connected: true,
      currentOpaqueNodeId: spawnOpaqueId,
      camera: { ...initialCam },
      stepCount: 0,
      frameVersion: 1,
      managed: false,
      explorationCalls: 0,
      maxExplorationCalls: null,
      roundDeadlineMs: null,
      participatedThisRound: false,
      hasGuessed: false,
      myGuess: null,
      totalScore: 0,
      chips: room.startingChips,
      currentWager: null,
      roundScores: [],
    };
  }

  private ensureHumanInRoom(
    room: RoomRuntime,
    playerId?: string,
    playerName?: string
  ): MutablePlayerState {
    const cleanId = playerId?.trim() || room.hostPlayerId || 'human';
    const existing = room.humans.get(cleanId);
    if (existing) {
      if (playerName?.trim()) {
        existing.name = playerName.trim();
      }
      existing.connected = true;
      return existing;
    }

    // If single-human room created with default 'human' and a tab-scoped playerId arrives, re-key host
    if (
      room.humans.size === 1 &&
      room.humans.has('human') &&
      cleanId !== 'human' &&
      room.mode !== 'pvp' &&
      room.mode !== 'pvp_ai'
    ) {
      const def = room.humans.get('human')!;
      room.humans.delete('human');
      def.id = cleanId;
      if (playerName?.trim()) {
        def.name = playerName.trim();
      }
      if (room.hostPlayerId === 'human') {
        room.hostPlayerId = cleanId;
        def.isHost = true;
      }
      room.humans.set(cleanId, def);
      return def;
    }

    const first = Array.from(room.humans.values())[0];
    if (first) return first;

    const created = this.createHumanState(
      room,
      cleanId,
      playerName || 'You (Player)',
      true
    );
    room.hostPlayerId = cleanId;
    room.humans.set(cleanId, created);
    return created;
  }

  // ==================== Room & Match Lifecycle ====================

  public async createRoom(opts: MatchSetupOptions): Promise<{
    roomCode: string;
    hostPlayerId: string;
    state: PublicGameState;
  }> {
    let code = opts.roomCode?.trim().toUpperCase() || '';
    if (!code || code === 'DEFAULT' || this.rooms.has(code)) {
      do {
        code = generateRoomCode();
      } while (this.rooms.has(code));
    }

    const hostId = opts.playerId?.trim() || 'human';
    const autoStart = opts.autoStart ?? false;
    const state = await this.startNewMatch({
      ...opts,
      roomCode: code,
      playerId: hostId,
      autoStart,
    });

    return {
      roomCode: code,
      hostPlayerId: hostId,
      state,
    };
  }

  public joinRoom(
    roomCode: string,
    opts: { playerId?: string; playerName: string }
  ): { roomCode: string; playerId: string; state: PublicGameState } {
    const room = this.resolveRoom(roomCode);
    const playerId =
      opts.playerId?.trim() ||
      `player_${crypto.randomBytes(3).toString('hex')}`;
    const playerName = opts.playerName.trim() || 'Player';

    const existing = room.humans.get(playerId);
    if (existing) {
      existing.name = playerName;
      existing.connected = true;
      existing.status = existing.hasGuessed ? 'guessed' : 'exploring';
    } else {
      const human = this.createHumanState(
        room,
        playerId,
        playerName,
        room.humans.size === 0
      );
      if (!room.hostPlayerId) {
        room.hostPlayerId = playerId;
        human.isHost = true;
      }
      room.humans.set(playerId, human);
      this.pushActivity(
        room,
        human.id,
        human.name,
        human.color,
        'join',
        `${human.name} joined room ${room.roomCode}`
      );
    }

    this.broadcastRoomStateSync(room);
    return {
      roomCode: room.roomCode,
      playerId,
      state: this.getPublicState(room.roomCode, playerId),
    };
  }

  public async startRoom(
    roomCode: string,
    opts?: { playerId?: string }
  ): Promise<{ roomCode: string; state: PublicGameState }> {
    const room = this.resolveRoom(roomCode);
    const callerId = opts?.playerId?.trim();
    if (
      callerId &&
      room.hostPlayerId &&
      callerId !== room.hostPlayerId
    ) {
      throw new Error('Only the room host can start the match.');
    }

    this.activeRoomCode = room.roomCode;
    if (room.matchStatus === 'lobby') {
      room.matchStatus = 'active';
      await this.setupRound(room, 1);
      this.pushActivity(
        room,
        'system',
        'Match Referee',
        '#10b981',
        'match_start',
        `Host started ${room.totalRounds}-round ${room.mode.toUpperCase()} match in room ${room.roomCode}`
      );
      this.broadcastRoomStateSync(room);
    }

    return {
      roomCode: room.roomCode,
      state: this.getPublicState(room.roomCode, callerId || room.hostPlayerId || 'human'),
    };
  }

  public leaveRoom(
    roomCode: string,
    opts?: { playerId?: string }
  ): { ok: true; roomCode: string } {
    const code = roomCode?.trim().toUpperCase();
    const room =
      code && code !== 'DEFAULT'
        ? this.rooms.get(code)
        : this.rooms.get(this.activeRoomCode);
    if (!room) {
      return { ok: true, roomCode: code || this.activeRoomCode };
    }

    const pid = opts?.playerId?.trim();
    if (pid && room.humans.has(pid)) {
      const h = room.humans.get(pid)!;
      if (room.matchStatus === 'lobby') {
        room.humans.delete(pid);
      } else {
        h.connected = false;
        h.status = 'disconnected';
      }
      if (room.hostPlayerId === pid) {
        const nextHost = Array.from(room.humans.values()).find((p) => p.connected);
        room.hostPlayerId = nextHost?.id ?? null;
        if (nextHost) nextHost.isHost = true;
      }
    }

    const anyConnectedHuman = Array.from(room.humans.values()).some(
      (h) => h.connected
    );
    if (!anyConnectedHuman && room.mode !== 'spectator') {
      this.stopRoomTimer(room);
      if (room.roomCode === this.activeRoomCode) {
        this.lifecycleHooks.onMatchReset?.();
      }
    } else {
      this.checkRoundCompletion(room);
    }

    this.broadcastRoomStateSync(room);
    return { ok: true, roomCode: room.roomCode };
  }

  public async startNewMatch(opts: MatchSetupOptions): Promise<PublicGameState> {
    const requestedCode = opts.roomCode?.trim().toUpperCase();
    const code =
      requestedCode && requestedCode !== 'DEFAULT'
        ? requestedCode
        : this.activeRoomCode || 'ARENA1';

    const existing = this.rooms.get(code);
    if (existing) {
      this.stopRoomTimer(existing);
      for (const agId of existing.agents.keys()) {
        this.agentToRoom.delete(agId);
      }
    }
    this.lifecycleHooks.onMatchReset?.();

    const mode: GameMode = opts.mode ?? existing?.mode ?? 'ffa';
    const locationMode: LocationMode =
      opts.locationMode ?? existing?.locationMode ?? 'standard';
    const bettingEnabled = Boolean(opts.bettingEnabled ?? false);
    const startingChips =
      typeof opts.startingChips === 'number' && opts.startingChips > 0
        ? Math.floor(opts.startingChips)
        : 1000;
    const totalRounds = Math.max(1, Math.min(10, opts.totalRounds ?? 5));
    const roundDurationSec =
      opts.roundDurationSec && opts.roundDurationSec > 0
        ? Math.round(opts.roundDurationSec)
        : null;
    const maxStepsPerRound =
      typeof opts.maxStepsPerRound === 'number' && opts.maxStepsPerRound >= 2
        ? Math.round(opts.maxStepsPerRound)
        : null;
    const providerChoice =
      opts.provider ?? existing?.providerChoice ?? this.config.defaultProvider;

    const hostId = opts.playerId?.trim() || 'human';
    const hostName = opts.humanName?.trim() || 'You (Player)';
    const autoStart = opts.autoStart ?? true;

    const room: RoomRuntime = {
      roomCode: code,
      matchId: `match_${crypto.randomBytes(4).toString('hex')}`,
      hostPlayerId: hostId,
      matchStatus: autoStart ? 'active' : 'lobby',
      mode,
      locationMode,
      bettingEnabled,
      startingChips,
      providerChoice,
      totalRounds,
      roundDurationSec,
      maxStepsPerRound,
      currentRoundNumber: 1,
      timeRemainingSec: roundDurationSec,
      locations: this.panoramas.pickRandomLocations(totalRounds, locationMode),
      usedMapillarySeedIds: new Set<string>(),
      currentRound: undefined as unknown as RoundRuntime,
      completedRounds: [],
      activityFeed: [],
      humans: new Map<string, MutablePlayerState>(),
      agents: new Map<string, MutablePlayerState>(),
      colorCursor: 0,
      humanColorCursor: 0,
      timerHandle: null,
    };

    this.rooms.set(code, room);
    this.activeRoomCode = code;

    const hostHuman = this.createHumanState(room, hostId, hostName, true);
    room.humans.set(hostId, hostHuman);

    await this.setupRound(room, 1);

    this.pushActivity(
      room,
      'system',
      'Match Referee',
      '#64748b',
      'match_start',
      `Started ${room.totalRounds}-round ${room.mode.toUpperCase()} match (${room.locationMode}${room.bettingEnabled ? ', betting on' : ''})`
    );
    this.broadcastRoomStateSync(room);
    return this.getPublicState(room.roomCode, hostId);
  }

  private async setupRound(room: RoomRuntime, roundNumber: number): Promise<void> {
    this.stopRoomTimer(room);
    room.currentRoundNumber = roundNumber;
    room.timeRemainingSec = room.roundDurationSec;

    const location =
      room.locations[roundNumber - 1] ??
      this.panoramas.pickRandomLocations(1, room.locationMode)[0];
    const scene = await this.panoramas.buildRoundScene(
      location,
      room.providerChoice,
      room.usedMapillarySeedIds,
      room.locationMode
    );
    if (scene.mapillarySeedId) {
      room.usedMapillarySeedIds.add(scene.mapillarySeedId);
    }

    const opaqueToReal = new Map<string, string>();
    const realToOpaque = new Map<string, string>();
    let idx = 0;
    for (const realKey of scene.nodes.keys()) {
      const opaqueId = `node_${idx++}`;
      opaqueToReal.set(opaqueId, realKey);
      realToOpaque.set(realKey, opaqueId);
    }

    const spawnOpaqueId = realToOpaque.get(scene.spawnRealKey) || 'node_0';
    const spawnNode = scene.nodes.get(scene.spawnRealKey)!;
    const initialCam = clampCamera(spawnNode.initialHeading, 0, 0);

    room.currentRound = {
      roundId: `r_${room.roomCode}_${roundNumber}_${crypto.randomBytes(3).toString('hex')}`,
      roundNumber,
      status: 'active',
      scene,
      opaqueToReal,
      realToOpaque,
      spawnOpaqueId,
      summary: null,
    };

    for (const human of room.humans.values()) {
      human.currentOpaqueNodeId = spawnOpaqueId;
      human.camera = { ...initialCam };
      human.stepCount = 0;
      human.hasGuessed = false;
      human.myGuess = null;
      human.currentWager = null;
      human.status = human.connected ? 'exploring' : 'disconnected';
    }

    for (const agent of room.agents.values()) {
      agent.currentOpaqueNodeId = spawnOpaqueId;
      agent.camera = { ...initialCam };
      agent.stepCount = 0;
      agent.explorationCalls = 0;
      agent.roundDeadlineMs = null;
      agent.participatedThisRound = false;
      agent.hasGuessed = false;
      agent.myGuess = null;
      agent.currentWager = null;
      if (agent.managed) {
        agent.connected = true;
      }
      agent.status = agent.connected ? 'exploring' : 'disconnected';
      agent.frameVersion += 1;
    }

    if (room.matchStatus === 'active' && room.roundDurationSec !== null) {
      room.timerHandle = setInterval(() => {
        if (
          room.matchStatus !== 'active' ||
          room.currentRound.status !== 'active'
        ) {
          return;
        }
        if (room.timeRemainingSec === null) return;
        room.timeRemainingSec = Math.max(0, room.timeRemainingSec - 1);
        this.wsHub.broadcastToRoom(
          room.roomCode,
          room.roomCode === this.activeRoomCode,
          {
            type: 'timer_tick',
            timeRemainingSec: room.timeRemainingSec,
          }
        );
        if (room.timeRemainingSec === 0) {
          this.endCurrentRound('timeout', room.roomCode);
        }
      }, 1000);
      room.timerHandle.unref?.();
    }

    if (
      room.matchStatus === 'active' &&
      room.mode !== 'solo' &&
      room.mode !== 'pvp'
    ) {
      this.lifecycleHooks.onRoundStarted?.(roundNumber);
    }
  }

  private stopRoomTimer(room: RoomRuntime): void {
    if (room.timerHandle) {
      clearInterval(room.timerHandle);
      room.timerHandle = null;
    }
  }

  private getInternalNode(
    room: RoomRuntime,
    opaqueId: string
  ): InternalRoundNode {
    const realKey =
      room.currentRound.opaqueToReal.get(opaqueId) ??
      room.currentRound.scene.spawnRealKey;
    return (
      room.currentRound.scene.nodes.get(realKey) ??
      room.currentRound.scene.nodes.get(room.currentRound.scene.spawnRealKey)!
    );
  }

  private computeAvailableMoves(
    room: RoomRuntime,
    opaqueNodeId: string,
    cameraHeading: number
  ): AvailableMove[] {
    const node = this.getInternalNode(room, opaqueNodeId);
    return node.links.map((link) => {
      const targetOpaqueId =
        room.currentRound.realToOpaque.get(link.targetRealNodeKey) ||
        room.currentRound.spawnOpaqueId;
      return {
        nodeId: targetOpaqueId,
        bearingDeg: Math.round(link.bearingDeg),
        relativeDirection: classifyRelativeDirection(
          cameraHeading,
          link.bearingDeg
        ),
        compassDirection: headingToCompass(link.bearingDeg),
        distanceMeters: link.distanceMeters,
        label:
          room.currentRound.status === 'round_over' ? link.label : undefined,
      };
    });
  }

  private pushActivity(
    room: RoomRuntime,
    playerId: string,
    playerName: string,
    playerColor: string,
    tool: string,
    summary: string,
    details?: Record<string, unknown>
  ): void {
    const event: ActivityEvent = {
      id: `evt_${crypto.randomBytes(4).toString('hex')}`,
      timestamp: new Date().toISOString(),
      playerId,
      playerName,
      playerColor,
      tool,
      summary,
      details,
    };
    room.activityFeed.unshift(event);
    if (room.activityFeed.length > 100) {
      room.activityFeed.length = 100;
    }
    this.wsHub.broadcastToRoom(
      room.roomCode,
      room.roomCode === this.activeRoomCode,
      { type: 'activity_event', event }
    );
  }

  private broadcastRoomStateSync(room: RoomRuntime): void {
    if (!room.currentRound) return;
    this.wsHub.broadcastRoomStateSync(
      room.roomCode,
      room.roomCode === this.activeRoomCode,
      (playerId) => this.getPublicState(room.roomCode, playerId)
    );
  }

  private toPlayerInfo(p: MutablePlayerState): PlayerInfo {
    return {
      id: p.id,
      name: p.name,
      isHuman: p.isHuman,
      model: p.model,
      transport: p.transport,
      color: p.color,
      status: p.status,
      connected: p.connected,
      hasGuessed: p.hasGuessed,
      totalScore: p.totalScore,
      chips: p.chips,
      currentWager: p.currentWager,
      camera: { ...p.camera },
      currentNodeId: p.currentOpaqueNodeId,
      stepCount: p.stepCount,
      frameVersion: p.frameVersion,
      managed: p.managed,
      explorationCalls: p.explorationCalls,
      maxExplorationCalls: p.maxExplorationCalls ?? undefined,
    };
  }

  private toHumanPlayerView(
    room: RoomRuntime,
    h: MutablePlayerState
  ): HumanPlayerView {
    const humanNode = this.getInternalNode(room, h.currentOpaqueNodeId);
    const panoramaUrl = `/api/panoramas/${room.currentRound.roundId}/${h.currentOpaqueNodeId}/equirectangular.jpg`;
    return {
      id: h.id,
      name: h.name,
      color: h.color,
      connected: h.connected,
      isHost: h.id === room.hostPlayerId || Boolean(h.isHost),
      currentNodeId: h.currentOpaqueNodeId,
      spawnNodeId: room.currentRound.spawnOpaqueId,
      camera: { ...h.camera },
      availableMoves: this.computeAvailableMoves(
        room,
        h.currentOpaqueNodeId,
        h.camera.heading
      ),
      hasGuessed: h.hasGuessed,
      myGuess: h.myGuess,
      totalScore: h.totalScore,
      chips: h.chips,
      currentWager: h.currentWager,
      stepCount: h.stepCount,
      mapillaryImageId: humanNode.mapillaryImageId,
      panoramaUrl,
    };
  }

  public getLeaderboardEntries(roomCode?: string): LeaderboardEntry[] {
    const room = this.resolveRoom(roomCode);
    const all: MutablePlayerState[] =
      room.mode === 'spectator'
        ? [...Array.from(room.agents.values())]
        : [
            ...Array.from(room.humans.values()),
            ...Array.from(room.agents.values()),
          ];
    all.sort((a, b) => b.totalScore - a.totalScore || b.chips - a.chips);

    return all.map((p, idx) => {
      const roundsPlayed = p.roundScores.length;
      const best =
        roundsPlayed > 0
          ? Math.max(...p.roundScores.map((r) => r.score))
          : 0;
      const avg =
        roundsPlayed > 0 ? Math.round(p.totalScore / roundsPlayed) : 0;
      const entry: LeaderboardEntry = {
        rank: idx + 1,
        playerId: p.id,
        name: p.name,
        isHuman: p.isHuman,
        color: p.color,
        model: p.model,
        connected: p.connected,
        totalScore: p.totalScore,
        roundsPlayed,
        averageScore: avg,
        bestRoundScore: best,
        roundScores: [...p.roundScores],
      };
      if (room.bettingEnabled) {
        entry.chips = p.chips;
        entry.netChips = p.chips - room.startingChips;
      }
      return entry;
    });
  }

  public getLeaderboardPayload(roomCode?: string): LeaderboardPayload {
    const room = this.resolveRoom(roomCode);
    return {
      matchId: room.matchId,
      matchStatus: room.matchStatus,
      mode: room.mode,
      currentRoundNumber: room.currentRoundNumber,
      totalRounds: room.totalRounds,
      entries: this.getLeaderboardEntries(room.roomCode),
    };
  }

  public getPublicState(
    roomCode?: string,
    requestingPlayerId?: string
  ): PublicGameState {
    const room = this.resolveRoom(roomCode, requestingPlayerId);
    const primaryHuman =
      (requestingPlayerId && room.humans.get(requestingPlayerId)) ||
      (room.hostPlayerId && room.humans.get(room.hostPlayerId)) ||
      Array.from(room.humans.values())[0] ||
      this.createHumanState(room, requestingPlayerId || 'human', 'Spectator', true);

    const humansViews =
      room.mode === 'spectator'
        ? []
        : Array.from(room.humans.values()).map((h) =>
            this.toHumanPlayerView(room, h)
          );

    return {
      matchId: room.matchId,
      roomCode: room.roomCode,
      hostPlayerId: room.hostPlayerId,
      matchStatus: room.matchStatus,
      mode: room.mode,
      locationMode: room.locationMode,
      bettingEnabled: room.bettingEnabled,
      startingChips: room.startingChips,
      provider: room.providerChoice,
      activeLocationProvider: room.currentRound.scene.providerUsed,
      totalRounds: room.totalRounds,
      roundDurationSec: room.roundDurationSec,
      currentRoundNumber: room.currentRoundNumber,
      roundStatus: room.currentRound.status,
      timeRemainingSec: room.timeRemainingSec,
      human: this.toHumanPlayerView(room, primaryHuman),
      humans: humansViews,
      agents: Array.from(room.agents.values()).map((a) =>
        this.toPlayerInfo(a)
      ),
      activityFeed: room.activityFeed.slice(0, 60),
      roundSummary:
        room.currentRound.status === 'round_over'
          ? room.currentRound.summary
          : null,
      completedRounds: [...room.completedRounds],
      leaderboard: this.getLeaderboardEntries(room.roomCode),
      agyRunner: this.lifecycleHooks.getAgyStatus?.(),
      mcpStatus: this.getMcpStatusSync(),
    };
  }

  private getAgentBudget(agent: MutablePlayerState): AgentBudgetInfo {
    return {
      explorationCallsUsed: agent.explorationCalls,
      maxExplorationCalls: agent.maxExplorationCalls,
      remainingExplorationCalls:
        agent.maxExplorationCalls !== null
          ? Math.max(0, agent.maxExplorationCalls - agent.explorationCalls)
          : null,
      runnerSecondsRemaining:
        agent.roundDeadlineMs !== null
          ? Math.max(0, Math.ceil((agent.roundDeadlineMs - Date.now()) / 1000))
          : null,
    };
  }

  public getAgentState(agentId: string): AgentGameState {
    const { room, agent } = this.requireAgentWithRoom(agentId);
    this.lastMcpActivityAt = Date.now();

    const humanPlayers: AgentGameState['players'] =
      room.mode === 'spectator'
        ? []
        : Array.from(room.humans.values()).map((h) => ({
            id: h.id,
            name: h.name,
            isHuman: true,
            status: h.hasGuessed ? 'guessed' : 'exploring',
            hasGuessed: h.hasGuessed,
            totalScore: h.totalScore,
            chips: h.chips,
            currentWager: h.currentWager,
          }));

    const players: AgentGameState['players'] = [
      ...humanPlayers,
      ...Array.from(room.agents.values()).map((a) => ({
        id: a.id,
        name: a.name,
        isHuman: false,
        status: a.status,
        hasGuessed: a.hasGuessed,
        totalScore: a.totalScore,
        chips: a.chips,
        currentWager: a.currentWager,
      })),
    ];

    return {
      matchId: room.matchId,
      matchStatus: room.matchStatus,
      mode: room.mode,
      locationMode: room.locationMode,
      bettingEnabled: room.bettingEnabled,
      startingChips: room.startingChips,
      agentId: agent.id,
      agentName: agent.name,
      roundNumber: room.currentRoundNumber,
      totalRounds: room.totalRounds,
      roundStatus: room.currentRound.status,
      timeRemainingSec: room.timeRemainingSec,
      currentNodeId: agent.currentOpaqueNodeId,
      isAtStart: agent.currentOpaqueNodeId === room.currentRound.spawnOpaqueId,
      stepCount: agent.stepCount,
      camera: { ...agent.camera },
      compassDirection: headingToCompass(agent.camera.heading),
      availableMoves: this.computeAvailableMoves(
        room,
        agent.currentOpaqueNodeId,
        agent.camera.heading
      ),
      hasGuessed: agent.hasGuessed,
      myGuess: agent.myGuess,
      chips: agent.chips,
      currentWager: agent.currentWager,
      agentBudget: this.getAgentBudget(agent),
      players,
      roundSummary:
        room.currentRound.status === 'round_over'
          ? room.currentRound.summary
          : null,
    };
  }

  // ==================== Agent Management ====================

  public registerAgent(opts: {
    agentId?: string;
    name: string;
    model?: string;
    transport?: string;
    roomCode?: string;
  }): PlayerInfo {
    const room = this.resolveRoom(opts.roomCode);
    this.lastMcpActivityAt = Date.now();

    if (room.mode === 'solo' || room.mode === 'pvp') {
      throw new Error(
        `AI agents cannot join a ${room.mode.toUpperCase()} match. Switch match mode to 1v1, Free-For-All, PvPvAI, or Spectator.`
      );
    }

    const cleanName = opts.name.trim() || 'AI Explorer';
    const cleanTransport = opts.transport?.trim() || 'stdio';
    const existingById = opts.agentId
      ? room.agents.get(opts.agentId)
      : undefined;

    if (existingById) {
      existingById.name = cleanName;
      existingById.model = opts.model || existingById.model;
      existingById.transport = cleanTransport;
      existingById.connected = true;
      if (room.maxStepsPerRound !== null && existingById.maxExplorationCalls === null) {
        existingById.maxExplorationCalls = room.maxStepsPerRound;
      }
      existingById.status = existingById.hasGuessed ? 'guessed' : 'exploring';
      this.agentToRoom.set(existingById.id, room.roomCode);
      this.pushActivity(
        room,
        existingById.id,
        existingById.name,
        existingById.color,
        'reconnect',
        `Reconnected (${cleanTransport})`
      );
      this.broadcastRoomStateSync(room);
      this.broadcastMcpStatusIfChanged();
      return this.toPlayerInfo(existingById);
    }

    const activeAgents = Array.from(room.agents.values()).filter(
      (a) => a.connected
    );
    if (room.mode === '1v1' && activeAgents.length >= 1) {
      throw new Error(
        '1v1 mode already has an active AI opponent. Switch match mode to Free-For-All (ffa) to connect multiple agents.'
      );
    }

    const id =
      opts.agentId?.trim() ||
      `agent_${crypto.randomBytes(3).toString('hex')}`;
    const color = AGENT_COLORS[room.colorCursor % AGENT_COLORS.length];
    room.colorCursor += 1;

    const spawnNode = this.getInternalNode(room, room.currentRound.spawnOpaqueId);
    const agent: MutablePlayerState = {
      id,
      name: cleanName,
      isHuman: false,
      model: opts.model || 'external-mcp',
      transport: cleanTransport,
      color,
      status: 'exploring',
      connected: true,
      currentOpaqueNodeId: room.currentRound.spawnOpaqueId,
      camera: clampCamera(spawnNode.initialHeading, 0, 0),
      stepCount: 0,
      frameVersion: 1,
      managed: false,
      explorationCalls: 0,
      maxExplorationCalls: room.maxStepsPerRound,
      roundDeadlineMs: null,
      participatedThisRound: false,
      hasGuessed: false,
      myGuess: null,
      totalScore: 0,
      chips: room.startingChips,
      currentWager: null,
      roundScores: [],
    };
    room.agents.set(id, agent);
    this.agentToRoom.set(id, room.roomCode);

    this.pushActivity(
      room,
      agent.id,
      agent.name,
      agent.color,
      'join',
      `Connected via ${cleanTransport} (${agent.model})`
    );
    this.broadcastRoomStateSync(room);
    this.broadcastMcpStatusIfChanged();
    return this.toPlayerInfo(agent);
  }

  public registerManagedAgent(opts: {
    agentId: string;
    name: string;
    model: string;
    maxExplorationCalls: number;
    roomCode?: string;
  }): PlayerInfo {
    const room = this.resolveRoom(opts.roomCode);
    const existing = room.agents.get(opts.agentId);
    if (existing) {
      existing.name = opts.name;
      existing.model = opts.model;
      existing.transport = 'stdio';
      existing.managed = true;
      existing.connected = true;
      existing.maxExplorationCalls = opts.maxExplorationCalls;
      existing.status = existing.hasGuessed ? 'guessed' : 'exploring';
      this.agentToRoom.set(opts.agentId, room.roomCode);
      return this.toPlayerInfo(existing);
    }

    const color = AGENT_COLORS[room.colorCursor % AGENT_COLORS.length];
    room.colorCursor += 1;
    const spawnNode = this.getInternalNode(room, room.currentRound.spawnOpaqueId);
    const agent: MutablePlayerState = {
      id: opts.agentId,
      name: opts.name,
      isHuman: false,
      model: opts.model,
      transport: 'stdio',
      color,
      status: 'exploring',
      connected: true,
      currentOpaqueNodeId: room.currentRound.spawnOpaqueId,
      camera: clampCamera(spawnNode.initialHeading, 0, 0),
      stepCount: 0,
      frameVersion: 1,
      managed: true,
      explorationCalls: 0,
      maxExplorationCalls: opts.maxExplorationCalls,
      roundDeadlineMs: null,
      participatedThisRound: false,
      hasGuessed: false,
      myGuess: null,
      totalScore: 0,
      chips: room.startingChips,
      currentWager: null,
      roundScores: [],
    };
    room.agents.set(opts.agentId, agent);
    this.agentToRoom.set(opts.agentId, room.roomCode);
    this.pushActivity(
      room,
      agent.id,
      agent.name,
      agent.color,
      'join',
      `Auto-AI registered (${agent.model}, max ${opts.maxExplorationCalls} steps)`
    );
    this.broadcastRoomStateSync(room);
    return this.toPlayerInfo(agent);
  }

  private findAgentRoom(agentId: string): {
    room: RoomRuntime;
    agent: MutablePlayerState;
  } | null {
    const mappedCode = this.agentToRoom.get(agentId);
    if (mappedCode) {
      const r = this.rooms.get(mappedCode);
      const a = r?.agents.get(agentId);
      if (r && a) return { room: r, agent: a };
    }
    for (const r of this.rooms.values()) {
      const a = r.agents.get(agentId);
      if (a) {
        this.agentToRoom.set(agentId, r.roomCode);
        return { room: r, agent: a };
      }
    }
    return null;
  }

  private requireAgentWithRoom(agentId: string): {
    room: RoomRuntime;
    agent: MutablePlayerState;
  } {
    const found = this.findAgentRoom(agentId);
    if (!found) {
      throw new Error(`Unknown agentId: ${agentId}`);
    }
    return found;
  }

  public removeManagedAgent(agentId: string): void {
    const found = this.findAgentRoom(agentId);
    if (!found) return;
    const { room, agent } = found;
    if (!agent.managed) return;
    agent.connected = false;
    agent.status = 'disconnected';
    agent.roundDeadlineMs = null;
    agent.participatedThisRound = false;
    if (agent.roundScores.length === 0 && !agent.hasGuessed) {
      room.agents.delete(agentId);
      this.agentToRoom.delete(agentId);
    }
    this.broadcastRoomStateSync(room);
    this.checkRoundCompletion(room);
  }

  public setManagedAgentRoundAvailability(
    agentId: string,
    connected: boolean,
    status?: AgentStatus
  ): void {
    const found = this.findAgentRoom(agentId);
    if (!found) return;
    const { room, agent } = found;
    agent.connected = connected;
    if (status) {
      agent.status = status;
    }
    this.broadcastRoomStateSync(room);
    this.checkRoundCompletion(room);
  }

  public setAgentRoundDeadline(
    agentId: string,
    deadlineMs: number | null
  ): void {
    const found = this.findAgentRoom(agentId);
    if (!found) return;
    const { agent } = found;
    agent.roundDeadlineMs = deadlineMs;
    if (deadlineMs !== null) {
      agent.participatedThisRound = true;
    }
  }

  public setAgentStatus(agentId: string, status: AgentStatus): void {
    const found = this.findAgentRoom(agentId);
    if (!found) return;
    const { room, agent } = found;
    agent.status = status;
    this.wsHub.broadcastToRoom(
      room.roomCode,
      room.roomCode === this.activeRoomCode,
      {
        type: 'agent_camera_updated',
        agentId: agent.id,
        camera: { ...agent.camera },
        currentNodeId: agent.currentOpaqueNodeId,
        frameVersion: agent.frameVersion,
        status: agent.status,
      }
    );
  }

  public getAgentInfo(agentId: string): PlayerInfo | null {
    const found = this.findAgentRoom(agentId);
    return found ? this.toPlayerInfo(found.agent) : null;
  }

  public logAgentActivity(agentId: string, tool: string, summary: string): void {
    const found = this.findAgentRoom(agentId);
    if (!found) return;
    const { room, agent } = found;
    this.pushActivity(room, agent.id, agent.name, agent.color, tool, summary);
  }

  public disconnectAgent(agentId: string): void {
    const found = this.findAgentRoom(agentId);
    if (!found) return;
    const { room, agent } = found;
    if (agent.managed) return;
    agent.connected = false;
    agent.status = 'disconnected';
    if (agent.roundScores.length === 0 && !agent.hasGuessed) {
      room.agents.delete(agentId);
      this.agentToRoom.delete(agentId);
    }
    this.pushActivity(
      room,
      agent.id,
      agent.name,
      agent.color,
      'disconnect',
      'Disconnected from match'
    );
    this.broadcastRoomStateSync(room);
    this.broadcastMcpStatusIfChanged();
    this.checkRoundCompletion(room);
  }

  private handleAgentDisconnected(agentId: string): void {
    const found = this.findAgentRoom(agentId);
    if (!found || !found.agent.connected) return;
    this.disconnectAgent(agentId);
  }

  private consumeExplorationStep(agent: MutablePlayerState): void {
    this.lastMcpActivityAt = Date.now();
    agent.participatedThisRound = true;
    if (agent.roundDeadlineMs !== null && agent.explorationCalls >= 1) {
      const secLeft = Math.ceil((agent.roundDeadlineMs - Date.now()) / 1000);
      if (secLeft <= 30) {
        throw new Error(
          `TIME WARNING: Only ${Math.max(0, secLeft)}s remaining before round timeout! Stop exploring and call submit_guess IMMEDIATELY with your best latitude, longitude, and reasoning.`
        );
      }
    }
    if (
      agent.maxExplorationCalls !== null &&
      agent.explorationCalls >= agent.maxExplorationCalls
    ) {
      throw new Error(
        `Exploration step limit reached (${agent.explorationCalls}/${agent.maxExplorationCalls}). Call submit_guess IMMEDIATELY with your best latitude, longitude, and reasoning.`
      );
    }
    agent.explorationCalls += 1;
  }

  public async getAgentFrame(
    agentId: string,
    opts?: { includeCompassOverlay?: boolean; recordActivity?: boolean }
  ): Promise<AgentFramePayload> {
    const { room, agent } = this.requireAgentWithRoom(agentId);
    if (opts?.recordActivity) {
      this.consumeExplorationStep(agent);
    }
    const node = this.getInternalNode(room, agent.currentOpaqueNodeId);
    const jpegBuf = await this.panoramas.renderAgentViewport(
      room.currentRound.scene.location,
      node,
      agent.camera,
      { includeCompassOverlay: opts?.includeCompassOverlay }
    );

    if (opts?.recordActivity) {
      agent.status = agent.hasGuessed ? 'guessed' : 'exploring';
      this.pushActivity(
        room,
        agent.id,
        agent.name,
        agent.color,
        'look_around',
        `Captured ${Math.round(agent.camera.heading)}° ${headingToCompass(
          agent.camera.heading
        )} (zoom ${agent.camera.zoom.toFixed(1)}x)`
      );
      this.wsHub.broadcastToRoom(
        room.roomCode,
        room.roomCode === this.activeRoomCode,
        {
          type: 'agent_camera_updated',
          agentId: agent.id,
          camera: { ...agent.camera },
          currentNodeId: agent.currentOpaqueNodeId,
          frameVersion: agent.frameVersion,
          status: agent.status,
        }
      );
    }

    return {
      agentId: agent.id,
      roundNumber: room.currentRoundNumber,
      currentNodeId: agent.currentOpaqueNodeId,
      isAtStart: agent.currentOpaqueNodeId === room.currentRound.spawnOpaqueId,
      stepCount: agent.stepCount,
      camera: { ...agent.camera },
      compassDirection: headingToCompass(agent.camera.heading),
      availableMoves: this.computeAvailableMoves(
        room,
        agent.currentOpaqueNodeId,
        agent.camera.heading
      ),
      hasGuessed: agent.hasGuessed,
      agentBudget: this.getAgentBudget(agent),
      imageBase64: jpegBuf.toString('base64'),
      mimeType: 'image/jpeg',
    };
  }

  public async renderAgentViewportJpeg(agentId: string): Promise<Buffer> {
    const { room, agent } = this.requireAgentWithRoom(agentId);
    const node = this.getInternalNode(room, agent.currentOpaqueNodeId);
    return this.panoramas.renderAgentViewport(
      room.currentRound.scene.location,
      node,
      agent.camera,
      { includeCompassOverlay: true }
    );
  }

  public async panAndZoomAgent(
    agentId: string,
    heading: number,
    pitch: number,
    zoom: number
  ): Promise<AgentFramePayload> {
    const { room, agent } = this.requireAgentWithRoom(agentId);
    this.consumeExplorationStep(agent);
    agent.camera = clampCamera(heading, pitch, zoom);
    agent.frameVersion += 1;
    if (!agent.hasGuessed) agent.status = 'exploring';

    this.pushActivity(
      room,
      agent.id,
      agent.name,
      agent.color,
      'pan_and_zoom',
      `Panned to ${Math.round(agent.camera.heading)}° ${headingToCompass(
        agent.camera.heading
      )}, pitch ${Math.round(agent.camera.pitch)}°, zoom ${agent.camera.zoom.toFixed(1)}x`
    );
    this.wsHub.broadcastToRoom(
      room.roomCode,
      room.roomCode === this.activeRoomCode,
      {
        type: 'agent_camera_updated',
        agentId: agent.id,
        camera: { ...agent.camera },
        currentNodeId: agent.currentOpaqueNodeId,
        frameVersion: agent.frameVersion,
        status: agent.status,
      }
    );

    return this.getAgentFrame(agentId, { recordActivity: false });
  }

  public async moveAgent(
    agentId: string,
    opts: { direction?: MoveDirection; nodeId?: string }
  ): Promise<AgentFramePayload> {
    const { room, agent } = this.requireAgentWithRoom(agentId);
    this.consumeExplorationStep(agent);
    const currentNode = this.getInternalNode(room, agent.currentOpaqueNodeId);

    let targetOpaqueId: string | null = null;
    let movedDirection = opts.direction || 'forward';

    if (opts.nodeId) {
      const targetReal = room.currentRound.opaqueToReal.get(opts.nodeId);
      const valid = currentNode.links.find(
        (l) => l.targetRealNodeKey === targetReal
      );
      if (!valid) {
        throw new Error(
          `Node ${opts.nodeId} is not directly reachable from ${agent.currentOpaqueNodeId}.`
        );
      }
      targetOpaqueId = opts.nodeId;
      movedDirection = classifyRelativeDirection(
        agent.camera.heading,
        valid.bearingDeg
      );
    } else if (opts.direction) {
      const available = currentNode.links.map((l) => ({
        nodeId:
          room.currentRound.realToOpaque.get(l.targetRealNodeKey) ||
          room.currentRound.spawnOpaqueId,
        bearingDeg: l.bearingDeg,
      }));
      const match = resolveMoveByDirection(
        agent.camera.heading,
        available,
        opts.direction
      );
      if (!match) {
        throw new Error(
          `No road link available in direction '${opts.direction}' from ${agent.currentOpaqueNodeId}.`
        );
      }
      targetOpaqueId = match.nodeId;
    } else {
      throw new Error('Provide either direction or node_id to move.');
    }

    agent.currentOpaqueNodeId = targetOpaqueId;
    agent.stepCount += 1;
    agent.frameVersion += 1;
    if (!agent.hasGuessed) agent.status = 'moving';

    this.pushActivity(
      room,
      agent.id,
      agent.name,
      agent.color,
      'move',
      `Moved ${movedDirection} to ${targetOpaqueId} (step ${agent.stepCount})`
    );
    this.wsHub.broadcastToRoom(
      room.roomCode,
      room.roomCode === this.activeRoomCode,
      {
        type: 'agent_camera_updated',
        agentId: agent.id,
        camera: { ...agent.camera },
        currentNodeId: agent.currentOpaqueNodeId,
        frameVersion: agent.frameVersion,
        status: agent.status,
      }
    );
    this.broadcastRoomStateSync(room);

    return this.getAgentFrame(agentId, { recordActivity: false });
  }

  public async returnAgentToStart(agentId: string): Promise<AgentFramePayload> {
    const { room, agent } = this.requireAgentWithRoom(agentId);
    this.lastMcpActivityAt = Date.now();
    const spawnNode = this.getInternalNode(room, room.currentRound.spawnOpaqueId);
    agent.currentOpaqueNodeId = room.currentRound.spawnOpaqueId;
    agent.camera = clampCamera(spawnNode.initialHeading, 0, 0);
    agent.frameVersion += 1;
    if (!agent.hasGuessed) agent.status = 'exploring';

    this.pushActivity(
      room,
      agent.id,
      agent.name,
      agent.color,
      'return_to_start',
      'Returned to round spawn point'
    );
    this.wsHub.broadcastToRoom(
      room.roomCode,
      room.roomCode === this.activeRoomCode,
      {
        type: 'agent_camera_updated',
        agentId: agent.id,
        camera: { ...agent.camera },
        currentNodeId: agent.currentOpaqueNodeId,
        frameVersion: agent.frameVersion,
        status: agent.status,
      }
    );
    this.broadcastRoomStateSync(room);

    return this.getAgentFrame(agentId, { recordActivity: false });
  }

  private computeConfidenceAutoWager(
    agent: MutablePlayerState,
    reasoning?: string
  ): number {
    if (agent.chips <= 0) return 0;
    const stepBonus = Math.min(4, agent.explorationCalls) * 0.05;
    const reasonBonus =
      reasoning && reasoning.trim().length >= 20 ? 0.1 : 0.05;
    const ratio = Math.min(0.45, 0.2 + stepBonus + reasonBonus);
    return Math.max(1, Math.min(agent.chips, Math.round(agent.chips * ratio)));
  }

  public submitAgentGuess(
    agentId: string,
    latitude: number,
    longitude: number,
    reasoning?: string,
    wager?: number
  ): { accepted: true; agentState: AgentGameState } {
    const { room, agent } = this.requireAgentWithRoom(agentId);
    this.lastMcpActivityAt = Date.now();
    if (room.currentRound.status !== 'active') {
      throw new Error('Round is already over. Wait for the next round.');
    }
    if (agent.hasGuessed) {
      throw new Error('You have already submitted a guess for this round.');
    }

    let resolvedWager: number | undefined;
    if (room.bettingEnabled) {
      if (wager !== undefined && wager !== null) {
        if (!Number.isInteger(wager) || wager < 0) {
          throw new Error('Invalid wager: must be a non-negative integer.');
        }
        resolvedWager = Math.min(agent.chips, wager);
      } else {
        resolvedWager = this.computeConfidenceAutoWager(agent, reasoning);
      }
      agent.currentWager = resolvedWager;
    } else {
      agent.currentWager = null;
    }

    agent.participatedThisRound = true;
    agent.hasGuessed = true;
    agent.status = 'guessed';
    agent.myGuess = {
      playerId: agent.id,
      latitude,
      longitude,
      reasoning: reasoning?.trim() || undefined,
      ...(resolvedWager !== undefined ? { wager: resolvedWager } : {}),
      submittedAt: new Date().toISOString(),
    };

    this.pushActivity(
      room,
      agent.id,
      agent.name,
      agent.color,
      'submit_guess',
      room.bettingEnabled && resolvedWager !== undefined
        ? `Locked in guess with ${resolvedWager} chip wager! (coordinates hidden until reveal)`
        : 'Locked in guess! (coordinates hidden until reveal)'
    );

    this.checkRoundCompletion(room);
    if (room.currentRound.status === 'active') {
      this.broadcastRoomStateSync(room);
    }

    return { accepted: true, agentState: this.getAgentState(agentId) };
  }

  // ==================== Human Player Actions ====================

  public updateHumanCamera(
    heading: number,
    pitch: number,
    zoom: number,
    opts?: { roomCode?: string; playerId?: string }
  ): PublicGameState {
    const room = this.resolveRoom(opts?.roomCode, opts?.playerId);
    const human = this.ensureHumanInRoom(room, opts?.playerId);
    human.camera = clampCamera(heading, pitch, zoom);
    return this.getPublicState(room.roomCode, human.id);
  }

  public moveHuman(opts: {
    direction?: MoveDirection;
    nodeId?: string;
    roomCode?: string;
    playerId?: string;
  }): PublicGameState {
    const room = this.resolveRoom(opts.roomCode, opts.playerId);
    const human = this.ensureHumanInRoom(room, opts.playerId);
    const currentNode = this.getInternalNode(room, human.currentOpaqueNodeId);
    let targetOpaqueId: string | null = null;

    if (opts.nodeId) {
      const targetReal = room.currentRound.opaqueToReal.get(opts.nodeId);
      const valid = currentNode.links.find(
        (l) => l.targetRealNodeKey === targetReal
      );
      if (!valid) {
        throw new Error(`Invalid destination node ${opts.nodeId}`);
      }
      targetOpaqueId = opts.nodeId;
    } else if (opts.direction) {
      const available = currentNode.links.map((l) => ({
        nodeId:
          room.currentRound.realToOpaque.get(l.targetRealNodeKey) ||
          room.currentRound.spawnOpaqueId,
        bearingDeg: l.bearingDeg,
      }));
      const match = resolveMoveByDirection(
        human.camera.heading,
        available,
        opts.direction
      );
      if (!match) {
        throw new Error(`No road exit toward ${opts.direction}`);
      }
      targetOpaqueId = match.nodeId;
    }

    if (targetOpaqueId) {
      human.currentOpaqueNodeId = targetOpaqueId;
      human.stepCount += 1;
      this.broadcastRoomStateSync(room);
    }
    return this.getPublicState(room.roomCode, human.id);
  }

  public returnHumanToStart(opts?: {
    roomCode?: string;
    playerId?: string;
  }): PublicGameState {
    const room = this.resolveRoom(opts?.roomCode, opts?.playerId);
    const human = this.ensureHumanInRoom(room, opts?.playerId);
    const spawnNode = this.getInternalNode(room, room.currentRound.spawnOpaqueId);
    human.currentOpaqueNodeId = room.currentRound.spawnOpaqueId;
    human.camera = clampCamera(spawnNode.initialHeading, 0, 0);
    this.broadcastRoomStateSync(room);
    return this.getPublicState(room.roomCode, human.id);
  }

  public submitHumanGuess(
    latitude: number,
    longitude: number,
    opts?: { roomCode?: string; playerId?: string; wager?: number }
  ): PublicGameState {
    const room = this.resolveRoom(opts?.roomCode, opts?.playerId);
    if (room.mode === 'spectator') {
      throw new Error(
        'Spectator mode is AI-only; human players cannot submit guesses.'
      );
    }
    if (room.currentRound.status !== 'active') {
      throw new Error('Current round is already over.');
    }

    const human = this.ensureHumanInRoom(room, opts?.playerId);
    if (human.hasGuessed) {
      throw new Error('You already submitted a guess this round.');
    }

    let resolvedWager: number | undefined;
    if (room.bettingEnabled) {
      if (opts?.wager !== undefined && opts?.wager !== null) {
        if (!Number.isInteger(opts.wager) || opts.wager < 0) {
          throw new Error('Invalid wager: must be a non-negative integer.');
        }
        if (opts.wager > human.chips) {
          throw new Error(
            `Wager (${opts.wager}) exceeds your available chip balance (${human.chips}).`
          );
        }
        resolvedWager = opts.wager;
      } else {
        resolvedWager = 0;
      }
      human.currentWager = resolvedWager;
    } else {
      human.currentWager = null;
    }

    human.participatedThisRound = true;
    human.hasGuessed = true;
    human.status = 'guessed';
    human.myGuess = {
      playerId: human.id,
      latitude,
      longitude,
      ...(resolvedWager !== undefined ? { wager: resolvedWager } : {}),
      submittedAt: new Date().toISOString(),
    };

    this.pushActivity(
      room,
      human.id,
      human.name,
      human.color,
      'submit_guess',
      room.bettingEnabled && resolvedWager !== undefined
        ? `${human.name} locked in guess with ${resolvedWager} chip wager!`
        : `${human.name} locked in guess!`
    );

    this.checkRoundCompletion(room);
    if (room.currentRound.status === 'active') {
      this.broadcastRoomStateSync(room);
    }
    return this.getPublicState(room.roomCode, human.id);
  }

  public async getRoundNodeEquirectangularJpeg(
    roundId: string,
    opaqueNodeId: string
  ): Promise<Buffer> {
    let targetRoom: RoomRuntime | undefined;
    for (const r of this.rooms.values()) {
      if (r.currentRound?.roundId === roundId) {
        targetRoom = r;
        break;
      }
    }
    if (!targetRoom) {
      throw new Error('Requested panorama belongs to an expired round.');
    }
    if (!targetRoom.currentRound.opaqueToReal.has(opaqueNodeId)) {
      throw new Error(`Unknown panorama node: ${opaqueNodeId}`);
    }
    const node = this.getInternalNode(targetRoom, opaqueNodeId);
    return this.panoramas.getEquirectangularJpeg(
      targetRoom.currentRound.scene.location,
      node
    );
  }

  // ==================== Round Lifecycle & Betting Settlement ====================

  private checkRoundCompletion(room: RoomRuntime): void {
    if (
      room.matchStatus !== 'active' ||
      room.currentRound.status !== 'active'
    ) {
      return;
    }

    const connectedHumans = Array.from(room.humans.values()).filter(
      (h) => h.connected
    );
    const connectedAgents = Array.from(room.agents.values()).filter(
      (a) => a.connected
    );

    if (room.mode === 'spectator') {
      const anyAgentGuessed = Array.from(room.agents.values()).some(
        (a) => a.hasGuessed
      );
      if (
        (connectedAgents.length > 0 &&
          connectedAgents.every((a) => a.hasGuessed)) ||
        (connectedAgents.length === 0 && anyAgentGuessed)
      ) {
        this.endCurrentRound('all_guessed', room.roomCode);
      }
      return;
    }

    const allHumansGuessed =
      connectedHumans.length > 0 && connectedHumans.every((h) => h.hasGuessed);

    if (room.mode === 'solo' || room.mode === 'pvp') {
      if (allHumansGuessed) {
        this.endCurrentRound('all_guessed', room.roomCode);
      }
      return;
    }

    // 1v1, ffa, pvp_ai
    const allAgentsGuessed = connectedAgents.every((a) => a.hasGuessed);
    if (allHumansGuessed && allAgentsGuessed) {
      this.endCurrentRound('all_guessed', room.roomCode);
    }
  }

  public endCurrentRound(
    reason: 'all_guessed' | 'timeout' | 'manual' = 'manual',
    roomCode?: string,
    playerId?: string
  ): PublicGameState {
    const room = this.resolveRoom(roomCode, playerId);
    if (room.currentRound.status === 'round_over') {
      return this.getPublicState(room.roomCode, playerId);
    }

    this.stopRoomTimer(room);
    room.currentRound.status = 'round_over';
    this.lifecycleHooks.onRoundEnded?.(room.currentRoundNumber);

    const target = room.currentRound.scene.targetInfo;
    const humanParticipants =
      room.mode === 'spectator'
        ? []
        : Array.from(room.humans.values()).filter(
            (h) => h.connected || h.hasGuessed || h.participatedThisRound
          );
    const agentParticipants = Array.from(room.agents.values()).filter(
      (a) => a.connected || a.hasGuessed || a.participatedThisRound
    );
    const participants: MutablePlayerState[] = [
      ...humanParticipants,
      ...agentParticipants,
    ];

    const rawScored = participants.map((p) => {
      let distanceKm: number | null = null;
      let score = 0;

      if (p.myGuess) {
        distanceKm = Number(
          haversineDistanceKm(
            p.myGuess.latitude,
            p.myGuess.longitude,
            target.latitude,
            target.longitude
          ).toFixed(2)
        );
        score = calculateScore(distanceKm);
      }

      p.totalScore += score;
      p.roundScores.push({
        roundNumber: room.currentRoundNumber,
        score,
        distanceKm,
      });

      return { player: p, distanceKm, score };
    });

    const maxScore =
      rawScored.length > 0 ? Math.max(...rawScored.map((s) => s.score)) : 0;
    const minScore =
      rawScored.length > 0 ? Math.min(...rawScored.map((s) => s.score)) : 0;

    const results: RoundPlayerScore[] = rawScored.map(
      ({ player: p, distanceKm, score }) => {
        const base: RoundPlayerScore = {
          playerId: p.id,
          name: p.name,
          isHuman: p.isHuman,
          color: p.color,
          model: p.model,
          guess: p.myGuess,
          distanceKm,
          score,
        };

        if (room.bettingEnabled) {
          const beforeChips = Math.max(0, Math.floor(p.chips));
          const rawWager = p.currentWager ?? p.myGuess?.wager ?? 0;
          const wager = Math.max(
            0,
            Math.min(beforeChips, Math.floor(rawWager))
          );

          let chipDelta = 0;
          if (wager > 0) {
            if (rawScored.length === 1) {
              chipDelta = p.myGuess && score >= 2500 ? wager : -wager;
            } else if (maxScore === minScore) {
              chipDelta = maxScore > 0 ? 0 : -wager;
            } else if (score === maxScore && p.myGuess) {
              chipDelta = wager;
            } else {
              chipDelta = -wager;
            }
          }

          const chipsAfter = Math.max(0, beforeChips + chipDelta);
          p.chips = chipsAfter;

          base.wager = wager;
          base.chipDelta = chipDelta;
          base.chipsAfter = chipsAfter;
        }

        return base;
      }
    );

    results.sort((a, b) => b.score - a.score);

    const summary: RoundSummary = {
      roundNumber: room.currentRoundNumber,
      target,
      results,
      endedReason: reason,
    };

    room.currentRound.summary = summary;
    room.completedRounds.push(summary);

    this.pushActivity(
      room,
      'system',
      'Match Referee',
      '#10b981',
      'round_over',
      `Round ${room.currentRoundNumber} revealed: ${target.city}, ${target.country}`
    );

    const isActive = room.roomCode === this.activeRoomCode;
    this.wsHub.broadcastRoomRoundEnded(
      room.roomCode,
      isActive,
      summary,
      (pid) => this.getPublicState(room.roomCode, pid)
    );
    this.broadcastRoomStateSync(room);
    return this.getPublicState(room.roomCode, playerId);
  }

  public async advanceToNextRound(opts?: {
    roomCode?: string;
    playerId?: string;
  }): Promise<PublicGameState> {
    const room = this.resolveRoom(opts?.roomCode, opts?.playerId);
    if (room.matchStatus === 'finished') {
      return this.getPublicState(room.roomCode, opts?.playerId);
    }

    if (room.currentRound.status !== 'round_over') {
      this.endCurrentRound('manual', room.roomCode, opts?.playerId);
    }

    if (room.currentRoundNumber >= room.totalRounds) {
      room.matchStatus = 'finished';
      const leaderboard = this.getLeaderboardEntries(room.roomCode);
      const isActive = room.roomCode === this.activeRoomCode;
      this.wsHub.broadcastRoomMatchEnded(
        room.roomCode,
        isActive,
        leaderboard,
        (pid) => this.getPublicState(room.roomCode, pid)
      );
      this.broadcastRoomStateSync(room);
      return this.getPublicState(room.roomCode, opts?.playerId);
    }

    await this.setupRound(room, room.currentRoundNumber + 1);
    this.pushActivity(
      room,
      'system',
      'Match Referee',
      '#64748b',
      'round_start',
      `Round ${room.currentRoundNumber} of ${room.totalRounds} started`
    );
    this.broadcastRoomStateSync(room);
    return this.getPublicState(room.roomCode, opts?.playerId);
  }
}
