import { execFile, execFileSync, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  AgyBotRunState,
  AgyModelOption,
  AgyRunnerStatus,
} from '@geoguessr-mcp/shared';
import type { ServerConfig } from './config.js';
import type { GameEngine } from './gameEngine.js';

export const AVAILABLE_AGY_MODELS: AgyModelOption[] = [
  { id: 'gemini-3.8-flash-medium', label: 'Gemini 3.8 Flash', family: 'gemini' },
  { id: 'gemini-4-hydrogen-medium', label: 'Gemini 4 Hydrogen', family: 'gemini' },
  { id: 'gemini-4-neon-high', label: 'Gemini 4 Neon', family: 'gemini' },
  { id: 'gemini-4-argon-high', label: 'Gemini 4 Argon', family: 'gemini' },
  { id: 'claude-sonnet-5-5-medium', label: 'Claude Sonnet 5.5', family: 'claude' },
  { id: 'claude-opus-5-5-high', label: 'Claude Opus 5.5', family: 'claude' },
  { id: 'gpt-oss-120b-medium', label: 'GPT-OSS 120B', family: 'gpt' },
];

interface ActiveProcessEntry {
  child: ChildProcess;
  timer: NodeJS.Timeout;
  logStream?: fs.WriteStream;
  agentId: string;
  modelId: string;
  roundNumber: number;
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

export function modelIdToAgentId(modelId: string): string {
  return `agy_${modelId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

export class AgyRunner {
  private readonly config: ServerConfig;
  private readonly engine: GameEngine;
  private readonly agyPath: string | null;
  private readonly sandboxDir: string;
  private readonly logsDir: string;

  private autoPlayEnabled = false;
  private selectedModels: string[] = [
    'gemini-3.8-flash-medium',
    'claude-sonnet-5-5-medium',
  ];
  private maxStepsPerRound = 5;
  private timeoutSec = 120;

  private readonly activeProcs = new Map<string, ActiveProcessEntry>();
  private readonly runStates = new Map<string, AgyBotRunState>();
  private currentRoundNumber = 1;
  private roundActive = true;

  constructor(config: ServerConfig, engine: GameEngine) {
    this.config = config;
    this.engine = engine;
    this.agyPath = findAgyBinary();
    this.sandboxDir = path.join(config.cacheDir, 'agy-sandbox');
    this.logsDir = path.join(config.cacheDir, 'agy-logs');
    fs.mkdirSync(this.sandboxDir, { recursive: true });
    fs.mkdirSync(this.logsDir, { recursive: true });
  }

  public getStatus(): AgyRunnerStatus {
    const runs = Array.from(this.runStates.values()).map((r) => {
      const info = this.engine.getAgentInfo(r.agentId);
      return {
        ...r,
        explorationCalls: info?.explorationCalls ?? r.explorationCalls,
        maxStepsPerRound: this.maxStepsPerRound,
      };
    });

    return {
      available: Boolean(this.agyPath),
      agyPath: this.agyPath,
      autoPlayEnabled: this.autoPlayEnabled,
      selectedModels: [...this.selectedModels],
      maxStepsPerRound: this.maxStepsPerRound,
      timeoutSec: this.timeoutSec,
      availableModels: AVAILABLE_AGY_MODELS,
      runs,
    };
  }

  public onMatchReset(): void {
    this.stopAllActiveRuns('Match restarted', false);
  }

  public onRoundStarted(roundNumber: number): void {
    this.stopAllActiveRuns('Round transitioned', false);
    this.currentRoundNumber = roundNumber;
    this.roundActive = true;

    for (const modelId of this.selectedModels) {
      const agentId = modelIdToAgentId(modelId);
      const state = this.runStates.get(agentId);
      if (state) {
        state.running = false;
        state.lastStatus = 'idle';
        state.lastMessage = undefined;
        state.roundNumber = roundNumber;
        state.explorationCalls = 0;
        state.maxStepsPerRound = this.maxStepsPerRound;
      }
    }

    if (this.autoPlayEnabled) {
      this.triggerCurrentRound();
    }
  }

  public onRoundEnded(_roundNumber: number): void {
    this.roundActive = false;
    this.stopAllActiveRuns('Round ended', false);
  }

  public updateConfig(opts: {
    autoPlayEnabled?: boolean;
    selectedModels?: string[];
    maxStepsPerRound?: number;
    timeoutSec?: number;
  }): AgyRunnerStatus {
    const prevAuto = this.autoPlayEnabled;
    if (typeof opts.autoPlayEnabled === 'boolean') {
      this.autoPlayEnabled = opts.autoPlayEnabled;
    }
    if (typeof opts.maxStepsPerRound === 'number') {
      this.maxStepsPerRound = Math.max(
        2,
        Math.min(20, Math.round(opts.maxStepsPerRound))
      );
    }
    if (typeof opts.timeoutSec === 'number') {
      this.timeoutSec = Math.max(30, Math.min(300, Math.round(opts.timeoutSec)));
    }

    if (Array.isArray(opts.selectedModels)) {
      const validSet = new Set(AVAILABLE_AGY_MODELS.map((m) => m.id));
      const nextModels = Array.from(
        new Set(opts.selectedModels.filter((m) => validSet.has(m)))
      );
      const removed = this.selectedModels.filter((m) => !nextModels.includes(m));
      for (const oldModelId of removed) {
        const agentId = modelIdToAgentId(oldModelId);
        this.stopSingleRun(agentId, 'Deselected by player');
        this.runStates.delete(agentId);
        this.engine.removeManagedAgent(agentId);
      }
      this.selectedModels = nextModels;
    }

    // Ensure selected models are visible/updated in GameEngine when auto-play is enabled
    if (this.autoPlayEnabled) {
      for (const modelId of this.selectedModels) {
        const opt = AVAILABLE_AGY_MODELS.find((m) => m.id === modelId);
        if (!opt) continue;
        this.engine.registerManagedAgent({
          agentId: modelIdToAgentId(opt.id),
          name: opt.label,
          model: opt.id,
          maxExplorationCalls: this.maxStepsPerRound,
        });
      }
      if (this.roundActive && (!prevAuto || opts.selectedModels)) {
        this.triggerCurrentRound();
      }
    }

    this.engine.notifyStateChanged();
    return this.getStatus();
  }

  public triggerCurrentRound(overrideModels?: string[]): AgyRunnerStatus {
    if (!this.agyPath) {
      throw new Error(
        'agy.exe CLI binary was not found on this machine. Install Antigravity CLI or set AGY_BIN.'
      );
    }
    if (!this.roundActive) {
      throw new Error('Cannot summon AI opponents while the round is over.');
    }

    const targets = (overrideModels ?? this.selectedModels)
      .map((id) => AVAILABLE_AGY_MODELS.find((m) => m.id === id))
      .filter((m): m is AgyModelOption => Boolean(m));

    for (const model of targets) {
      const agentId = modelIdToAgentId(model.id);
      if (this.activeProcs.has(agentId)) continue;

      const registered = this.engine.registerManagedAgent({
        agentId,
        name: model.label,
        model: model.id,
        maxExplorationCalls: this.maxStepsPerRound,
      });

      if (registered.hasGuessed) continue;

      this.spawnAgyBot(model, agentId, this.currentRoundNumber);
    }

    this.engine.notifyStateChanged();
    return this.getStatus();
  }

  private spawnAgyBot(
    model: AgyModelOption,
    agentId: string,
    roundNumber: number
  ): void {
    if (!this.agyPath) return;

    const deadlineMs = Date.now() + this.timeoutSec * 1000;
    this.engine.setAgentRoundDeadline(agentId, deadlineMs);

    const logFile = path.join(this.logsDir, `round-${roundNumber}-${agentId}.log`);
    let logStream: fs.WriteStream | undefined;
    try {
      logStream = fs.createWriteStream(logFile, { flags: 'a' });
      logStream.on('error', () => {});
      logStream.write(
        `\n=== Round ${roundNumber} | ${model.label} (${model.id}) | agentId=${agentId} | maxSteps=${this.maxStepsPerRound} | timeout=${this.timeoutSec}s | ${new Date().toISOString()} ===\n`
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
      maxStepsPerRound: this.maxStepsPerRound,
    };
    this.runStates.set(agentId, runState);
    this.engine.logAgentActivity(
      agentId,
      'agy_spawn',
      `Summoned fresh ${model.label} session (max ${this.maxStepsPerRound} steps, ${this.timeoutSec}s timeout)`
    );

    const maxFollowupCalls = Math.max(1, this.maxStepsPerRound - 1);
    const prompt = [
      `You are "${model.label}", competing autonomously in Round ${roundNumber} of GeoGuessr MCP Arena.`,
      `CRITICAL IDENTITY RULE: On EVERY call to the geoguessr-arena MCP server (get_game_state, look_around, pan_and_zoom, move, return_to_start, submit_guess), you MUST pass agent_id: "${agentId}".`,
      `FAIR PLAY RULE: Rely ONLY on the street-view images and compass metadata returned by geoguessr-arena MCP tools. Do NOT run shell commands, read local workspace files, or search outside tools.`,
      `STRICT BUDGET & PACING: You have a hard cap of ${this.maxStepsPerRound} exploration calls (look_around / pan_and_zoom / move combined) and a ${this.timeoutSec}s round timer (every response includes agentBudget.remainingExplorationCalls and agentBudget.runnerSecondsRemaining).`,
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
        `${this.timeoutSec + 10}s`,
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
        runState.lastMessage = `Timed out after ${this.timeoutSec}s`;
        this.engine.logAgentActivity(
          agentId,
          'timeout',
          `${model.label} timed out after ${this.timeoutSec}s`
        );
        this.engine.setManagedAgentRoundAvailability(agentId, false, 'idle');
      }
      if (logStream && !logStream.writableEnded) {
        logStream.end(
          `\n=== Closed (timeout after ${this.timeoutSec}s) | ${new Date().toISOString()} ===\n`
        );
      }
      this.engine.notifyStateChanged();
    }, (this.timeoutSec + 12) * 1000);

    this.activeProcs.set(agentId, {
      child,
      timer,
      logStream,
      agentId,
      modelId: model.id,
      roundNumber,
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
      this.engine.notifyStateChanged();
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
      } else if (!this.roundActive) {
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
      this.engine.notifyStateChanged();
    });
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
    notify = true
  ): AgyRunnerStatus {
    const ids = Array.from(this.activeProcs.keys());
    for (const id of ids) {
      this.stopSingleRun(id, reason);
      const info = this.engine.getAgentInfo(id);
      if (this.roundActive && info && !info.hasGuessed) {
        this.engine.setManagedAgentRoundAvailability(id, false, 'idle');
      }
    }
    if (notify) {
      this.engine.notifyStateChanged();
    }
    return this.getStatus();
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
