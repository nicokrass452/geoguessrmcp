import { execFile, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  AgyBotRunState,
  AgyModelOption,
  AgyRunnerStatus,
  CliProviderId,
  CliProviderStatus,
  MatchStatus,
  ModelEffortLevel,
} from '@geoguessr-mcp/shared';
import type { ServerConfig } from './config.js';
import type { GameEngine } from './gameEngine.js';
import {
  discoverCliModels,
  findCliBinaries,
  getCuratedFallbackModels,
  isEffortLevel,
  type CliExecutableSpec,
} from './modelDiscovery.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const AVAILABLE_AGY_MODELS: AgyModelOption[] = getCuratedFallbackModels();

const EFFORT_RANK: Record<ModelEffortLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
  xhigh: 3,
  max: 4,
  ultra: 5,
};

const PREFERRED_DEFAULT_MODELS = [
  'agy:gemini-4-hydrogen',
  'agy:claude-sonnet-5-5',
  'gemini-4-hydrogen-medium',
  'claude-sonnet-5-5-medium',
];

interface AgyRoomConfig {
  autoPlayEnabled: boolean;
  selectedModels: string[];
  defaultEffort: ModelEffortLevel;
  modelEfforts: Record<string, ModelEffortLevel>;
  maxStepsPerRound: number;
  timeoutSec: number;
}

interface ActiveProcessEntry {
  child: ChildProcess;
  timer: NodeJS.Timeout;
  logStream?: fs.WriteStream;
  tempFiles: string[];
  agentId: string;
  modelId: string;
  roundNumber: number;
  roomCode: string;
}

function killProcessTree(child: ChildProcess): void {
  const pid = child.pid;
  if (process.platform === 'win32' && pid) {
    execFile(
      'taskkill',
      ['/PID', String(pid), '/T', '/F'],
      { windowsHide: true },
      () => {}
    );
    return;
  }
  try {
    child.kill('SIGKILL');
  } catch {
    // ignore already exited
  }
}

function cleanupTempFiles(files: string[]): void {
  for (const f of files) {
    try {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    } catch {
      // ignore cleanup error
    }
  }
}

function resolveMcpServerDistEntry(): string {
  const candidates = [
    path.resolve(process.cwd(), 'mcp-server', 'dist', 'index.js'),
    path.resolve(__dirname, '..', '..', 'mcp-server', 'dist', 'index.js'),
    path.resolve(__dirname, '..', '..', '..', 'mcp-server', 'dist', 'index.js'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0];
}

export function modelIdToAgentId(modelId: string, roomCode?: string): string {
  const cleanId = modelId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const base = cleanId.startsWith('agy_') ? cleanId : `agy_${cleanId}`;
  const cleanRoom = roomCode?.trim().toUpperCase();
  if (!cleanRoom || cleanRoom === 'ARENA1' || cleanRoom === 'DEFAULT') {
    return base;
  }
  return `${base}_${cleanRoom.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

export class AgyRunner {
  private readonly config: ServerConfig;
  private readonly engine: GameEngine;
  private readonly sandboxDir: string;
  private readonly logsDir: string;

  private executables: Record<CliProviderId, CliExecutableSpec | null>;
  private providers: CliProviderStatus[];
  private availableModels: AgyModelOption[] = getCuratedFallbackModels();

  private defaultSelectedModels: string[] = [
    'agy:gemini-4-hydrogen',
    'agy:claude-sonnet-5-5',
  ];
  private defaultEffort: ModelEffortLevel = 'medium';
  private defaultModelEfforts: Record<string, ModelEffortLevel> = {};
  private defaultMaxStepsPerRound = 5;
  private defaultTimeoutSec = 120;

  private readonly roomConfigs = new Map<string, AgyRoomConfig>();
  private readonly activeProcs = new Map<string, ActiveProcessEntry>();
  private readonly runStates = new Map<string, AgyBotRunState>();
  private readonly roomRoundState = new Map<
    string,
    { roundNumber: number; active: boolean }
  >();
  private activeRoomCode = 'ARENA1';

  constructor(config: ServerConfig, engine: GameEngine) {
    this.config = config;
    this.engine = engine;
    this.executables = findCliBinaries();
    this.providers = [
      {
        provider: 'agy',
        label: 'Antigravity (agy)',
        available: Boolean(this.executables.agy),
        path: this.executables.agy?.displayPath ?? null,
        version: null,
        modelCount: 0,
      },
      {
        provider: 'codex',
        label: 'Codex CLI',
        available: Boolean(this.executables.codex),
        path: this.executables.codex?.displayPath ?? null,
        version: null,
        modelCount: 0,
      },
      {
        provider: 'claude',
        label: 'Claude Code CLI',
        available: Boolean(this.executables.claude),
        path: this.executables.claude?.displayPath ?? null,
        version: null,
        modelCount: 0,
      },
    ];
    this.sandboxDir = path.join(config.cacheDir, 'agy-sandbox');
    this.logsDir = path.join(config.cacheDir, 'agy-logs');
    fs.mkdirSync(this.sandboxDir, { recursive: true });
    fs.mkdirSync(this.logsDir, { recursive: true });
  }

  private hasAnyProvider(): boolean {
    return Boolean(
      this.executables.agy || this.executables.codex || this.executables.claude
    );
  }

  private pickDefaultModels(models: AgyModelOption[]): string[] {
    const chosen: string[] = [];
    for (const candidate of PREFERRED_DEFAULT_MODELS) {
      const resolved = this.resolveModelOption(candidate, models);
      if (resolved && !chosen.includes(resolved.option.id)) {
        chosen.push(resolved.option.id);
      }
      if (chosen.length >= 2) break;
    }
    if (chosen.length > 0) return chosen;
    return models.slice(0, 2).map((m) => m.id);
  }

  public async refreshDiscoveredModels(roomCode?: string): Promise<AgyRunnerStatus> {
    try {
      const catalog = await discoverCliModels();
      this.executables = catalog.executables;
      this.providers = catalog.providers;
      this.availableModels =
        catalog.models.length > 0 ? catalog.models : getCuratedFallbackModels();
      AVAILABLE_AGY_MODELS.splice(
        0,
        AVAILABLE_AGY_MODELS.length,
        ...this.availableModels
      );

      const sanitizedDefaults = this.sanitizeModels(this.defaultSelectedModels);
      this.defaultSelectedModels =
        sanitizedDefaults.length > 0
          ? sanitizedDefaults
          : this.pickDefaultModels(this.availableModels);

      for (const cfg of this.roomConfigs.values()) {
        if (cfg.selectedModels.length > 0) {
          const updated = this.sanitizeModels(cfg.selectedModels);
          cfg.selectedModels =
            updated.length > 0
              ? updated
              : this.pickDefaultModels(this.availableModels);
        }
      }
    } catch {
      // keep existing catalog on discovery failure
    }
    return this.getStatus(roomCode);
  }

  private resolveModelOption(
    idOrAlias: string,
    pool: AgyModelOption[] = this.availableModels
  ): { option: AgyModelOption; impliedEffort?: ModelEffortLevel } | null {
    const exact = pool.find((m) => m.id === idOrAlias);
    if (exact) return { option: exact };

    const byCliModel = pool.find((m) => m.cliModel === idOrAlias);
    if (byCliModel) return { option: byCliModel };

    for (const m of pool) {
      if (!m.effortVariantIds) continue;
      for (const [effort, variantId] of Object.entries(m.effortVariantIds)) {
        if (variantId === idOrAlias && isEffortLevel(effort)) {
          return { option: m, impliedEffort: effort };
        }
      }
    }
    return null;
  }

  private resolveEffortForModel(
    model: AgyModelOption,
    requested?: ModelEffortLevel
  ): ModelEffortLevel {
    const supported =
      model.supportedEfforts.length > 0
        ? model.supportedEfforts
        : [model.defaultEffort || 'medium'];
    if (!requested) return model.defaultEffort ?? supported[0] ?? 'medium';
    if (supported.includes(requested)) return requested;

    const reqRank = EFFORT_RANK[requested] ?? 1;
    let best = supported[0];
    let bestDist = Infinity;
    for (const candidate of supported) {
      const rank = EFFORT_RANK[candidate] ?? 1;
      const dist = Math.abs(rank - reqRank) + (rank > reqRank ? 0.1 : 0);
      if (dist < bestDist) {
        bestDist = dist;
        best = candidate;
      }
    }
    return best;
  }

  private sanitizeModels(
    models?: string[],
    captureEfforts?: Record<string, ModelEffortLevel>
  ): string[] {
    if (!Array.isArray(models)) return [...this.defaultSelectedModels];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of models) {
      const resolved = this.resolveModelOption(raw);
      if (!resolved) continue;
      if (!seen.has(resolved.option.id)) {
        seen.add(resolved.option.id);
        out.push(resolved.option.id);
      }
      if (
        captureEfforts &&
        resolved.impliedEffort &&
        !captureEfforts[resolved.option.id]
      ) {
        captureEfforts[resolved.option.id] = resolved.impliedEffort;
      }
    }
    return out;
  }

  private sanitizeModelEfforts(
    efforts?: Record<string, ModelEffortLevel>
  ): Record<string, ModelEffortLevel> {
    if (!efforts || typeof efforts !== 'object') return {};
    const out: Record<string, ModelEffortLevel> = {};
    for (const [rawKey, rawVal] of Object.entries(efforts)) {
      if (!isEffortLevel(rawVal)) continue;
      const resolved = this.resolveModelOption(rawKey);
      if (!resolved) continue;
      out[resolved.option.id] = this.resolveEffortForModel(
        resolved.option,
        rawVal
      );
    }
    return out;
  }

  private clampSteps(steps: number): number {
    return Math.max(2, Math.min(20, Math.round(steps)));
  }

  private clampTimeout(sec: number): number {
    return Math.max(30, Math.min(300, Math.round(sec)));
  }

  private getRoomConfig(roomCode?: string): AgyRoomConfig {
    const code = this.resolveRoomCode(roomCode);
    let cfg = this.roomConfigs.get(code);
    if (!cfg) {
      cfg = {
        autoPlayEnabled: false,
        selectedModels: [...this.defaultSelectedModels],
        defaultEffort: this.defaultEffort,
        modelEfforts: { ...this.defaultModelEfforts },
        maxStepsPerRound: this.defaultMaxStepsPerRound,
        timeoutSec: this.defaultTimeoutSec,
      };
      this.roomConfigs.set(code, cfg);
    }
    return cfg;
  }

  private isAgentInRoom(agentId: string, modelId: string, roomCode: string): boolean {
    if (agentId === modelIdToAgentId(modelId, roomCode)) return true;
    const resolved = this.resolveModelOption(modelId);
    if (resolved && agentId === modelIdToAgentId(resolved.option.id, roomCode)) {
      return true;
    }
    return false;
  }

  public getStatus(roomCode?: string): AgyRunnerStatus {
    const targetRoom = this.resolveRoomCode(roomCode);
    const cfg = this.getRoomConfig(targetRoom);
    const runs = Array.from(this.runStates.values())
      .filter((r) => this.isAgentInRoom(r.agentId, r.modelId, targetRoom))
      .map((r) => {
        const info = this.engine.getAgentInfo(r.agentId);
        return {
          ...r,
          explorationCalls: info?.explorationCalls ?? r.explorationCalls,
          maxStepsPerRound: cfg.maxStepsPerRound,
        };
      });

    return {
      available: this.hasAnyProvider(),
      agyPath: this.executables.agy?.displayPath ?? null,
      providers: this.providers,
      autoPlayEnabled: cfg.autoPlayEnabled,
      selectedModels: [...cfg.selectedModels],
      defaultEffort: cfg.defaultEffort,
      modelEfforts: { ...cfg.modelEfforts },
      maxStepsPerRound: cfg.maxStepsPerRound,
      timeoutSec: cfg.timeoutSec,
      availableModels: this.availableModels,
      runs,
    };
  }

  private resolveRoomCode(roomCode?: string): string {
    const clean = roomCode?.trim().toUpperCase();
    if (!clean || clean === 'DEFAULT') return this.activeRoomCode;
    return clean;
  }

  private getRoomRoundState(roomCode?: string): {
    roundNumber: number;
    active: boolean;
  } {
    const code = this.resolveRoomCode(roomCode);
    let st = this.roomRoundState.get(code);
    if (!st) {
      st = { roundNumber: 1, active: false };
      this.roomRoundState.set(code, st);
    }
    return st;
  }

  public onRoomConfigured(
    roomCode: string,
    opts: {
      allowAi: boolean;
      matchStatus: MatchStatus;
      autoPlayEnabled?: boolean;
      selectedModels?: string[];
      defaultEffort?: ModelEffortLevel;
      modelEfforts?: Record<string, ModelEffortLevel>;
      maxStepsPerRound?: number;
      timeoutSec?: number;
    }
  ): void {
    const targetRoom = this.resolveRoomCode(roomCode);
    this.activeRoomCode = targetRoom;
    this.roomRoundState.set(targetRoom, { roundNumber: 1, active: false });

    const existingCfg = this.roomConfigs.get(targetRoom);
    const baseEfforts = opts.modelEfforts
      ? this.sanitizeModelEfforts(opts.modelEfforts)
      : existingCfg
        ? { ...existingCfg.modelEfforts }
        : { ...this.defaultModelEfforts };

    const selectedModels = Array.isArray(opts.selectedModels)
      ? this.sanitizeModels(opts.selectedModels, baseEfforts)
      : existingCfg
        ? [...existingCfg.selectedModels]
        : [...this.defaultSelectedModels];

    if (opts.allowAi && Array.isArray(opts.selectedModels) && selectedModels.length > 0) {
      this.defaultSelectedModels = [...selectedModels];
    }

    const defaultEffort = isEffortLevel(opts.defaultEffort)
      ? opts.defaultEffort
      : existingCfg?.defaultEffort ?? this.defaultEffort;
    if (isEffortLevel(opts.defaultEffort)) {
      this.defaultEffort = defaultEffort;
    }
    if (opts.modelEfforts) {
      this.defaultModelEfforts = { ...baseEfforts };
    }

    const maxStepsPerRound =
      typeof opts.maxStepsPerRound === 'number'
        ? this.clampSteps(opts.maxStepsPerRound)
        : existingCfg?.maxStepsPerRound ?? this.defaultMaxStepsPerRound;
    if (typeof opts.maxStepsPerRound === 'number') {
      this.defaultMaxStepsPerRound = maxStepsPerRound;
    }

    const timeoutSec =
      typeof opts.timeoutSec === 'number'
        ? this.clampTimeout(opts.timeoutSec)
        : existingCfg?.timeoutSec ?? this.defaultTimeoutSec;
    if (typeof opts.timeoutSec === 'number') {
      this.defaultTimeoutSec = timeoutSec;
    }

    const autoPlayEnabled = opts.allowAi
      ? typeof opts.autoPlayEnabled === 'boolean'
        ? opts.autoPlayEnabled
        : existingCfg?.autoPlayEnabled ?? false
      : false;

    this.roomConfigs.set(targetRoom, {
      autoPlayEnabled,
      selectedModels,
      defaultEffort,
      modelEfforts: baseEfforts,
      maxStepsPerRound,
      timeoutSec,
    });

    if (
      opts.allowAi &&
      this.hasAnyProvider() &&
      selectedModels.length > 0 &&
      (opts.matchStatus === 'lobby' || autoPlayEnabled)
    ) {
      for (const modelId of selectedModels) {
        const resolved = this.resolveModelOption(modelId);
        if (!resolved || !this.executables[resolved.option.provider]) continue;
        const opt = resolved.option;
        this.engine.registerManagedAgent({
          agentId: modelIdToAgentId(opt.id, targetRoom),
          name: opt.label,
          model: opt.id,
          maxExplorationCalls: maxStepsPerRound,
          roomCode: targetRoom,
        });
      }
    }
  }

  public onMatchReset(roomCode?: string): void {
    const targetRoom = this.resolveRoomCode(roomCode);
    this.stopRoomRuns(targetRoom, 'Match restarted', false);
    this.roomRoundState.set(targetRoom, { roundNumber: 1, active: false });
    for (const [agentId, st] of Array.from(this.runStates.entries())) {
      if (this.isAgentInRoom(agentId, st.modelId, targetRoom)) {
        this.runStates.delete(agentId);
      }
    }
  }

  public onRoundStarted(roundNumber: number, roomCode?: string): void {
    const targetRoom = this.resolveRoomCode(roomCode);
    this.activeRoomCode = targetRoom;
    this.stopRoomRuns(targetRoom, 'Round transitioned', false);
    this.roomRoundState.set(targetRoom, { roundNumber, active: true });

    const cfg = this.getRoomConfig(targetRoom);
    for (const modelId of cfg.selectedModels) {
      const agentId = modelIdToAgentId(modelId, targetRoom);
      const state = this.runStates.get(agentId);
      if (state) {
        state.running = false;
        state.lastStatus = 'idle';
        state.lastMessage = undefined;
        state.roundNumber = roundNumber;
        state.explorationCalls = 0;
        state.maxStepsPerRound = cfg.maxStepsPerRound;
      }
    }

    if (cfg.autoPlayEnabled && cfg.selectedModels.length > 0 && this.hasAnyProvider()) {
      this.triggerCurrentRound(undefined, targetRoom);
    }
  }

  public onRoundEnded(_roundNumber: number, roomCode?: string): void {
    const targetRoom = this.resolveRoomCode(roomCode);
    const st = this.getRoomRoundState(targetRoom);
    st.active = false;
    this.stopRoomRuns(targetRoom, 'Round ended', false);
  }

  public updateConfig(opts: {
    autoPlayEnabled?: boolean;
    selectedModels?: string[];
    defaultEffort?: ModelEffortLevel;
    modelEfforts?: Record<string, ModelEffortLevel>;
    maxStepsPerRound?: number;
    timeoutSec?: number;
    roomCode?: string;
  }): AgyRunnerStatus {
    const targetRoom = this.resolveRoomCode(opts.roomCode);
    const cfg = this.getRoomConfig(targetRoom);
    const prevAuto = cfg.autoPlayEnabled;

    if (typeof opts.autoPlayEnabled === 'boolean') {
      cfg.autoPlayEnabled = opts.autoPlayEnabled;
    }
    if (isEffortLevel(opts.defaultEffort)) {
      cfg.defaultEffort = opts.defaultEffort;
      this.defaultEffort = opts.defaultEffort;
    }
    if (opts.modelEfforts) {
      cfg.modelEfforts = {
        ...cfg.modelEfforts,
        ...this.sanitizeModelEfforts(opts.modelEfforts),
      };
      this.defaultModelEfforts = { ...cfg.modelEfforts };
    }
    if (typeof opts.maxStepsPerRound === 'number') {
      cfg.maxStepsPerRound = this.clampSteps(opts.maxStepsPerRound);
      this.defaultMaxStepsPerRound = cfg.maxStepsPerRound;
    }
    if (typeof opts.timeoutSec === 'number') {
      cfg.timeoutSec = this.clampTimeout(opts.timeoutSec);
      this.defaultTimeoutSec = cfg.timeoutSec;
    }

    if (Array.isArray(opts.selectedModels)) {
      const nextModels = this.sanitizeModels(opts.selectedModels, cfg.modelEfforts);
      const removed = cfg.selectedModels.filter((m) => !nextModels.includes(m));
      for (const oldModelId of removed) {
        const agentId = modelIdToAgentId(oldModelId, targetRoom);
        this.stopSingleRun(agentId, 'Deselected by player');
        this.runStates.delete(agentId);
        this.engine.removeManagedAgent(agentId);
      }
      cfg.selectedModels = nextModels;
      if (nextModels.length > 0) {
        this.defaultSelectedModels = [...nextModels];
      }
    }

    const roomState = this.getRoomRoundState(targetRoom);
    if (this.hasAnyProvider() && cfg.selectedModels.length > 0) {
      if (roomState.active && cfg.autoPlayEnabled) {
        for (const modelId of cfg.selectedModels) {
          const resolved = this.resolveModelOption(modelId);
          if (!resolved || !this.executables[resolved.option.provider]) continue;
          const opt = resolved.option;
          this.engine.registerManagedAgent({
            agentId: modelIdToAgentId(opt.id, targetRoom),
            name: opt.label,
            model: opt.id,
            maxExplorationCalls: cfg.maxStepsPerRound,
            roomCode: targetRoom,
          });
        }
        if (!prevAuto || opts.selectedModels) {
          this.triggerCurrentRound(undefined, targetRoom);
        }
      } else if (!roomState.active) {
        for (const modelId of cfg.selectedModels) {
          const resolved = this.resolveModelOption(modelId);
          if (!resolved || !this.executables[resolved.option.provider]) continue;
          const opt = resolved.option;
          this.engine.registerManagedAgent({
            agentId: modelIdToAgentId(opt.id, targetRoom),
            name: opt.label,
            model: opt.id,
            maxExplorationCalls: cfg.maxStepsPerRound,
            roomCode: targetRoom,
          });
        }
      }
    }

    this.engine.notifyStateChanged(targetRoom);
    return this.getStatus(targetRoom);
  }

  public triggerCurrentRound(
    overrideModels?: string[],
    roomCode?: string
  ): AgyRunnerStatus {
    if (!this.hasAnyProvider()) {
      throw new Error(
        'No AI CLI binaries (agy, codex, claude) were found on this machine.'
      );
    }
    const targetRoom = this.resolveRoomCode(roomCode);
    const roomState = this.getRoomRoundState(targetRoom);
    if (!roomState.active) {
      throw new Error('Cannot summon AI opponents while the round is over.');
    }

    const cfg = this.getRoomConfig(targetRoom);
    if (Array.isArray(overrideModels)) {
      cfg.selectedModels = this.sanitizeModels(overrideModels, cfg.modelEfforts);
    }
    // Keep AI opponents active for subsequent rounds once summoned in this match
    cfg.autoPlayEnabled = true;

    const targets = cfg.selectedModels
      .map((id) => this.resolveModelOption(id)?.option ?? null)
      .filter((m): m is AgyModelOption => Boolean(m));

    for (const model of targets) {
      const agentId = modelIdToAgentId(model.id, targetRoom);
      if (this.activeProcs.has(agentId)) continue;

      const registered = this.engine.registerManagedAgent({
        agentId,
        name: model.label,
        model: model.id,
        maxExplorationCalls: cfg.maxStepsPerRound,
        roomCode: targetRoom,
      });

      if (registered.hasGuessed) continue;

      this.spawnAgyBot(model, agentId, roomState.roundNumber, targetRoom, cfg);
    }

    this.engine.notifyStateChanged(targetRoom);
    return this.getStatus(targetRoom);
  }

  private spawnAgyBot(
    model: AgyModelOption,
    agentId: string,
    roundNumber: number,
    roomCode: string,
    cfg: AgyRoomConfig
  ): void {
    const execSpec = this.executables[model.provider];
    const effort = this.resolveEffortForModel(
      model,
      cfg.modelEfforts[model.id] ?? cfg.defaultEffort
    );

    if (!execSpec) {
      const runState: AgyBotRunState = {
        agentId,
        modelId: model.id,
        provider: model.provider,
        effort,
        displayName: model.label,
        running: false,
        lastStatus: 'error',
        lastMessage: `${model.provider} CLI binary is not available on this host`,
        roundNumber,
        startedAt: new Date().toISOString(),
        explorationCalls: 0,
        maxStepsPerRound: cfg.maxStepsPerRound,
      };
      this.runStates.set(agentId, runState);
      this.engine.setManagedAgentRoundAvailability(agentId, false, 'disconnected');
      return;
    }

    const maxStepsPerRound = cfg.maxStepsPerRound;
    const timeoutSec = cfg.timeoutSec;
    const deadlineMs = Date.now() + timeoutSec * 1000;
    this.engine.setAgentRoundDeadline(agentId, deadlineMs);

    const logFile = path.join(this.logsDir, `round-${roundNumber}-${agentId}.log`);
    let logStream: fs.WriteStream | undefined;
    try {
      logStream = fs.createWriteStream(logFile, { flags: 'a' });
      logStream.on('error', () => {});
      logStream.write(
        `\n=== Round ${roundNumber} | ${model.label} (${model.id}) [${model.provider} effort=${effort}] | agentId=${agentId} | maxSteps=${maxStepsPerRound} | timeout=${timeoutSec}s | ${new Date().toISOString()} ===\n`
      );
    } catch {
      logStream = undefined;
    }

    const runState: AgyBotRunState = {
      agentId,
      modelId: model.id,
      provider: model.provider,
      effort,
      displayName: model.label,
      running: true,
      lastStatus: 'spawning',
      lastMessage: `Starting fresh ${model.label} (${effort}) for Round ${roundNumber}`,
      roundNumber,
      startedAt: new Date().toISOString(),
      explorationCalls: 0,
      maxStepsPerRound,
    };
    this.runStates.set(agentId, runState);
    this.engine.logAgentActivity(
      agentId,
      'agy_spawn',
      `Summoned ${model.label} via ${model.provider} (${effort}, max ${maxStepsPerRound} steps, ${timeoutSec}s timeout)`
    );

    const maxFollowupCalls = Math.max(1, maxStepsPerRound - 1);
    const prompt = [
      `You are "${model.label}", competing autonomously in Round ${roundNumber} of GeoGuessr MCP Arena.`,
      `CRITICAL IDENTITY RULE: On EVERY call to the geoguessr-arena MCP server (get_game_state, look_around, pan_and_zoom, move, return_to_start, submit_guess), you MUST pass agent_id: "${agentId}".`,
      `FAIR PLAY RULE: Rely ONLY on the street-view images and compass metadata returned by geoguessr-arena MCP tools. Do NOT run shell commands, read local workspace files, or search outside tools.`,
      `STRICT BUDGET & PACING: You have a hard cap of ${maxStepsPerRound} exploration calls (look_around / pan_and_zoom / move combined) and a ${timeoutSec}s round timer (every response includes agentBudget.remainingExplorationCalls and agentBudget.runnerSecondsRemaining).`,
      `Be brisk and decisive: do 1 look_around, then at most 1-${maxFollowupCalls} targeted pan_and_zoom or move calls. Do NOT waste multiple zooms trying to read tiny blurry text.`,
      `If remainingExplorationCalls hits 0, runnerSecondsRemaining drops below 35s, or any tool returns TIME WARNING or step limit reached, IMMEDIATELY call submit_guess with your best coordinates.`,
      `INSTRUCTIONS:`,
      `1. Call get_game_state with { "agent_id": "${agentId}" }.`,
      `2. Call look_around with { "agent_id": "${agentId}" } to view your starting scene.`,
      `3. Optionally make 1-${maxFollowupCalls} focused pan_and_zoom or move calls to inspect signs, language, driving side, architecture, and sun angle.`,
      `4. Call submit_guess with { "agent_id": "${agentId}", "latitude": <number>, "longitude": <number>, "reasoning": "<concise summary of visual clues observed>", "wager": <optional integer chip wager when bettingEnabled is true> } well before timeout.`,
    ].join('\n');

    const backendUrl = `http://localhost:${this.config.port}`;
    const mcpEntry = resolveMcpServerDistEntry();
    const sharedEnv: NodeJS.ProcessEnv = {
      ...process.env,
      GEOGUESSR_AGENT_ID: agentId,
      GEOGUESSR_AGENT_NAME: model.label,
      GEOGUESSR_AGENT_MODEL: model.id,
      GEOGUESSR_ROOM_CODE: roomCode,
      GAME_BACKEND_URL: backendUrl,
    };

    const tempFiles: string[] = [];
    let providerArgs: string[] = [];

    if (model.provider === 'agy') {
      const cliModelId =
        model.effortVariantIds?.[effort] ??
        model.effortVariantIds?.[model.defaultEffort] ??
        model.cliModel;
      providerArgs = [
        '-p',
        prompt,
        '--model',
        cliModelId,
        '--mode',
        'auto',
        '--dangerously-skip-permissions',
        '--disable-slash-commands',
        '--print-timeout',
        `${timeoutSec + 10}s`,
        '--output-format',
        'text',
      ];
    } else if (model.provider === 'claude') {
      const mcpConfigPath = path.join(
        os.tmpdir(),
        `geoarena-claude-mcp-${agentId}-r${roundNumber}-${Date.now()}.json`
      );
      fs.writeFileSync(
        mcpConfigPath,
        JSON.stringify(
          {
            mcpServers: {
              'geoguessr-arena': {
                command: process.execPath,
                args: [
                  mcpEntry,
                  '--transport',
                  'stdio',
                  '--backend-url',
                  backendUrl,
                  '--agent-id',
                  agentId,
                ],
                env: {
                  GEOGUESSR_AGENT_ID: agentId,
                  GEOGUESSR_AGENT_NAME: model.label,
                  GEOGUESSR_AGENT_MODEL: model.id,
                  GEOGUESSR_ROOM_CODE: roomCode,
                  GAME_BACKEND_URL: backendUrl,
                },
              },
            },
          },
          null,
          2
        )
      );
      tempFiles.push(mcpConfigPath);
      providerArgs = [
        '-p',
        prompt,
        '--model',
        model.cliModel,
        '--effort',
        effort,
        '--mcp-config',
        mcpConfigPath,
        '--strict-mcp-config',
        '--allowedTools',
        'mcp__geoguessr-arena__*',
        '--dangerously-skip-permissions',
        '--output-format',
        'text',
      ];
    } else {
      // Codex CLI
      const mcpArgs = [
        mcpEntry,
        '--transport',
        'stdio',
        '--backend-url',
        backendUrl,
        '--agent-id',
        agentId,
      ];
      providerArgs = [
        'exec',
        '--model',
        model.cliModel,
        '-c',
        `model_reasoning_effort=${JSON.stringify(effort)}`,
        '-c',
        `mcp_servers.geoguessr_arena.command=${JSON.stringify(process.execPath)}`,
        '-c',
        `mcp_servers.geoguessr_arena.args=${JSON.stringify(mcpArgs)}`,
        '-s',
        'read-only',
        '--skip-git-repo-check',
        '--ephemeral',
        prompt,
      ];
    }

    const child = spawn(
      execSpec.command,
      [...execSpec.prefixArgs, ...providerArgs],
      {
        cwd: this.sandboxDir,
        env: sharedEnv,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    runState.lastStatus = 'playing';

    let stderrTail = '';
    child.stdout?.on('data', (chunk) => {
      logStream?.write(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      const text = chunk.toString();
      stderrTail = (stderrTail + text).slice(-500);
      logStream?.write(`[stderr] ${text}`);
    });

    const timer = setTimeout(() => {
      const active = this.activeProcs.get(agentId);
      if (!active || active.child !== child) return;
      this.activeProcs.delete(agentId);
      this.engine.setAgentRoundDeadline(agentId, null);
      killProcessTree(child);
      cleanupTempFiles(active.tempFiles);

      const info = this.engine.getAgentInfo(agentId);
      runState.running = false;
      if (info?.hasGuessed) {
        runState.lastStatus = 'submitted';
        runState.lastMessage = 'Guess submitted before timeout';
      } else {
        runState.lastStatus = 'timeout';
        runState.lastMessage = `Timed out after ${timeoutSec}s`;
        this.engine.logAgentActivity(
          agentId,
          'timeout',
          `${model.label} timed out after ${timeoutSec}s`
        );
        this.engine.setManagedAgentRoundAvailability(agentId, false, 'idle');
      }
      if (logStream && !logStream.writableEnded) {
        logStream.end(
          `\n=== Closed (timeout after ${timeoutSec}s) | ${new Date().toISOString()} ===\n`
        );
      }
      this.engine.notifyStateChanged(roomCode);
    }, (timeoutSec + 12) * 1000);

    this.activeProcs.set(agentId, {
      child,
      timer,
      logStream,
      tempFiles,
      agentId,
      modelId: model.id,
      roundNumber,
      roomCode,
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      const active = this.activeProcs.get(agentId);
      if (active?.child === child) {
        this.activeProcs.delete(agentId);
        cleanupTempFiles(active.tempFiles);
      } else {
        cleanupTempFiles(tempFiles);
      }
      this.engine.setAgentRoundDeadline(agentId, null);
      runState.running = false;
      runState.lastStatus = 'error';
      runState.lastMessage = err.message;
      if (logStream && !logStream.writableEnded) {
        logStream.end(
          `\n=== Closed (spawn error: ${err.message}) | ${new Date().toISOString()} ===\n`
        );
      }
      this.engine.logAgentActivity(agentId, 'error', `Spawn failed: ${err.message}`);
      this.engine.setManagedAgentRoundAvailability(agentId, false, 'disconnected');
      this.engine.notifyStateChanged(roomCode);
    });

    child.on('exit', (code) => {
      clearTimeout(timer);
      const currentEntry = this.activeProcs.get(agentId);
      if (!currentEntry || currentEntry.child !== child) {
        cleanupTempFiles(tempFiles);
        return;
      }
      this.activeProcs.delete(agentId);
      cleanupTempFiles(currentEntry.tempFiles);
      this.engine.setAgentRoundDeadline(agentId, null);

      const info = this.engine.getAgentInfo(agentId);
      runState.running = false;
      runState.explorationCalls = info?.explorationCalls ?? runState.explorationCalls;

      if (info?.hasGuessed) {
        runState.lastStatus = 'submitted';
        runState.lastMessage = 'Submitted guess and exited cleanly';
      } else if (!this.getRoomRoundState(roomCode).active) {
        runState.lastStatus = 'stopped';
        runState.lastMessage = 'Round closed before guess';
      } else {
        runState.lastStatus = 'error';
        runState.lastMessage =
          code === 0
            ? 'Exited without submitting a guess'
            : `Exited (code ${code ?? 'unknown'})${stderrTail ? `: ${stderrTail.trim().slice(-120)}` : ''}`;
        this.engine.logAgentActivity(
          agentId,
          'agy_exit',
          runState.lastMessage
        );
        this.engine.setManagedAgentRoundAvailability(agentId, false, 'idle');
      }
      if (logStream && !logStream.writableEnded) {
        logStream.end(
          `\n=== Closed (exit code ${code ?? 'unknown'}: ${runState.lastStatus}) | ${new Date().toISOString()} ===\n`
        );
      }
      this.engine.notifyStateChanged(roomCode);
    });
  }

  private stopRoomRuns(
    roomCode: string,
    reason: string,
    notify = false
  ): void {
    const targetRoom = this.resolveRoomCode(roomCode);
    const ids = Array.from(this.activeProcs.entries())
      .filter(([, entry]) => entry.roomCode === targetRoom)
      .map(([id]) => id);
    const roomActive = this.getRoomRoundState(targetRoom).active;
    for (const id of ids) {
      this.stopSingleRun(id, reason);
      const info = this.engine.getAgentInfo(id);
      if (roomActive && info && !info.hasGuessed) {
        this.engine.setManagedAgentRoundAvailability(id, false, 'idle');
      }
    }
    if (notify) {
      this.engine.notifyStateChanged(targetRoom);
    }
  }

  private stopSingleRun(agentId: string, reason: string): void {
    const entry = this.activeProcs.get(agentId);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.activeProcs.delete(agentId);
    cleanupTempFiles(entry.tempFiles);
    this.engine.setAgentRoundDeadline(agentId, null);
    if (entry.logStream && !entry.logStream.writableEnded) {
      entry.logStream.end(
        `\n=== Closed (stopped: ${reason}) | ${new Date().toISOString()} ===\n`
      );
    }
    killProcessTree(entry.child);

    const state = this.runStates.get(agentId);
    if (state) {
      state.running = false;
      state.lastStatus = 'stopped';
      state.lastMessage = reason;
    }
  }

  public stopAllActiveRuns(
    reason = 'Stopped by player',
    notify = true,
    roomCode?: string
  ): AgyRunnerStatus {
    const scopedRoom = roomCode ? this.resolveRoomCode(roomCode) : null;
    const entries = Array.from(this.activeProcs.entries()).filter(
      ([, entry]) => !scopedRoom || entry.roomCode === scopedRoom
    );
    const touchedRooms = new Set<string>();
    for (const [id, entry] of entries) {
      touchedRooms.add(entry.roomCode);
      this.stopSingleRun(id, reason);
      const info = this.engine.getAgentInfo(id);
      if (
        this.getRoomRoundState(entry.roomCode).active &&
        info &&
        !info.hasGuessed
      ) {
        this.engine.setManagedAgentRoundAvailability(id, false, 'idle');
      }
    }
    if (notify) {
      if (touchedRooms.size === 0) {
        this.engine.notifyStateChanged(scopedRoom ?? this.activeRoomCode);
      } else {
        for (const r of touchedRooms) {
          this.engine.notifyStateChanged(r);
        }
      }
    }
    return this.getStatus(scopedRoom ?? undefined);
  }

  public shutdown(): void {
    for (const entry of this.activeProcs.values()) {
      clearTimeout(entry.timer);
      cleanupTempFiles(entry.tempFiles);
      if (entry.logStream && !entry.logStream.writableEnded) {
        entry.logStream.end(
          `\n=== Closed (server shutdown) | ${new Date().toISOString()} ===\n`
        );
      }
      killProcessTree(entry.child);
    }
    this.activeProcs.clear();
  }
}
