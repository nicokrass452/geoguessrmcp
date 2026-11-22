import { randomUUID } from 'node:crypto';
import cors from 'cors';
import express, { type Request, type Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { GameBackendClient, sendMcpHeartbeat } from './backendClient.js';
import { createGeoGuessrMcpServer } from './mcpFactory.js';

interface SseSession {
  server: McpServer;
  transport: SSEServerTransport;
  client: GameBackendClient;
  cleaned: boolean;
}

interface StreamableSession {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  client: GameBackendClient;
  lastSeen: number;
  cleaned: boolean;
}

export interface HttpMcpServerOptions {
  port: number;
  backendUrl: string;
  defaultAgentName: string;
  defaultModel: string;
}

// Keep SseServerOptions exported for backwards compatibility
export type SseServerOptions = HttpMcpServerOptions;

const SESSION_IDLE_MS = 30 * 60 * 1000;

export async function startHttpMcpServer(opts: HttpMcpServerOptions) {
  const app = express();
  app.use(
    cors({
      origin: '*',
      methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Accept',
        'Mcp-Session-Id',
        'Last-Event-ID',
        'Authorization',
      ],
      exposedHeaders: ['Mcp-Session-Id'],
    })
  );
  // IMPORTANT: Never mount express.json() globally because SSEServerTransport.handlePostMessage reads the raw stream.

  const sseSessions = new Map<string, SseSession>();
  const streamableSessions = new Map<string, StreamableSession>();
  const bridgeAbort = new AbortController();
  let shuttingDown = false;

  const sendBridgeHeartbeats = async () => {
    if (shuttingDown || bridgeAbort.signal.aborted) return;

    const streamableList = Array.from(streamableSessions.values());
    const sseList = Array.from(sseSessions.values());

    const streamableAgents = streamableList
      .map((s) => s.client.getEffectiveAgentId())
      .filter((id): id is string => Boolean(id));
    const sseAgents = sseList
      .map((s) => s.client.getEffectiveAgentId())
      .filter((id): id is string => Boolean(id));

    const requests: Promise<void>[] = [
      sendMcpHeartbeat(
        opts.backendUrl,
        {
          transport: 'streamable-http',
          activeSessions: streamableSessions.size,
          agentId:
            streamableAgents.length === 1 ? streamableAgents[0] : undefined,
        },
        2000,
        bridgeAbort.signal
      ),
      sendMcpHeartbeat(
        opts.backendUrl,
        {
          transport: 'sse',
          activeSessions: sseSessions.size,
          agentId: sseAgents.length === 1 ? sseAgents[0] : undefined,
        },
        2000,
        bridgeAbort.signal
      ),
    ];

    if (streamableAgents.length > 1) {
      for (const s of streamableList) {
        const effId = s.client.getEffectiveAgentId();
        if (!s.client.getAgentId() && effId) {
          requests.push(
            sendMcpHeartbeat(
              opts.backendUrl,
              {
                transport: 'streamable-http',
                activeSessions: streamableSessions.size,
                agentId: effId,
              },
              2000,
              bridgeAbort.signal
            )
          );
        }
      }
    }

    if (sseAgents.length > 1) {
      for (const s of sseList) {
        const effId = s.client.getEffectiveAgentId();
        if (!s.client.getAgentId() && effId) {
          requests.push(
            sendMcpHeartbeat(
              opts.backendUrl,
              {
                transport: 'sse',
                activeSessions: sseSessions.size,
                agentId: effId,
              },
              2000,
              bridgeAbort.signal
            )
          );
        }
      }
    }

    await Promise.all(requests);
  };

  const cleanupStreamable = async (sessionId: string | undefined) => {
    if (!sessionId) return;
    const session = streamableSessions.get(sessionId);
    if (!session || session.cleaned) return;
    session.cleaned = true;
    streamableSessions.delete(sessionId);
    await session.client.disconnect().catch(() => {});
    await session.server.close().catch(() => {});
    if (!shuttingDown) {
      void sendBridgeHeartbeats();
    }
  };

  const cleanupSse = async (sessionId: string) => {
    const session = sseSessions.get(sessionId);
    if (!session || session.cleaned) return;
    session.cleaned = true;
    sseSessions.delete(sessionId);
    await session.client.disconnect().catch(() => {});
    await session.server.close().catch(() => {});
    if (!shuttingDown) {
      void sendBridgeHeartbeats();
    }
  };

  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      transports: ['streamable-http', 'sse'],
      endpoints: {
        streamableHttp: '/mcp',
        sse: '/sse',
        messages: '/messages',
      },
      activeStreamableSessions: streamableSessions.size,
      activeSseSessions: sseSessions.size,
      backendUrl: opts.backendUrl,
    });
  });

  // ==================== Modern Streamable HTTP (/mcp) ====================
  // Supports ChatGPT Developer Mode, remote Antigravity, and MCP 2025-03-26+ clients.

  app.post(
    '/mcp',
    express.json({ limit: '4mb' }),
    async (req: Request, res: Response) => {
      const sessionId = req.header('mcp-session-id');

      if (sessionId) {
        const existing = streamableSessions.get(sessionId);
        if (!existing) {
          res.status(404).json({
            jsonrpc: '2.0',
            error: {
              code: -32001,
              message: 'Session not found. Please re-initialize.',
            },
            id: null,
          });
          return;
        }
        existing.lastSeen = Date.now();
        try {
          await existing.transport.handleRequest(req, res, req.body);
        } catch (err) {
          console.error('[GeoGuessr-MCP HTTP] POST /mcp error:', err);
          if (!res.headersSent) {
            res.status(500).json({
              jsonrpc: '2.0',
              error: { code: -32603, message: 'Internal server error' },
              id: null,
            });
          }
        }
        return;
      }

      if (!isInitializeRequest(req.body)) {
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Bad Request: No valid session ID provided',
          },
          id: null,
        });
        return;
      }

      const bodyParams = (req.body as { params?: { clientInfo?: { name?: string } } })
        ?.params;
      const agentName =
        String(req.query.agentName || '').trim() ||
        String(bodyParams?.clientInfo?.name || '').trim() ||
        `${opts.defaultAgentName} (HTTP #${streamableSessions.size + 1})`;
      const model = String(req.query.model || '').trim() || opts.defaultModel;

      const client = new GameBackendClient({
        backendUrl: opts.backendUrl,
        agentName,
        model,
        transport: 'streamable-http',
      });

      try {
        await client.connect();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[GeoGuessr-MCP HTTP] Failed to register agent:', msg);
        res.status(502).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: msg },
          id: null,
        });
        return;
      }

      const server = createGeoGuessrMcpServer(client);
      let initializedSessionId: string | undefined;

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          initializedSessionId = sid;
          streamableSessions.set(sid, {
            server,
            transport,
            client,
            lastSeen: Date.now(),
            cleaned: false,
          });
          console.error(
            `[GeoGuessr-MCP HTTP] Session ${sid} initialized for '${agentName}'`
          );
          void sendBridgeHeartbeats();
        },
        onsessionclosed: (sid) => {
          void cleanupStreamable(sid);
        },
      });

      transport.onclose = () => {
        const sid = transport.sessionId ?? initializedSessionId;
        void cleanupStreamable(sid);
      };

      try {
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
      } catch (err) {
        console.error('[GeoGuessr-MCP HTTP] Initialize error:', err);
        if (initializedSessionId) {
          await cleanupStreamable(initializedSessionId);
        } else {
          await client.disconnect().catch(() => {});
          await server.close().catch(() => {});
        }
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: '2.0',
            error: { code: -32603, message: 'Failed to initialize MCP session' },
            id: null,
          });
        }
      }
    }
  );

  app.get('/mcp', async (req: Request, res: Response) => {
    const sessionId = req.header('mcp-session-id');
    if (!sessionId) {
      res.status(400).json({ error: 'Missing Mcp-Session-Id header' });
      return;
    }
    const session = streamableSessions.get(sessionId);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    session.lastSeen = Date.now();
    try {
      await session.transport.handleRequest(req, res);
    } catch (err) {
      console.error('[GeoGuessr-MCP HTTP] GET /mcp error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to open MCP stream' });
      }
    }
  });

  app.delete('/mcp', async (req: Request, res: Response) => {
    const sessionId = req.header('mcp-session-id');
    if (!sessionId) {
      res.status(400).json({ error: 'Missing Mcp-Session-Id header' });
      return;
    }
    const session = streamableSessions.get(sessionId);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    try {
      await session.transport.handleRequest(req, res);
    } finally {
      await cleanupStreamable(sessionId);
    }
  });

  // ==================== Legacy HTTP+SSE (/sse + /messages) ====================

  app.get('/sse', async (req: Request, res: Response) => {
    const agentName =
      String(req.query.agentName || '').trim() ||
      `${opts.defaultAgentName} (SSE #${sseSessions.size + 1})`;
    const model = String(req.query.model || '').trim() || opts.defaultModel;

    const client = new GameBackendClient({
      backendUrl: opts.backendUrl,
      agentName,
      model,
      transport: 'sse',
    });

    try {
      await client.connect();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[GeoGuessr-MCP SSE] Failed to register agent:', msg);
      res.status(502).json({ error: msg });
      return;
    }

    const transport = new SSEServerTransport('/messages', res);
    const server = createGeoGuessrMcpServer(client);
    const sessionId = transport.sessionId;
    sseSessions.set(sessionId, { server, transport, client, cleaned: false });
    void sendBridgeHeartbeats();

    res.on('close', () => {
      void cleanupSse(sessionId);
    });

    try {
      await server.connect(transport);
      console.error(
        `[GeoGuessr-MCP SSE] Session ${sessionId} started for '${agentName}'`
      );
    } catch (err) {
      console.error('[GeoGuessr-MCP SSE] Session connect error:', err);
      await cleanupSse(sessionId);
    }
  });

  app.post('/messages', async (req: Request, res: Response) => {
    const sessionId = String(req.query.sessionId || '');
    const session = sseSessions.get(sessionId);
    if (!session) {
      res.status(404).json({ error: 'Unknown or expired MCP SSE sessionId' });
      return;
    }
    try {
      await session.transport.handlePostMessage(req, res);
    } catch (err) {
      console.error('[GeoGuessr-MCP SSE] handlePostMessage error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to handle MCP message' });
      }
    }
  });

  // Clean up stale idle Streamable HTTP sessions every 60s
  const reaper = setInterval(() => {
    const cutoff = Date.now() - SESSION_IDLE_MS;
    for (const [sid, s] of streamableSessions.entries()) {
      if (s.lastSeen < cutoff) {
        void cleanupStreamable(sid);
      }
    }
  }, 60_000);
  reaper.unref();

  const heartbeatTimer = setInterval(() => {
    void sendBridgeHeartbeats();
  }, 12_000);
  heartbeatTimer.unref();

  const httpServer = app.listen(opts.port, () => {
    void sendBridgeHeartbeats();
    console.error(
      `[GeoGuessr-MCP HTTP] Streamable HTTP ready at http://localhost:${opts.port}/mcp`
    );
    console.error(
      `[GeoGuessr-MCP HTTP] Legacy SSE ready at        http://localhost:${opts.port}/sse`
    );
    console.error(
      `[GeoGuessr-MCP HTTP] Forwarding to backend:   ${opts.backendUrl}`
    );
  });

  const stopTimers = () => {
    clearInterval(reaper);
    clearInterval(heartbeatTimer);
  };
  httpServer.on('close', stopTimers);

  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.exitCode = 0;
    stopTimers();
    bridgeAbort.abort();
    for (const sid of Array.from(streamableSessions.keys())) {
      await cleanupStreamable(sid);
    }
    for (const sid of Array.from(sseSessions.keys())) {
      await cleanupSse(sid);
    }
    const forceCloseTimer = setTimeout(() => {
      httpServer.closeAllConnections?.();
    }, 250);
    forceCloseTimer.unref?.();
    await new Promise<void>((resolve) => {
      httpServer.close(() => {
        clearTimeout(forceCloseTimer);
        resolve();
      });
      httpServer.closeIdleConnections?.();
    });
    const forceExitTimer = setTimeout(() => process.exit(0), 500);
    forceExitTimer.unref?.();
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  return { app, httpServer };
}

export const startSseServer = startHttpMcpServer;
