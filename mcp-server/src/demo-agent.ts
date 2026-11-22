import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const backendUrl = process.env.GAME_BACKEND_URL || 'http://localhost:3001';
  const agentName = process.env.AGENT_NAME || 'Demo Bot (MCP)';
  const serverEntry = path.resolve(__dirname, 'index.js');

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      serverEntry,
      '--transport',
      'stdio',
      '--backend-url',
      backendUrl,
      '--agent-name',
      agentName,
      '--model',
      'demo-heuristic-v1',
    ],
  });

  const client = new Client(
    { name: 'geoguessr-demo-client', version: '1.0.0' },
    { capabilities: {} }
  );

  await client.connect(transport);
  console.error(`[Demo Agent] Connected as '${agentName}'`);

  // Read game://rules resource
  await client.readResource({ uri: 'game://rules' });

  const stateRes = await client.callTool({
    name: 'get_game_state',
    arguments: {},
  });
  const stateText = (stateRes.content as Array<{ type: string; text?: string }>)
    .find((c) => c.type === 'text')
    ?.text;
  const state = JSON.parse(stateText || '{}') as {
    roundNumber: number;
    roundStatus: string;
    hasGuessed: boolean;
    availableMoves: Array<{ nodeId: string; relativeDirection: string }>;
  };

  console.error(
    `[Demo Agent] Round ${state.roundNumber} (${state.roundStatus}), exits=${state.availableMoves?.length || 0}`
  );

  if (state.roundStatus === 'active' && !state.hasGuessed) {
    await client.callTool({
      name: 'look_around',
      arguments: { include_compass_overlay: true },
    });
    await sleep(900);

    for (const heading of [90, 180, 270]) {
      await client.callTool({
        name: 'pan_and_zoom',
        arguments: { heading, pitch: 2, zoom: 1.5 },
      });
      await sleep(700);
    }

    if (state.availableMoves?.length > 0) {
      await client.callTool({
        name: 'move',
        arguments: { node_id: state.availableMoves[0].nodeId },
      });
      await sleep(900);
      await client.callTool({
        name: 'return_to_start',
        arguments: {},
      });
      await sleep(600);
    }

    await client.callTool({
      name: 'submit_guess',
      arguments: {
        latitude: 48.8566,
        longitude: 2.3522,
        reasoning:
          'Demo autonomous agent scanned 4 cardinal bearings, inspected signage & driving lanes, stepped down the road, and locked in a reference guess.',
      },
    });
    console.error('[Demo Agent] Guess submitted! Check the browser UI.');
  }

  await client.readResource({ uri: 'game://leaderboard' });
  await client.close();
}

main().catch((err) => {
  console.error('[Demo Agent] Error:', err);
  process.exit(1);
});
