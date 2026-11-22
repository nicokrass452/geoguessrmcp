import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  GAME_RULES_MARKDOWN,
  type AgentFramePayload,
} from '@geoguessr-mcp/shared';
import type { GameBackendClient } from './backendClient.js';

function formatFrameResponse(frame: AgentFramePayload) {
  const metadata = {
    agentId: frame.agentId,
    roundNumber: frame.roundNumber,
    currentNodeId: frame.currentNodeId,
    isAtStart: frame.isAtStart,
    stepCount: frame.stepCount,
    camera: frame.camera,
    compassDirection: frame.compassDirection,
    availableMoves: frame.availableMoves,
    hasGuessed: frame.hasGuessed,
    agentBudget: frame.agentBudget,
  };

  return {
    content: [
      {
        type: 'image' as const,
        data: frame.imageBase64,
        mimeType: 'image/jpeg' as const,
      },
      {
        type: 'text' as const,
        text: JSON.stringify(metadata, null, 2),
      },
    ],
  };
}

export function createGeoGuessrMcpServer(client: GameBackendClient): McpServer {
  const server = new McpServer({
    name: 'geoguessr-mcp',
    version: '1.0.0',
  });

  const optionalAgentId = z
    .string()
    .min(1)
    .optional()
    .describe(
      'Optional agent ID when multiple autonomous AI models share the MCP bridge.'
    );

  // 1. get_game_state
  server.tool(
    'get_game_state',
    'Get current round number, round status (active | round_over), match mode, locationMode, betting status (bettingEnabled, chips, currentWager), time remaining, available movement directions (bearings/link IDs), current heading/pitch/FOV, and guess status. Never returns target coordinates during an active round.',
    {
      agent_id: optionalAgentId,
    },
    async ({ agent_id }) => {
      const state = await client.getState(agent_id);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(state, null, 2),
          },
        ],
      };
    }
  );

  // 2. look_around
  server.tool(
    'look_around',
    'Capture the current street-view viewport frame at the agent camera heading, pitch, and zoom as a JPEG image along with compass metadata and available road exits.',
    {
      include_compass_overlay: z
        .boolean()
        .optional()
        .describe(
          'Optional: draw a compact compass & zoom HUD badge on the captured JPEG image.'
        ),
      agent_id: optionalAgentId,
    },
    async ({ include_compass_overlay, agent_id }) => {
      const frame = await client.lookAround(
        Boolean(include_compass_overlay),
        agent_id
      );
      return formatFrameResponse(frame);
    }
  );

  // 3. pan_and_zoom
  server.tool(
    'pan_and_zoom',
    'Adjust camera heading (0-360, where 0=North, 90=East, 180=South, 270=West), pitch (-90 to 90), and zoom (0 to 3), returning the updated street-view image and compass metadata.',
    {
      heading: z
        .number()
        .min(0)
        .max(360)
        .describe('Compass heading in degrees (0-360).'),
      pitch: z
        .number()
        .min(-90)
        .max(90)
        .describe('Camera pitch in degrees (-90 down to +90 up).'),
      zoom: z
        .number()
        .min(0)
        .max(3)
        .describe('Zoom level (0=wide 90deg FOV, 3=telephoto ~30deg FOV).'),
      agent_id: optionalAgentId,
    },
    async ({ heading, pitch, zoom, agent_id }) => {
      const frame = await client.panAndZoom(heading, pitch, zoom, agent_id);
      return formatFrameResponse(frame);
    }
  );

  // 4. move
  server.tool(
    'move',
    'Move along road links to an adjacent street-view panorama node using either a relative direction (forward, backward, left, right) or a specific node_id from availableMoves. Returns the new panorama frame and updated exits.',
    {
      direction: z
        .enum(['forward', 'backward', 'left', 'right'])
        .optional()
        .describe('Relative direction based on current camera heading.'),
      node_id: z
        .string()
        .min(1)
        .optional()
        .describe('Specific adjacent nodeId from availableMoves.'),
      agent_id: optionalAgentId,
    },
    async ({ direction, node_id, agent_id }) => {
      if (!direction && !node_id) {
        throw new Error(
          'Provide either `direction` (forward/backward/left/right) or `node_id`.'
        );
      }
      const frame = await client.move({
        direction,
        nodeId: node_id,
        overrideAgentId: agent_id,
      });
      return formatFrameResponse(frame);
    }
  );

  // 5. return_to_start
  server.tool(
    'return_to_start',
    'Teleport back to the initial spawn panorama node for the current round and return the starting frame.',
    {
      agent_id: optionalAgentId,
    },
    async ({ agent_id }) => {
      const frame = await client.returnToStart(agent_id);
      return formatFrameResponse(frame);
    }
  );

  // 6. submit_guess
  server.tool(
    'submit_guess',
    'Lock in your final WGS84 latitude (-90..90) and longitude (-180..180) guess for the active round, plus optional deduction reasoning and an optional integer chip wager when Confidence Betting Mode is enabled.',
    {
      latitude: z
        .number()
        .min(-90)
        .max(90)
        .describe('Predicted latitude in decimal degrees (-90 to +90).'),
      longitude: z
        .number()
        .min(-180)
        .max(180)
        .describe('Predicted longitude in decimal degrees (-180 to +180).'),
      reasoning: z
        .string()
        .max(2000)
        .optional()
        .describe(
          'Short explanation of visual clues (signs, sun angle, driving side, architecture) displayed after the round.'
        ),
      wager: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe(
          'Optional non-negative integer chip wager when Confidence Betting Mode is enabled (0 up to your current chips balance). Omit to let the server apply a confidence-based auto-wager.'
        ),
      agent_id: optionalAgentId,
    },
    async ({ latitude, longitude, reasoning, wager, agent_id }) => {
      const result = await client.submitGuess(
        latitude,
        longitude,
        reasoning,
        agent_id,
        wager
      );
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // Resource 1: game://rules
  server.resource(
    'game-rules',
    'game://rules',
    {
      description:
        'Explains the GeoGuessr MCP Arena scoring system, matchup and location modes, confidence chip betting rules, coordinate format, and visual exploration strategy.',
      mimeType: 'text/markdown',
    },
    async () => ({
      contents: [
        {
          uri: 'game://rules',
          mimeType: 'text/markdown',
          text: GAME_RULES_MARKDOWN,
        },
      ],
    })
  );

  // Resource 2: game://leaderboard
  server.resource(
    'game-leaderboard',
    'game://leaderboard',
    {
      description:
        'Live JSON standings across rounds for all human and AI players (including chip balances and net chips when betting is enabled).',
      mimeType: 'application/json',
    },
    async () => {
      const leaderboard = await client.getLeaderboard();
      return {
        contents: [
          {
            uri: 'game://leaderboard',
            mimeType: 'application/json',
            text: JSON.stringify(leaderboard, null, 2),
          },
        ],
      };
    }
  );

  return server;
}
