import { execFile, execFileSync, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  AgyBotRunState,
  AgyModelOption,
  AgyRunnerStatus,
  MatchStatus,
} from '@geoguessr-mcp/shared';
import type { ServerConfig } from './config.js';
import type { GameEngine } from './gameEngine.js';

export const AVAILABLE_AGY_MODELS: AgyModelOption[] = [
  { id: 'gemini-4-hydrogen-medium', label: 'Gemini 4 Hydrogen', family: 'gemini' },
  { id: 'claude-sonnet-5-5-medium', label: 'Claude Sonnet 5.5', family: 'claude' },
  { id: 'gemini-4-carbon-high', label: 'Gemini 4 Carbon', family: 'gemini' },
  { id: 'gemini-4-neon-high', label: 'Gemini 4 Neon', family: 'gemini' },
  { id: 'claude-opus-5-5-high', label: 'Claude Opus 5.5', family: 'claude' },
];

interface AgyRoomConfig {
  autoPlayEnabled: boolean;
  selectedModels: string[];
  maxStepsPerRound: number;
  timeoutSec: number;
}

interface ActiveProcessEntry {
  child: ChildProcess;
  timer: NodeJS.Timeout;
  logStream?: fs.WriteStream;
  agentId: string;
  modelId: string;
  roundNumber: number;
  roomCode: string;
}

function findAgyBinary(): string | null {
  const candidates = [
    process.env.AGY_BIN?.trim(),
    path.join(os.homedir(), 'AppData', 'Local', 'agy', 'bin', 'agy.exe'),
  ].filter(Boolean) as string[];

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }

  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    const out = execFileSync(cmd, ['agy'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2000,
    });
    const first = out.split(/\r?\n/).find((line) => line.trim().length > 0);
    if (first && fs.existsSync(first.trim())) return first.trim();
  } catch {
    // not found on PATH
  }
  return null;
}

function killProcessTree(child: ChildProcess): void {
  const pid = child.pid;
  if (process.platform === 'win32' && pid) {
    execFile('taskkill', ['/PID', String(pid), '/T', '/F'], () => {});
  }
  try {
    child.kill('SIGKILL');
  } catch {
    // ignore already exited
  }
}

export function modelIdToAgentId(modelId: string, roomCode?: string): string {
  const base = `agy_${modelId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  const cleanRoom = roomCode?.trim().toUpperCase();
  if (!cleanRoom || cleanRoom === 'ARENA1' || cleanRoom === 'DEFAULT') {
    return base;
  }
  return `${base}_${cleanRoom.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

export class AgyRunner {
  private readonly config: ServerConfig;
  private readonly engine: GameEngine;
  private readonly agyPath: string | null;
  private readonly sandboxDir: string;
  private readonly logsDir: string;

  private defaultSelectedModels: string[] = [
    'gemini-4-hydrogen-medium',
    'claude-sonnet-5-5-medium',
  ];
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
    this.agyPath = findAgyBinary();
    this.sandboxDir = path.join(config.cacheDir, 'agy-sandbox');
    this.logsDir = path.join(config.cacheDir, 'agy-logs');
    fs.mkdirSync(this.sandboxDir, { recursive: true });
    fs.mkdirSync(this.logsDir, { recursive: true });
  }

  private sanitizeModels(models?: string[]): string[] {
    if (!Array.isArray(models)) return [...this.defaultSelectedModels];
    const validSet = new Set(AVAILABLE_AGY_MODELS.map((m) => m.id));
    return Array.from(new Set(models.filter((m) => validSet.has(m))));
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
        maxStepsPerRound: this.defaultMaxStepsPerRound,
        timeoutSec: this.defaultTimeoutSec,
      };
      this.roomConfigs.set(code, cfg);
    }
    return cfg;
  }

  private isAgentInRoom(agentId: string, modelId: string, roomCode: string): boolean {
    return agentId === modelIdToAgentId(modelId, roomCode);
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
      available: Boolean(this.agyPath),
      agyPath: this.agyPath,
      autoPlayEnabled: cfg.autoPlayEnabled,
      selectedModels: [...cfg.selectedModels],
      maxStepsPerRound: cfg.maxStepsPerRound,
      timeoutSec: cfg.timeoutSec,
      availableModels: AVAILABLE_AGY_MODELS,
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
      maxStepsPerRound?: number;
      timeoutSec?: number;
    }
  ): void {
    const targetRoom = this.resolveRoomCode(roomCode);
    this.activeRoomCode = targetRoom;
    this.roomRoundState.set(targetRoom, { roundNumber: 1, active: false });

    const existingCfg = this.roomConfigs.get(targetRoom);
    const selectedModels = Array.isArray(opts.selectedModels)
      ? this.sanitizeModels(opts.selectedModels)
      : existingCfg
        ? [...existingCfg.selectedModels]
        : [...this.defaultSelectedModels];

    if (opts.allowAi && Array.isArray(opts.selectedModels) && selectedModels.length > 0) {
      this.defaultSelectedModels = [...selectedModels];
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
      maxStepsPerRound,
      timeoutSec,
    });

    if (
      opts.allowAi &&
      this.agyPath &&
      selectedModels.length > 0 &&
      (opts.matchStatus === 'lobby' || autoPlayEnabled)
    ) {
      for (const modelId of selectedModels) {
        const opt = AVAILABLE_AGY_MODELS.find((m) => m.id === modelId);
        if (!opt) continue;
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

    if (cfg.autoPlayEnabled && cfg.selectedModels.length > 0 && this.agyPath) {
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
    if (typeof opts.maxStepsPerRound === 'number') {
      cfg.maxStepsPerRound = this.clampSteps(opts.maxStepsPerRound);
      this.defaultMaxStepsPerRound = cfg.maxStepsPerRound;
    }
    if (typeof opts.timeoutSec === 'number') {
      cfg.timeoutSec = this.clampTimeout(opts.timeoutSec);
      this.defaultTimeoutSec = cfg.timeoutSec;
    }

    if (Array.isArray(opts.selectedModels)) {
      const nextModels = this.sanitizeModels(opts.selectedModels);
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
    if (this.agyPath && cfg.selectedModels.length > 0) {
      if (roomState.active && cfg.autoPlayEnabled) {
        for (const modelId of cfg.selectedModels) {
          const opt = AVAILABLE_AGY_MODELS.find((m) => m.id === modelId);
          if (!opt) continue;
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
          const opt = AVAILABLE_AGY_MODELS.find((m) => m.id === modelId);
          if (!opt) continue;
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
    if (!this.agyPath) {
      throw new Error(
        'agy.exe CLI binary was not found on this machine. Install Antigravity CLI or set AGY_BIN.'
      );
    }
    const targetRoom = this.resolveRoomCode(roomCode);
    const roomState = this.getRoomRoundState(targetRoom);
    if (!roomState.active) {
      throw new Error('Cannot summon AI opponents while the round is over.');
    }

    const cfg = this.getRoomConfig(targetRoom);
    if (Array.isArray(overrideModels)) {
      cfg.selectedModels = this.sanitizeModels(overrideModels);
    }
    // Keep AI opponents active for subsequent rounds once summoned in this match
    cfg.autoPlayEnabled = true;

    const targets = cfg.selectedModels
      .map((id) => AVAILABLE_AGY_MODELS.find((m) => m.id === id))
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
    if (!this.agyPath) return;

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
        `\n=== Round ${roundNumber} | ${model.label} (${model.id}) | agentId=${agentId} | maxSteps=${maxStepsPerRound} | timeout=${timeoutSec}s | ${new Date().toISOString()} ===\n`
      );
    } catch {
      logStream = undefined;
    }

    const runState: AgyBotRunState = {
      agentId,
      modelId: model.id,
      displayName: model.label,
      running: true,
      lastStatus: 'spawning',
      lastMessage: `Starting fresh ${model.label} chat for Round ${roundNumber}`,
      roundNumber,
      startedAt: new Date().toISOString(),
      explorationCalls: 0,
      maxStepsPerRound,
    };
    this.runStates.set(agentId, runState);
    this.engine.logAgentActivity(
      agentId,
      'agy_spawn',
      `Summoned fresh ${model.label} session (max ${maxStepsPerRound} steps, ${timeoutSec}s timeout)`
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

    const child = spawn(
      this.agyPath,
      [
        '-p',
        prompt,
        '--model',
        model.id,
        '--mode',
        'auto',
        '--dangerously-skip-permissions',
        '--disable-slash-commands',
        '--print-timeout',
        `${timeoutSec + 10}s`,
        '--output-format',
        'text',
      ],
      {
        cwd: this.sandboxDir,
        env: {
          ...process.env,
          GEOGUESSR_AGENT_ID: agentId,
          GEOGUESSR_AGENT_NAME: model.label,
          GEOGUESSR_AGENT_MODEL: model.id,
          GEOGUESSR_ROOM_CODE: roomCode,
          GAME_BACKEND_URL: `http://localhost:${this.config.port}`,
        },
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
      agentId,
      modelId: model.id,
      roundNumber,
      roomCode,
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      if (this.activeProcs.get(agentId)?.child === child) {
        this.activeProcs.delete(agentId);
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
        // Already stopped/timed out via stopSingleRun or timeout handler
        return;
      }
      this.activeProcs.delete(agentId);
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
