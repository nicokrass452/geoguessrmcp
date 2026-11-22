import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { HealthInfo } from '@geoguessr-mcp/shared';
import type { AgyRunner } from '../agyRunner.js';
import type { GameEngine } from '../gameEngine.js';

const NewMatchSchema = z.object({
  mode: z
    .enum(['1v1', 'ffa', 'pvp_ai', 'pvp', 'solo', 'spectator'])
    .optional(),
  locationMode: z
    .enum(['standard', 'big_cities', 'mountain_regions'])
    .optional(),
  bettingEnabled: z.boolean().optional(),
  startingChips: z.number().int().min(100).max(1_000_000).optional(),
  totalRounds: z.number().int().min(1).max(10).optional(),
  roundDurationSec: z.number().int().min(10).max(900).nullable().optional(),
  provider: z
    .enum(['auto', 'open', 'wikimedia', 'mapillary', 'google'])
    .optional(),
  humanName: z.string().trim().min(1).max(40).optional(),
  playerId: z.string().trim().min(1).max(80).optional(),
  roomCode: z.string().trim().min(1).max(24).optional(),
  selectedModels: z.array(z.string().min(1)).optional(),
  maxStepsPerRound: z.number().int().min(2).max(20).optional(),
  timeoutSec: z.number().int().min(30).max(300).optional(),
  autoPlayEnabled: z.boolean().optional(),
  autoStart: z.boolean().optional(),
});

const JoinRoomSchema = z.object({
  playerId: z.string().trim().min(1).max(80).optional(),
  playerName: z.string().trim().min(1).max(40),
});

const RoomActionSchema = z.object({
  playerId: z.string().trim().min(1).max(80).optional(),
  roomCode: z.string().trim().min(1).max(24).optional(),
});

const CameraSchema = z.object({
  heading: z.number(),
  pitch: z.number().min(-90).max(90),
  zoom: z.number().min(0).max(3),
  roomCode: z.string().trim().min(1).max(24).optional(),
  playerId: z.string().trim().min(1).max(80).optional(),
});

const MoveSchema = z.object({
  direction: z.enum(['forward', 'backward', 'left', 'right']).optional(),
  nodeId: z.string().min(1).optional(),
  node_id: z.string().min(1).optional(),
  roomCode: z.string().trim().min(1).max(24).optional(),
  playerId: z.string().trim().min(1).max(80).optional(),
});

const GuessSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  reasoning: z.string().max(2000).optional(),
  wager: z.number().int().min(0).optional(),
  roomCode: z.string().trim().min(1).max(24).optional(),
  playerId: z.string().trim().min(1).max(80).optional(),
});

const RegisterAgentSchema = z.object({
  agentId: z.string().min(1).max(80).optional(),
  name: z.string().min(1).max(60),
  model: z.string().max(80).optional(),
  transport: z.string().max(40).optional(),
  roomCode: z.string().trim().min(1).max(24).optional(),
});

const AgyConfigSchema = z.object({
  autoPlayEnabled: z.boolean().optional(),
  selectedModels: z.array(z.string().min(1)).optional(),
  maxStepsPerRound: z.number().int().min(2).max(20).optional(),
  timeoutSec: z.number().int().min(30).max(300).optional(),
});

const AgyTriggerSchema = z.object({
  models: z.array(z.string().min(1)).optional(),
  roomCode: z.string().trim().min(1).max(24).optional(),
});

const McpHeartbeatSchema = z.object({
  transport: z.string().trim().min(1).max(40),
  activeSessions: z.number().int().min(0).optional(),
  agentId: z.string().trim().min(1).max(80).optional(),
});

function extractContext(
  req: Request,
  body?: { roomCode?: string; playerId?: string }
): { roomCode?: string; playerId?: string } {
  const roomCode =
    body?.roomCode ||
    (typeof req.query.roomCode === 'string' ? req.query.roomCode : undefined) ||
    req.header('x-room-code') ||
    undefined;
  const playerId =
    body?.playerId ||
    (typeof req.query.playerId === 'string' ? req.query.playerId : undefined) ||
    req.header('x-player-id') ||
    undefined;
  return {
    roomCode: roomCode?.trim() || undefined,
    playerId: playerId?.trim() || undefined,
  };
}

function handleError(res: Response, err: unknown): void {
  const message =
    err instanceof Error ? err.message : 'Unexpected server error';
  const status =
    message.includes('Unknown agentId') ||
    message.includes('Unknown roomCode') ||
    message.includes('Unknown panorama node')
      ? 404
      : message.includes('Only the room host')
        ? 403
        : message.includes('1v1 mode') ||
            message.includes('AI agents cannot join') ||
            message.includes('Spectator mode is AI-only')
          ? 409
          : 400;
  res.status(status).json({ error: message });
}

export function createApiRouter(
  engine: GameEngine,
  agyRunner?: AgyRunner
): Router {
  const router = Router();

  router.get('/health', (_req: Request, res: Response) => {
    const info: HealthInfo = {
      status: 'ok',
      configuredProviders: {
        open: true,
        wikimedia: engine.config.enableWikimediaFetch,
        mapillary: Boolean(engine.config.mapillaryAccessToken),
        google: Boolean(engine.config.googleMapsApiKey),
      },
      mapillaryAccessToken: null,
      defaultProvider: engine.config.defaultProvider,
      mcpStatus: engine.getMcpStatusSync(),
    };
    res.json(info);
  });

  // Live MCP Status & Heartbeat endpoints
  router.get('/mcp/status', async (_req: Request, res: Response) => {
    try {
      const status = await engine.getMcpStatus();
      res.json(status);
    } catch (err) {
      handleError(res, err);
    }
  });

  router.post('/mcp/heartbeat', (req: Request, res: Response) => {
    try {
      const parsed = McpHeartbeatSchema.parse(req.body ?? {});
      const status = engine.recordMcpHeartbeat(parsed);
      res.json(status);
    } catch (err) {
      handleError(res, err);
    }
  });

  // Match & Public UI endpoints
  router.get('/match', (req: Request, res: Response) => {
    try {
      const ctx = extractContext(req);
      res.json(engine.getPublicState(ctx.roomCode, ctx.playerId));
    } catch (err) {
      handleError(res, err);
    }
  });

  router.post('/match/new', async (req: Request, res: Response) => {
    try {
      const parsed = NewMatchSchema.parse(req.body ?? {});
      const ctx = extractContext(req, parsed);
      const state = await engine.startNewMatch({
        ...parsed,
        roomCode: ctx.roomCode,
        playerId: ctx.playerId,
        autoStart: parsed.autoStart ?? true,
      });

      if (
        agyRunner &&
        (parsed.selectedModels !== undefined ||
          parsed.maxStepsPerRound !== undefined ||
          parsed.timeoutSec !== undefined ||
          parsed.autoPlayEnabled !== undefined)
      ) {
        const allowAi = state.mode !== 'solo' && state.mode !== 'pvp';
        agyRunner.updateConfig({
          autoPlayEnabled: allowAi ? parsed.autoPlayEnabled : false,
          selectedModels: parsed.selectedModels,
          maxStepsPerRound: parsed.maxStepsPerRound,
          timeoutSec: parsed.timeoutSec,
        });
      }

      res.json(engine.getPublicState(state.roomCode, ctx.playerId));
    } catch (err) {
      handleError(res, err);
    }
  });

  // Multi-human Room endpoints
  router.post('/rooms', async (req: Request, res: Response) => {
    try {
      const parsed = NewMatchSchema.parse(req.body ?? {});
      const ctx = extractContext(req, parsed);
      const created = await engine.createRoom({
        ...parsed,
        roomCode: parsed.roomCode,
        playerId: ctx.playerId,
        autoStart: parsed.autoStart ?? false,
      });

      if (
        agyRunner &&
        (parsed.selectedModels !== undefined ||
          parsed.maxStepsPerRound !== undefined ||
          parsed.timeoutSec !== undefined ||
          parsed.autoPlayEnabled !== undefined)
      ) {
        const allowAi =
          created.state.mode !== 'solo' && created.state.mode !== 'pvp';
        agyRunner.updateConfig({
          autoPlayEnabled: allowAi ? parsed.autoPlayEnabled : false,
          selectedModels: parsed.selectedModels,
          maxStepsPerRound: parsed.maxStepsPerRound,
          timeoutSec: parsed.timeoutSec,
        });
      }

      res.json({
        roomCode: created.roomCode,
        hostPlayerId: created.hostPlayerId,
        state: engine.getPublicState(created.roomCode, created.hostPlayerId),
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.post('/rooms/:code/join', (req: Request, res: Response) => {
    try {
      const parsed = JoinRoomSchema.parse(req.body ?? {});
      const ctx = extractContext(req, { playerId: parsed.playerId });
      const joined = engine.joinRoom(String(req.params.code), {
        playerId: ctx.playerId,
        playerName: parsed.playerName,
      });
      res.json(joined);
    } catch (err) {
      handleError(res, err);
    }
  });

  router.post('/rooms/:code/start', async (req: Request, res: Response) => {
    try {
      const parsed = RoomActionSchema.parse(req.body ?? {});
      const ctx = extractContext(req, parsed);
      const started = await engine.startRoom(String(req.params.code), {
        playerId: ctx.playerId,
      });
      res.json(started);
    } catch (err) {
      handleError(res, err);
    }
  });

  router.post('/rooms/:code/leave', (req: Request, res: Response) => {
    try {
      const parsed = RoomActionSchema.parse(req.body ?? {});
      const ctx = extractContext(req, parsed);
      const left = engine.leaveRoom(String(req.params.code), {
        playerId: ctx.playerId,
      });
      res.json(left);
    } catch (err) {
      handleError(res, err);
    }
  });

  router.post('/match/end-round', (req: Request, res: Response) => {
    try {
      const parsed = RoomActionSchema.parse(req.body ?? {});
      const ctx = extractContext(req, parsed);
      const state = engine.endCurrentRound('manual', ctx.roomCode, ctx.playerId);
      res.json(state);
    } catch (err) {
      handleError(res, err);
    }
  });

  router.post('/match/next-round', async (req: Request, res: Response) => {
    try {
      const parsed = RoomActionSchema.parse(req.body ?? {});
      const ctx = extractContext(req, parsed);
      const state = await engine.advanceToNextRound(ctx);
      res.json(state);
    } catch (err) {
      handleError(res, err);
    }
  });

  router.get('/leaderboard', (req: Request, res: Response) => {
    try {
      const ctx = extractContext(req);
      res.json(engine.getLeaderboardPayload(ctx.roomCode));
    } catch (err) {
      handleError(res, err);
    }
  });

  // Human player endpoints
  router.post('/human/camera', (req: Request, res: Response) => {
    try {
      const parsed = CameraSchema.parse(req.body ?? {});
      const ctx = extractContext(req, parsed);
      res.json(
        engine.updateHumanCamera(
          parsed.heading,
          parsed.pitch,
          parsed.zoom,
          ctx
        )
      );
    } catch (err) {
      handleError(res, err);
    }
  });

  router.post('/human/move', (req: Request, res: Response) => {
    try {
      const parsed = MoveSchema.parse(req.body ?? {});
      const ctx = extractContext(req, parsed);
      res.json(
        engine.moveHuman({
          direction: parsed.direction,
          nodeId: parsed.nodeId ?? parsed.node_id,
          roomCode: ctx.roomCode,
          playerId: ctx.playerId,
        })
      );
    } catch (err) {
      handleError(res, err);
    }
  });

  router.post('/human/return-to-start', (req: Request, res: Response) => {
    try {
      const parsed = RoomActionSchema.parse(req.body ?? {});
      const ctx = extractContext(req, parsed);
      res.json(engine.returnHumanToStart(ctx));
    } catch (err) {
      handleError(res, err);
    }
  });

  router.post('/human/guess', (req: Request, res: Response) => {
    try {
      const parsed = GuessSchema.parse(req.body ?? {});
      const ctx = extractContext(req, parsed);
      res.json(
        engine.submitHumanGuess(parsed.latitude, parsed.longitude, {
          roomCode: ctx.roomCode,
          playerId: ctx.playerId,
          wager: parsed.wager,
        })
      );
    } catch (err) {
      handleError(res, err);
    }
  });

  // Equirectangular texture for Human 360° viewer
  router.get(
    '/panoramas/:roundId/:nodeId/equirectangular.jpg',
    async (req: Request, res: Response) => {
      try {
        const jpg = await engine.getRoundNodeEquirectangularJpeg(
          String(req.params.roundId),
          String(req.params.nodeId)
        );
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.send(jpg);
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  // MCP Agent endpoints
  router.post('/agents/register', (req: Request, res: Response) => {
    try {
      const parsed = RegisterAgentSchema.parse(req.body ?? {});
      const ctx = extractContext(req, { roomCode: parsed.roomCode });
      const agent = engine.registerAgent({
        ...parsed,
        roomCode: ctx.roomCode,
      });
      res.json(agent);
    } catch (err) {
      handleError(res, err);
    }
  });

  router.delete('/agents/:agentId', (req: Request, res: Response) => {
    engine.disconnectAgent(String(req.params.agentId));
    res.json({ disconnected: true });
  });

  router.get('/agents/:agentId/state', (req: Request, res: Response) => {
    try {
      res.json(engine.getAgentState(String(req.params.agentId)));
    } catch (err) {
      handleError(res, err);
    }
  });

  router.post('/agents/:agentId/look', async (req: Request, res: Response) => {
    try {
      const includeCompassOverlay = Boolean(req.body?.includeCompassOverlay);
      const frame = await engine.getAgentFrame(String(req.params.agentId), {
        includeCompassOverlay,
        recordActivity: true,
      });
      res.json(frame);
    } catch (err) {
      handleError(res, err);
    }
  });

  router.post(
    '/agents/:agentId/pan-zoom',
    async (req: Request, res: Response) => {
      try {
        const { heading, pitch, zoom } = CameraSchema.parse(req.body ?? {});
        const frame = await engine.panAndZoomAgent(
          String(req.params.agentId),
          heading,
          pitch,
          zoom
        );
        res.json(frame);
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  router.post('/agents/:agentId/move', async (req: Request, res: Response) => {
    try {
      const parsed = MoveSchema.parse(req.body ?? {});
      const frame = await engine.moveAgent(String(req.params.agentId), {
        direction: parsed.direction,
        nodeId: parsed.nodeId ?? parsed.node_id,
      });
      res.json(frame);
    } catch (err) {
      handleError(res, err);
    }
  });

  router.post(
    '/agents/:agentId/return-to-start',
    async (req: Request, res: Response) => {
      try {
        const frame = await engine.returnAgentToStart(
          String(req.params.agentId)
        );
        res.json(frame);
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  router.post('/agents/:agentId/guess', (req: Request, res: Response) => {
    try {
      const { latitude, longitude, reasoning, wager } = GuessSchema.parse(
        req.body ?? {}
      );
      const result = engine.submitAgentGuess(
        String(req.params.agentId),
        latitude,
        longitude,
        reasoning,
        wager
      );
      res.json(result);
    } catch (err) {
      handleError(res, err);
    }
  });

  router.get(
    '/agents/:agentId/viewport.jpg',
    async (req: Request, res: Response) => {
      try {
        const jpg = await engine.renderAgentViewportJpeg(
          String(req.params.agentId)
        );
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'no-store');
        res.send(jpg);
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  // Autonomous Antigravity CLI (agy) Runner endpoints
  router.get('/agy/status', (_req: Request, res: Response) => {
    if (!agyRunner) {
      res.status(501).json({ error: 'AgyRunner is not initialized' });
      return;
    }
    res.json(agyRunner.getStatus());
  });

  router.post('/agy/config', (req: Request, res: Response) => {
    try {
      if (!agyRunner) {
        res.status(501).json({ error: 'AgyRunner is not initialized' });
        return;
      }
      const parsed = AgyConfigSchema.parse(req.body ?? {});
      res.json(agyRunner.updateConfig(parsed));
    } catch (err) {
      handleError(res, err);
    }
  });

  router.post('/agy/trigger', (req: Request, res: Response) => {
    try {
      if (!agyRunner) {
        res.status(501).json({ error: 'AgyRunner is not initialized' });
        return;
      }
      const parsed = AgyTriggerSchema.parse(req.body ?? {});
      const ctx = extractContext(req, parsed);
      res.json(agyRunner.triggerCurrentRound(parsed.models, ctx.roomCode));
    } catch (err) {
      handleError(res, err);
    }
  });

  router.post('/agy/stop', (_req: Request, res: Response) => {
    if (!agyRunner) {
      res.status(501).json({ error: 'AgyRunner is not initialized' });
      return;
    }
    res.json(agyRunner.stopAllActiveRuns('Stopped by player'));
  });

  return router;
}
