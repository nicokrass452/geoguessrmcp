#!/usr/bin/env node
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { GameBackendClient } from './backendClient.js';
import { createGeoGuessrMcpServer } from './mcpFactory.js';
import { startHttpMcpServer } from './sseServer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

for (const candidate of [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '..', '.env'),
  path.resolve(__dirname, '..', '..', '.env'),
]) {
  if (fs.existsSync(candidate)) {
    dotenv.config({ path: candidate, override: false });
    break;
  }
}

interface CliArgs {
  transport: 'stdio' | 'sse' | 'http';
  port: number;
  backendUrl: string;
  agentId?: string;
  agentName: string;
  model: string;
}

function parseTransportEnv(raw: string | undefined): 'stdio' | 'sse' | 'http' {
  const val = (raw || '').toLowerCase();
  if (val === 'http' || val === 'streamable-http') return 'http';
  if (val === 'sse') return 'sse';
  return 'stdio';
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    transport: parseTransportEnv(process.env.MCP_TRANSPORT),
    port: Number(process.env.MCP_PORT || process.env.MCP_SSE_PORT || 3002),
    backendUrl: process.env.GAME_BACKEND_URL || 'http://localhost:3001',
    agentId: process.env.GEOGUESSR_AGENT_ID?.trim() || undefined,
    agentName:
      process.env.GEOGUESSR_AGENT_NAME ||
      process.env.AGENT_NAME ||
      'AI Explorer',
    model:
      process.env.GEOGUESSR_AGENT_MODEL ||
      process.env.AGENT_MODEL ||
      'external-mcp',
  };

  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    const next = argv[i + 1];
    if (
      key === '--transport' &&
      (next === 'stdio' ||
        next === 'sse' ||
        next === 'http' ||
        next === 'streamable-http')
    ) {
      args.transport = next === 'streamable-http' ? 'http' : next;
      i++;
    } else if (key === '--port' && next) {
      args.port = Number(next);
      i++;
    } else if (key === '--backend-url' && next) {
      args.backendUrl = next;
      i++;
    } else if (key === '--agent-id' && next && !process.env.GEOGUESSR_AGENT_ID) {
      args.agentId = next;
      i++;
    } else if (
      key === '--agent-name' &&
      next &&
      !process.env.GEOGUESSR_AGENT_NAME
    ) {
      args.agentName = next;
      i++;
    } else if (
      key === '--model' &&
      next &&
      !process.env.GEOGUESSR_AGENT_MODEL
    ) {
      args.model = next;
      i++;
    }
  }

  return args;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.transport === 'sse' || opts.transport === 'http') {
    await startHttpMcpServer({
      port: opts.port,
      backendUrl: opts.backendUrl,
      defaultAgentName: opts.agentName,
      defaultModel: opts.model,
    });
    return;
  }

  const client = new GameBackendClient({
    backendUrl: opts.backendUrl,
    agentId: opts.agentId,
    agentName: opts.agentName,
    model: opts.model,
    transport: 'stdio',
  });

  // Register on game backend before or upon connection
  try {
    await client.connect();
  } catch (err) {
    console.error(
      `[GeoGuessr-MCP Stdio] Warning: game backend not yet reachable at ${opts.backendUrl} (${
        err instanceof Error ? err.message : String(err)
      }). Will connect lazily on first tool call.`
    );
  }

  const server = createGeoGuessrMcpServer(client);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  client.startHeartbeat(12_000, 1);
  console.error(
    `[GeoGuessr-MCP Stdio] Ready for '${opts.agentName}' -> ${opts.backendUrl}`
  );

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.exitCode = 0;
    const forceExit = setTimeout(() => process.exit(0), 1500);
    forceExit.unref?.();
    client.stopHeartbeat();
    await client.disconnect().catch(() => {});
    await server.close().catch(() => {});
    process.stdin.pause?.();
    process.stdin.unref?.();
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
  process.stdin.on('end', () => void shutdown());
  process.stdin.on('close', () => void shutdown());
  server.server.onclose = () => void shutdown();
}

main().catch((err) => {
  console.error('[GeoGuessr-MCP] Fatal startup error:', err);
  process.exit(1);
});
