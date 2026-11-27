export type GameMode =
  | '1v1'
  | 'ffa'
  | 'pvp_ai'
  | 'pvp'
  | 'solo'
  | 'spectator';

export type LocationMode = 'standard' | 'big_cities' | 'mountain_regions';

export interface McpStatusInfo {
  connected: boolean;
  status: 'connected' | 'bridge_ready' | 'offline';
  httpBridgeReachable: boolean;
  activeAgentSockets: number;
  activeMcpAgents: number;
  transports: string[];
  lastActivityAt: number | null;
  agyAvailable: boolean;
}

export type RoundStatus = 'active' | 'round_over';

export type MatchStatus = 'lobby' | 'active' | 'finished';

export type MoveDirection = 'forward' | 'backward' | 'left' | 'right';

export type PanoramaProviderChoice = 'auto' | 'open' | 'wikimedia' | 'mapillary' | 'google';

export type AgentStatus =
  | 'idle'
  | 'exploring'
  | 'moving'
  | 'thinking'
  | 'guessed'
  | 'disconnected';

export interface CameraView {
  heading: number;
  pitch: number;
  zoom: number;
  fov: number;
}

export interface AvailableMove {
  nodeId: string;
  bearingDeg: number;
  relativeDirection: MoveDirection;
  compassDirection: string;
  distanceMeters: number;
  label?: string;
}

export interface PlayerGuess {
  playerId: string;
  latitude: number;
  longitude: number;
  reasoning?: string;
  wager?: number;
  submittedAt: string;
}

export interface RoundPlayerScore {
  playerId: string;
  name: string;
  isHuman: boolean;
  color: string;
  model?: string;
  guess: PlayerGuess | null;
  distanceKm: number | null;
  score: number;
  wager?: number;
  chipDelta?: number;
  chipsAfter?: number;
}

export interface TargetLocationInfo {
  latitude: number;
  longitude: number;
  name: string;
  city: string;
  country: string;
  region: string;
  provider: string;
}

export interface RoundSummary {
  roundNumber: number;
  target: TargetLocationInfo;
  results: RoundPlayerScore[];
  endedReason: 'all_guessed' | 'timeout' | 'manual';
}

export type CliProviderId = 'agy' | 'codex' | 'claude';

export type ModelEffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra';

export interface CliProviderStatus {
  provider: CliProviderId;
  label: string;
  available: boolean;
  path: string | null;
  version?: string | null;
  modelCount: number;
  error?: string;
}

export interface AgyModelOption {
  id: string;
  label: string;
  family: 'gemini' | 'claude' | 'gpt' | 'other';
  provider: CliProviderId;
  cliModel: string;
  supportedEfforts: ModelEffortLevel[];
  defaultEffort: ModelEffortLevel;
  effortVariantIds?: Partial<Record<ModelEffortLevel, string>>;
  badge?: string;
  description?: string;
}

export interface AgyBotRunState {
  agentId: string;
  modelId: string;
  provider?: CliProviderId;
  effort?: ModelEffortLevel;
  displayName: string;
  running: boolean;
  lastStatus:
    | 'idle'
    | 'spawning'
    | 'playing'
    | 'submitted'
    | 'timeout'
    | 'stopped'
    | 'error';
  lastMessage?: string;
  roundNumber: number | null;
  startedAt?: string;
  explorationCalls: number;
  maxStepsPerRound: number;
}

export interface AgyRunnerStatus {
  available: boolean;
  agyPath: string | null;
  providers: CliProviderStatus[];
  autoPlayEnabled: boolean;
  selectedModels: string[];
  defaultEffort: ModelEffortLevel;
  modelEfforts: Record<string, ModelEffortLevel>;
  maxStepsPerRound: number;
  timeoutSec: number;
  availableModels: AgyModelOption[];
  runs: AgyBotRunState[];
}

export interface PlayerInfo {
  id: string;
  name: string;
  isHuman: boolean;
  model?: string;
  transport?: string;
  color: string;
  status: AgentStatus;
  connected: boolean;
  hasGuessed: boolean;
  totalScore: number;
  chips: number;
  currentWager: number | null;
  camera: CameraView;
  currentNodeId: string;
  stepCount: number;
  frameVersion: number;
  managed?: boolean;
  explorationCalls?: number;
  maxExplorationCalls?: number;
}

export interface ActivityEvent {
  id: string;
  timestamp: string;
  playerId: string;
  playerName: string;
  playerColor: string;
  tool: string;
  summary: string;
  details?: Record<string, unknown>;
}

export interface LeaderboardEntry {
  rank: number;
  playerId: string;
  name: string;
  isHuman: boolean;
  color: string;
  model?: string;
  connected: boolean;
  totalScore: number;
  roundsPlayed: number;
  averageScore: number;
  bestRoundScore: number;
  chips?: number;
  netChips?: number;
  roundScores: Array<{
    roundNumber: number;
    score: number;
    distanceKm: number | null;
  }>;
}

export interface LeaderboardPayload {
  matchId: string;
  matchStatus: MatchStatus;
  mode: GameMode;
  currentRoundNumber: number;
  totalRounds: number;
  entries: LeaderboardEntry[];
}

export interface HumanPlayerView {
  id: string;
  name: string;
  color: string;
  connected: boolean;
  isHost?: boolean;
  currentNodeId: string;
  spawnNodeId: string;
  camera: CameraView;
  availableMoves: AvailableMove[];
  hasGuessed: boolean;
  myGuess: PlayerGuess | null;
  totalScore: number;
  chips: number;
  currentWager: number | null;
  stepCount: number;
  mapillaryImageId?: string;
  panoramaUrl: string;
}

export interface PublicGameState {
  matchId: string;
  roomCode: string;
  hostPlayerId: string | null;
  matchStatus: MatchStatus;
  mode: GameMode;
  locationMode: LocationMode;
  bettingEnabled: boolean;
  startingChips: number;
  provider: PanoramaProviderChoice;
  activeLocationProvider: string;
  totalRounds: number;
  roundDurationSec: number | null;
  currentRoundNumber: number;
  roundStatus: RoundStatus;
  timeRemainingSec: number | null;
  human: HumanPlayerView;
  humans: HumanPlayerView[];
  agents: PlayerInfo[];
  activityFeed: ActivityEvent[];
  roundSummary: RoundSummary | null;
  completedRounds: RoundSummary[];
  leaderboard: LeaderboardEntry[];
  agyRunner?: AgyRunnerStatus;
  mcpStatus: McpStatusInfo;
}

export interface AgentBudgetInfo {
  explorationCallsUsed: number;
  maxExplorationCalls: number | null;
  remainingExplorationCalls: number | null;
  runnerSecondsRemaining: number | null;
}

export interface AgentGameState {
  matchId: string;
  matchStatus: MatchStatus;
  mode: GameMode;
  locationMode: LocationMode;
  bettingEnabled: boolean;
  startingChips: number;
  agentId: string;
  agentName: string;
  roundNumber: number;
  totalRounds: number;
  roundStatus: RoundStatus;
  timeRemainingSec: number | null;
  currentNodeId: string;
  isAtStart: boolean;
  stepCount: number;
  camera: CameraView;
  compassDirection: string;
  availableMoves: AvailableMove[];
  hasGuessed: boolean;
  myGuess: PlayerGuess | null;
  chips: number;
  currentWager: number | null;
  agentBudget?: AgentBudgetInfo;
  players: Array<{
    id: string;
    name: string;
    isHuman: boolean;
    status: AgentStatus;
    hasGuessed: boolean;
    totalScore: number;
    chips?: number;
    currentWager?: number | null;
  }>;
  roundSummary: RoundSummary | null;
}

export interface AgentFramePayload {
  agentId: string;
  roundNumber: number;
  currentNodeId: string;
  isAtStart: boolean;
  stepCount: number;
  camera: CameraView;
  compassDirection: string;
  availableMoves: AvailableMove[];
  hasGuessed: boolean;
  agentBudget?: AgentBudgetInfo;
  imageBase64: string;
  mimeType: 'image/jpeg';
}

export interface HealthInfo {
  status: 'ok';
  configuredProviders: {
    open: boolean;
    wikimedia: boolean;
    mapillary: boolean;
    google: boolean;
  };
  mapillaryAccessToken: string | null;
  defaultProvider: PanoramaProviderChoice;
  mcpStatus?: McpStatusInfo;
}

export type WsServerMessage =
  | { type: 'state_sync'; state: PublicGameState }
  | { type: 'mcp_status_updated'; mcpStatus: McpStatusInfo }
  | { type: 'activity_event'; event: ActivityEvent }
  | {
      type: 'agent_camera_updated';
      agentId: string;
      camera: CameraView;
      currentNodeId: string;
      frameVersion: number;
      status: AgentStatus;
    }
  | { type: 'timer_tick'; timeRemainingSec: number | null }
  | { type: 'round_ended'; summary: RoundSummary; state: PublicGameState }
  | { type: 'match_ended'; leaderboard: LeaderboardEntry[]; state: PublicGameState };
