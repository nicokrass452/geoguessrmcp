import { WebSocket, WebSocketServer } from 'ws';
import type { IncomingMessage } from 'node:http';
import type {
  LeaderboardEntry,
  PublicGameState,
  RoundSummary,
  WsServerMessage,
} from '@geoguessr-mcp/shared';

export interface ConnectedUiMeta {
  roomCode: string;
  playerId: string;
  playerName?: string;
}

interface ConnectedClient {
  socket: WebSocket;
  role: 'ui' | 'agent';
  roomCode: string;
  playerId: string;
  playerName?: string;
  agentId?: string;
}

export class WsHub {
  private readonly clients = new Set<ConnectedClient>();
  private onAgentConnectCallback?: (agentId: string, roomCode?: string) => void;
  private onAgentDisconnectCallback?: (agentId: string) => void;

  public setOnAgentConnect(
    cb: (agentId: string, roomCode?: string) => void
  ): void {
    this.onAgentConnectCallback = cb;
  }

  public setOnAgentDisconnect(cb: (agentId: string) => void): void {
    this.onAgentDisconnectCallback = cb;
  }

  public attach(
    wss: WebSocketServer,
    onUiHello?: (ws: WebSocket, meta: ConnectedUiMeta) => void
  ): void {
    wss.on('connection', (socket: WebSocket, req: IncomingMessage) => {
      const url = new URL(req.url || '/ws', 'http://localhost');
      const role = url.searchParams.get('role') === 'agent' ? 'agent' : 'ui';
      const rawRoom = (url.searchParams.get('roomCode') || '').trim().toUpperCase();
      const roomCode = rawRoom || 'DEFAULT';
      const playerId = (url.searchParams.get('playerId') || '').trim() || 'human';
      const playerName = (url.searchParams.get('playerName') || '').trim() || undefined;
      const agentId = (url.searchParams.get('agentId') || '').trim() || undefined;

      const client: ConnectedClient = {
        socket,
        role,
        roomCode,
        playerId,
        playerName,
        agentId,
      };
      this.clients.add(client);

      if (role === 'ui' && onUiHello) {
        onUiHello(socket, { roomCode, playerId, playerName });
      } else if (role === 'agent' && agentId && this.onAgentConnectCallback) {
        this.onAgentConnectCallback(
          agentId,
          roomCode !== 'DEFAULT' ? roomCode : undefined
        );
      }

      socket.on('close', () => {
        this.clients.delete(client);
        if (role === 'agent' && agentId) {
          const stillHasSocket = Array.from(this.clients).some(
            (c) =>
              c.role === 'agent' &&
              c.agentId === agentId &&
              c.socket.readyState === WebSocket.OPEN
          );
          if (!stillHasSocket && this.onAgentDisconnectCallback) {
            this.onAgentDisconnectCallback(agentId);
          }
        }
      });

      socket.on('error', () => {
        this.clients.delete(client);
      });
    });
  }

  public getActiveAgentSocketCount(): number {
    const activeIds = new Set<string>();
    let unnamedCount = 0;
    for (const c of this.clients) {
      if (c.role === 'agent' && c.socket.readyState === WebSocket.OPEN) {
        if (c.agentId) {
          activeIds.add(c.agentId);
        } else {
          unnamedCount += 1;
        }
      }
    }
    return activeIds.size + unnamedCount;
  }

  public sendTo(socket: WebSocket, message: WsServerMessage): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }

  public broadcast(message: WsServerMessage): void {
    const serialized = JSON.stringify(message);
    for (const client of this.clients) {
      if (client.socket.readyState === WebSocket.OPEN) {
        client.socket.send(serialized);
      }
    }
  }

  private clientMatchesRoom(
    client: ConnectedClient,
    roomCode: string,
    isActiveRoom: boolean
  ): boolean {
    if (client.roomCode === roomCode) return true;
    if (client.roomCode === 'DEFAULT' && isActiveRoom) return true;
    return false;
  }

  public broadcastToRoom(
    roomCode: string,
    isActiveRoom: boolean,
    message: WsServerMessage
  ): void {
    const serialized = JSON.stringify(message);
    for (const client of this.clients) {
      if (
        client.socket.readyState === WebSocket.OPEN &&
        this.clientMatchesRoom(client, roomCode, isActiveRoom)
      ) {
        client.socket.send(serialized);
      }
    }
  }

  public broadcastRoomStateSync(
    roomCode: string,
    isActiveRoom: boolean,
    buildStateForPlayer: (playerId: string) => PublicGameState
  ): void {
    for (const client of this.clients) {
      if (
        client.role === 'ui' &&
        client.socket.readyState === WebSocket.OPEN &&
        this.clientMatchesRoom(client, roomCode, isActiveRoom)
      ) {
        const state = buildStateForPlayer(client.playerId);
        client.socket.send(JSON.stringify({ type: 'state_sync', state }));
      }
    }
  }

  public broadcastRoomRoundEnded(
    roomCode: string,
    isActiveRoom: boolean,
    summary: RoundSummary,
    buildStateForPlayer: (playerId: string) => PublicGameState
  ): void {
    for (const client of this.clients) {
      if (
        client.socket.readyState === WebSocket.OPEN &&
        this.clientMatchesRoom(client, roomCode, isActiveRoom)
      ) {
        const state = buildStateForPlayer(client.playerId);
        client.socket.send(
          JSON.stringify({ type: 'round_ended', summary, state })
        );
      }
    }
  }

  public broadcastRoomMatchEnded(
    roomCode: string,
    isActiveRoom: boolean,
    leaderboard: LeaderboardEntry[],
    buildStateForPlayer: (playerId: string) => PublicGameState
  ): void {
    for (const client of this.clients) {
      if (
        client.socket.readyState === WebSocket.OPEN &&
        this.clientMatchesRoom(client, roomCode, isActiveRoom)
      ) {
        const state = buildStateForPlayer(client.playerId);
        client.socket.send(
          JSON.stringify({ type: 'match_ended', leaderboard, state })
        );
      }
    }
  }
}
