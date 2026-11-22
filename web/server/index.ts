import cors from 'cors';
import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { loadServerConfig } from './config.js';
import { AgyRunner } from './agyRunner.js';
import { GameEngine } from './gameEngine.js';
import { createApiRouter } from './routes/api.js';
import { WsHub } from './wsHub.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const config = loadServerConfig();
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));

  const wsHub = new WsHub();
  const engine = new GameEngine(config, wsHub);
  const agyRunner = new AgyRunner(config, engine);
  engine.setLifecycleHooks({
    onRoundStarted: (roundNum, roomCode) =>
      agyRunner.onRoundStarted(roundNum, roomCode),
    onRoundEnded: (roundNum, roomCode) =>
      agyRunner.onRoundEnded(roundNum, roomCode),
    onMatchReset: (roomCode) => agyRunner.onMatchReset(roomCode),
    getAgyStatus: () => agyRunner.getStatus(),
  });
  await engine.init();

  app.use('/api', createApiRouter(engine, agyRunner));

  // Serve production frontend if built (`web/dist`)
  const distDir = path.resolve(__dirname, '..', 'dist');
  const distDirAlt = path.resolve(__dirname, '..', '..', 'dist');
  const staticDir = fs.existsSync(distDir)
    ? distDir
    : fs.existsSync(distDirAlt)
      ? distDirAlt
      : null;

  if (staticDir) {
    app.use(express.static(staticDir));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/ws')) {
        next();
        return;
      }
      res.sendFile(path.join(staticDir, 'index.html'));
    });
  }

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });
  wsHub.attach(wss, (socket, meta) => {
    try {
      wsHub.sendTo(socket, {
        type: 'state_sync',
        state: engine.getPublicState(
          meta.roomCode !== 'DEFAULT' ? meta.roomCode : undefined,
          meta.playerId
        ),
      });
    } catch {
      wsHub.sendTo(socket, {
        type: 'state_sync',
        state: engine.getPublicState(undefined, meta.playerId),
      });
    }
  });

  server.listen(config.port, () => {
    console.log(
      `[GeoGuessr-MCP Backend] Listening on http://localhost:${config.port} (WebSocket at ws://localhost:${config.port}/ws)`
    );
    console.log(
      `[GeoGuessr-MCP Backend] Provider mode: ${config.defaultProvider} | Mapillary: ${
        config.mapillaryAccessToken ? 'configured' : 'off'
      } | Google SV: ${config.googleMapsApiKey ? 'configured' : 'off'}`
    );
  });

  const shutdown = () => {
    agyRunner.shutdown();
    wss.close();
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
