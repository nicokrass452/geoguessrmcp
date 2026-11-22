import { WebSocket } from 'ws';
import type {
  AgentFramePayload,
  AgentGameState,
  LeaderboardPayload,
  MoveDirection,
  PlayerInfo,
} from '@geoguessr-mcp/shared';

export interface McpHeartbeatPayload {
  transport: string;
  activeSessions?: number;
  agentId?: string;
}

export async function sendMcpHeartbeat(
  backendUrl: string,
  payload: McpHeartbeatPayload,
  timeoutMs = 2000,
  externalSignal?: AbortSignal
): Promise<void> {
  if (externalSignal?.aborted) return;
  const base = backendUrl.replace(/\/+$/, '');
  const controller = new AbortController();
  const onExternalAbort = () => controller.abort();
  externalSignal?.addEventListener('abort', onExternalAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const body: McpHeartbeatPayload = {
      transport: payload.transport,
    };
    if (typeof payload.activeSessions === 'number') {
      body.activeSessions = payload.activeSessions;
    }
    if (payload.agentId) {
      body.agentId = payload.agentId;
    }
    const res = await fetch(`${base}/api/mcp/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    await res.body?.cancel().catch(() => {});
  } catch {
    // Intentionally ignore network, abort, and HTTP errors so stdio streams and logs stay clean.
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  }
}

export interface BackendClientOptions {
  backendUrl: string;
  agentName: string;
  agentId?: string;
  model?: string;
  transport: string;
}

export class GameBackendClient {
  private readonly backendUrl: string;
  private readonly agentName: string;
  private readonly model: string;
  private readonly transport: string;
  private agentId?: string;
  private lastOverrideAgentId?: string;
  private usedDefaultAgent = false;
  private ws: WebSocket | null = null;
  private closing = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private readonly heartbeatControllers = new Set<AbortController>();

  constructor(opts: BackendClientOptions) {
    this.backendUrl = opts.backendUrl.replace(/\/+$/, '');
    this.agentName = opts.agentName;
    this.agentId = opts.agentId;
    this.model = opts.model || 'external-mcp';
    this.transport = opts.transport;
  }

  public getAgentId(): string | undefined {
    return this.agentId;
  }

  public getEffectiveAgentId(): string | undefined {
    return this.agentId ?? this.lastOverrideAgentId;
  }

  public async sendHeartbeat(activeSessions?: number): Promise<void> {
    if (this.closing) return;
    const controller = new AbortController();
    this.heartbeatControllers.add(controller);
    try {
      await sendMcpHeartbeat(
        this.backendUrl,
        {
          transport: this.transport,
          activeSessions,
          agentId: this.getEffectiveAgentId(),
        },
        2000,
        controller.signal
      );
    } finally {
      this.heartbeatControllers.delete(controller);
    }
  }

  public startHeartbeat(intervalMs = 12_000, activeSessions = 1): void {
    if (this.closing) return;
    this.stopHeartbeat();
    void this.sendHeartbeat(activeSessions);
    this.heartbeatTimer = setInterval(() => {
      if (!this.closing) {
        void this.sendHeartbeat(activeSessions);
      }
    }, intervalMs);
    this.heartbeatTimer.unref?.();
  }

  public stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    for (const controller of this.heartbeatControllers) {
      controller.abort();
    }
    this.heartbeatControllers.clear();
  }

  private async requestJson<T>(
    path: string,
    init?: RequestInit,
    timeoutMs?: number
  ): Promise<T> {
    let controller: AbortController | undefined;
    let timer: NodeJS.Timeout | undefined;
    let onExternalAbort: (() => void) | undefined;
    if (typeof timeoutMs === 'number' && timeoutMs > 0) {
      controller = new AbortController();
      if (init?.signal) {
        if (init.signal.aborted) {
          controller.abort();
        } else {
          onExternalAbort = () => controller!.abort();
          init.signal.addEventListener('abort', onExternalAbort, { once: true });
        }
      }
      timer = setTimeout(() => controller!.abort(), timeoutMs);
      timer.unref?.();
    }

    let res: Response;
    let text: string;
    try {
      res = await fetch(`${this.backendUrl}${path}`, {
        ...init,
        headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
        ...(controller ? { signal: controller.signal } : {}),
      });
      text = await res.text();
    } finally {
      if (timer) clearTimeout(timer);
      if (onExternalAbort && init?.signal) {
        init.signal.removeEventListener('abort', onExternalAbort);
      }
    }

    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Invalid JSON from backend (${res.status}): ${text}`);
    }
    if (!res.ok) {
      const msg =
        typeof data === 'object' && data && 'error' in data
          ? String((data as { error: unknown }).error)
          : `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return data as T;
  }

  public async connect(): Promise<PlayerInfo> {
    this.closing = false;
    const player = await this.requestJson<PlayerInfo>('/api/agents/register', {
      method: 'POST',
      body: JSON.stringify({
        agentId: this.agentId,
        name: this.agentName,
        model: this.model,
        transport: this.transport,
      }),
    });
    this.agentId = player.id;
    this.openWebSocket();
    return player;
  }

  private openWebSocket(): void {
    if (this.closing || !this.agentId) return;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;

    const wsBase = this.backendUrl.replace(/^http/i, 'ws');
    const url = `${wsBase}/ws?role=agent&agentId=${encodeURIComponent(
      this.agentId
    )}`;

    const ws = new WebSocket(url);
    this.ws = ws;

    ws.on('open', () => {
      console.error(
        `[GeoGuessr-MCP] Agent '${this.agentName}' (${this.agentId}) connected via WebSocket`
      );
    });

    ws.on('close', () => {
      const wasCurrent = this.ws === ws;
      if (wasCurrent) {
        this.ws = null;
      }
      if (!this.closing && this.agentId) {
        this.reconnectTimer = setTimeout(() => {
          this.openWebSocket();
        }, 2000);
        this.reconnectTimer.unref?.();
      }
    });

    ws.on('error', (err) => {
      if (!this.closing && this.ws === ws) {
        console.error('[GeoGuessr-MCP] Agent WS error:', err.message);
      }
    });
  }

  private closeWebSocket(): void {
    const ws = this.ws;
    if (!ws) return;
    this.ws = null;
    try {
      if (ws.readyState === WebSocket.OPEN) {
        const termTimer = setTimeout(() => {
          try {
            ws.terminate();
          } catch {
            // ignore
          }
        }, 100);
        termTimer.unref?.();
        ws.once('close', () => clearTimeout(termTimer));
        ws.close();
      } else {
        ws.terminate();
      }
    } catch {
      // ignore
    }
  }

  private async ensureConnected(): Promise<string> {
    if (!this.agentId) {
      await this.connect();
    }
    return this.agentId!;
  }

  public async disconnect(): Promise<void> {
    this.closing = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.closeWebSocket();
    const agentId = this.agentId;
    this.agentId = undefined;
    if (agentId) {
      await this.requestJson(
        `/api/agents/${encodeURIComponent(agentId)}`,
        {
          method: 'DELETE',
        },
        1000
      ).catch(() => {});
    }
  }

  private async cleanupUnusedDefaultAgent(overrideId: string): Promise<void> {
    if (!this.agentId || this.agentId === overrideId || this.usedDefaultAgent) {
      return;
    }
    const staleId = this.agentId;
    this.agentId = undefined;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.closeWebSocket();
    await this.requestJson(
      `/api/agents/${encodeURIComponent(staleId)}`,
      {
        method: 'DELETE',
      },
      1000
    ).catch(() => {});
  }

  private async withAutoReconnect<T>(
    fn: (id: string) => Promise<T>,
    overrideAgentId?: string
  ): Promise<T> {
    if (overrideAgentId) {
      this.lastOverrideAgentId = overrideAgentId;
      await this.cleanupUnusedDefaultAgent(overrideAgentId);
      return await fn(overrideAgentId);
    }

    this.usedDefaultAgent = true;
    const id = await this.ensureConnected();
    try {
      return await fn(id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Unknown agentId')) {
        await this.connect();
        return await fn(this.agentId!);
      }
      throw err;
    }
  }

  public async getState(overrideAgentId?: string): Promise<AgentGameState> {
    return this.withAutoReconnect(
      (id) =>
        this.requestJson<AgentGameState>(
          `/api/agents/${encodeURIComponent(id)}/state`
        ),
      overrideAgentId
    );
  }

  public async lookAround(
    includeCompassOverlay = false,
    overrideAgentId?: string
  ): Promise<AgentFramePayload> {
    return this.withAutoReconnect(
      (id) =>
        this.requestJson<AgentFramePayload>(
          `/api/agents/${encodeURIComponent(id)}/look`,
          {
            method: 'POST',
            body: JSON.stringify({ includeCompassOverlay }),
          }
        ),
      overrideAgentId
    );
  }

  public async panAndZoom(
    heading: number,
    pitch: number,
    zoom: number,
    overrideAgentId?: string
  ): Promise<AgentFramePayload> {
    return this.withAutoReconnect(
      (id) =>
        this.requestJson<AgentFramePayload>(
          `/api/agents/${encodeURIComponent(id)}/pan-zoom`,
          {
            method: 'POST',
            body: JSON.stringify({ heading, pitch, zoom }),
          }
        ),
      overrideAgentId
    );
  }

  public async move(opts: {
    direction?: MoveDirection;
    nodeId?: string;
    overrideAgentId?: string;
  }): Promise<AgentFramePayload> {
    return this.withAutoReconnect(
      (id) =>
        this.requestJson<AgentFramePayload>(
          `/api/agents/${encodeURIComponent(id)}/move`,
          {
            method: 'POST',
            body: JSON.stringify({
              direction: opts.direction,
              nodeId: opts.nodeId,
            }),
          }
        ),
      opts.overrideAgentId
    );
  }

  public async returnToStart(
    overrideAgentId?: string
  ): Promise<AgentFramePayload> {
    return this.withAutoReconnect(
      (id) =>
        this.requestJson<AgentFramePayload>(
          `/api/agents/${encodeURIComponent(id)}/return-to-start`,
          { method: 'POST' }
        ),
      overrideAgentId
    );
  }

  public async submitGuess(
    latitude: number,
    longitude: number,
    reasoning?: string,
    overrideAgentId?: string,
    wager?: number
  ): Promise<{ accepted: true; agentState: AgentGameState }> {
    const body: {
      latitude: number;
      longitude: number;
      reasoning?: string;
      wager?: number;
    } = { latitude, longitude };
    if (reasoning !== undefined) {
      body.reasoning = reasoning;
    }
    if (typeof wager === 'number' && Number.isFinite(wager)) {
      body.wager = wager;
    }

    return this.withAutoReconnect(
      (id) =>
        this.requestJson<{ accepted: true; agentState: AgentGameState }>(
          `/api/agents/${encodeURIComponent(id)}/guess`,
          {
            method: 'POST',
            body: JSON.stringify(body),
          }
        ),
      overrideAgentId
    );
  }

  public async getLeaderboard(): Promise<LeaderboardPayload> {
    return this.requestJson<LeaderboardPayload>('/api/leaderboard');
  }
}
