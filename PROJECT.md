# Project: GeoGuessr-MCP Welcome Hub & Multi-Mode Arena

## Architecture
GeoGuessr-MCP is a 3-workspace TypeScript monorepo (`shared`, `web`, `mcp-server`):
- **`shared` (`shared/src/`)**: Single source of truth for game modes, location/region modes, betting/chip types, multi-human room state, MCP connection telemetry, WebSocket message unions, geo math, and `GAME_RULES_MARKDOWN`. Built to `shared/dist/` before `web` and `mcp-server`.
- **`mcp-server` (`mcp-server/src/`)**: Standalone MCP server supporting `stdio`, `streamable-http` (`/mcp`), and `sse` (`/sse`) on port `3002`, bridging AI clients to the game backend (`http://localhost:3001`) via `GameBackendClient`. Exposes 6 tools (`get_game_state`, `look_around`, `pan_and_zoom`, `move`, `return_to_start`, `submit_guess` with optional `wager`) and emits lightweight heartbeats so the backend observes live MCP server connectivity across all transports.
- **`web/server` (`web/server/`)**: Express + `ws` game server on port `3001` (`tsx watch` in dev, `web/dist-server/` in prod). Houses:
  - `panorama/`: `LOCATION_CATALOG`, `MAPILLARY_WORLD_SEEDS`, `PanoramaProviderManager`, and `proceduralRenderer` with strict region-category filtering (`standard`, `big_cities`, `mountain_regions`).
  - `gameEngine.ts` + `wsHub.ts` + `routes/api.ts` + `agyRunner.ts`: Room-scoped multi-human + AI match engine keyed by `roomCode`, enforcing all 5 matchup modes (`1v1`/`ffa`, `pvp_ai`, `pvp`, `solo`, `spectator`), confidence chip betting + round payout settlement, AI-only spectator round completion, atomic pre-match setup, and live MCP server status telemetry.
- **`web/src` (`web/src/`)**: React 19 + Vite + Tailwind v4 SPA on port `5173` (proxying `/api` and `/ws` to `3001`). Boots into the two-step **Welcome Hub** (`view: 'home' | 'arena'`) rather than dropping directly into the 360° viewport, supports multi-tab room-code creation/joining via `sessionStorage`-scoped `playerId`, renders the **Top HUD** (with **Quick Return to Home** and **Live MCP Status Badge**), renders the **SpectatorStage** in AI-Only Spectator Mode, and integrates chip-betting UI across `GuessingMiniMap`, `RoundSummaryOverlay`, and `FinalLeaderboardModal`.

## Code Layout
- `shared/src/types.ts`, `shared/src/geo.ts`, `shared/src/panorama.ts`, `shared/src/index.ts`
- `mcp-server/src/index.ts`, `mcp-server/src/sseServer.ts`, `mcp-server/src/mcpFactory.ts`, `mcp-server/src/backendClient.ts`, `mcp-server/src/demo-agent.ts`
- `web/server/index.ts`, `web/server/config.ts`, `web/server/wsHub.ts`, `web/server/gameEngine.ts`, `web/server/agyRunner.ts`, `web/server/routes/api.ts`
- `web/server/panorama/catalog.ts`, `web/server/panorama/mapillarySeeds.ts`, `web/server/panorama/providers.ts`, `web/server/panorama/proceduralRenderer.ts`
- `web/src/App.tsx`, `web/src/lib/playerSession.ts`, `web/src/lib/api.ts`, `web/src/lib/useGameSocket.ts`
- `web/src/components/WelcomeHub.tsx`, `web/src/components/LobbyModal.tsx`, `web/src/components/TopHud.tsx`, `web/src/components/SpectatorStage.tsx`, `web/src/components/AgentHud.tsx`, `web/src/components/GuessingMiniMap.tsx`, `web/src/components/RoundSummaryOverlay.tsx`, `web/src/components/FinalLeaderboardModal.tsx`
- `scripts/verify-e2e.mjs` (plus any modular E2E helpers under `scripts/e2e/`)

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Shared Types & Contracts | Expand `GameMode` (`1v1`, `ffa`, `pvp_ai`, `pvp`, `solo`, `spectator`), add `LocationMode` (`standard`, `big_cities`, `mountain_regions`), betting/chip/wager/payout fields, multi-human `roomCode`/`humans` roster, and `McpStatusInfo` | M1 | ORIGINAL_REQUEST R1-R3, Survey 1-3 |
| 2 | MCP `submit_guess` Wager & Rules | Optional `wager` parameter in `mcpFactory.ts` `submit_guess` & `backendClient.ts`, betting fields in `AgentGameState`, and updated `GAME_RULES_MARKDOWN` | M1 | ORIGINAL_REQUEST R1, Survey 2-3 |
| 3 | MCP Bridge Heartbeat & Transport Tracking | `mcp-server` (`stdio` & `http`/`sse`) sends lightweight heartbeat / transport metadata to backend so live MCP availability is observable | M1 | ORIGINAL_REQUEST R3, Survey 2-3 |
| 4 | Region-Tagged Location Catalog & Mountain Expansion | Tag all `LOCATION_CATALOG` entries (`big_city`/`mountain`), add 9-11 authentic mountain locations & alpine landmarks so Mountain Regions Only supports up to 10-round matches without repeats | M2 | ORIGINAL_REQUEST R1, Survey 2 |
| 5 | Mountain Mapillary Seeds & Strict Pool Filtering | Add 12+ mountain `MapillaryWorldSeed` entries, tag seeds, and enforce `LocationMode` filtering in `PanoramaProviderManager` (`pickRandomLocations`, Mapillary, Google, Open) | M2 | ORIGINAL_REQUEST R1, Survey 2 |
| 6 | Multi-Room & Multi-Human WS Sync | Room-code registry in `GameEngine`, per-tab `playerId` support, `/api/rooms` create/join/start/leave endpoints, personalized `WsHub` `state_sync` per `roomCode` + `playerId`, backwards-compatible default room | M3 | ORIGINAL_REQUEST R1, Survey 1-2 |
| 7 | 5 Matchup Modes Enforcement | Enforce `1v1` (1 human + 1 AI), `ffa` (1 human + multi AI), `pvp_ai` (multi-human + AI), `pvp` (multi-human, no AI), `solo` (1 human, no AI), `spectator` (AI-only, auto-start `AgyRunner` / MCP agents, round completes without human guess) | M3 | ORIGINAL_REQUEST R1, Survey 1-2 |
| 8 | Confidence Chip Betting & Settlement | Initialize starting chips (`1000`), validate human & AI `wager`, deterministic confidence-based auto-wager when AI omits `wager`, settle round payouts & net chip deltas in `RoundSummary` & `LeaderboardEntry` | M3 | ORIGINAL_REQUEST R1, Survey 2-3 |
| 9 | Atomic Pre-Match Setup & Return Home Reset | `POST /api/match/new` & `POST /api/rooms` atomically apply display name, AI lineup, rounds (`3/5/10`), timer, step cap, provider, `locationMode`, `bettingEnabled`; clean leave/stop active `AgyRunner` runs on Return Home | M3 | ORIGINAL_REQUEST R2-R3, Survey 1-2 |
| 10 | Backend Live MCP Telemetry | Combine `WsHub` `role=agent` sockets, MCP tool/heartbeat recency, and `http://127.0.0.1:3002/health` probe into `McpStatusInfo` exposed via `PublicGameState` & `/api/mcp/status` | M3 | ORIGINAL_REQUEST R3, Survey 2-3 |
| 11 | Tab-Scoped Client Session & Room API/WS Hooks | `sessionStorage`-scoped `playerId`, room-scoped `api.ts` & `useGameSocket.ts` (`roomCode` & `playerId`), room creation/join/start/leave methods | M4 | ORIGINAL_REQUEST R1-R2, Survey 1 |
| 12 | Two-Step Welcome Hub & Pre-Match Setup UI | Replace direct 360° viewport drop on `http://localhost:5173/` with Step 1 (5 matchup mode cards + PvP/PvPvAI room create/join) -> Step 2 (Standard / Big Cities Only / Mountain Regions Only + Confidence Betting toggle + display name, AI lineup, rounds `3/5/10`, timer, step cap, provider, Play CTA); align/retain `LobbyModal.tsx` | M4 | ORIGINAL_REQUEST R1-R2, Survey 1 |
| 13 | Betting UI & Settlement Overlays | Chip balance + wager selector/presets in `GuessingMiniMap.tsx`, wager/chipDelta/chipsAfter columns in `RoundSummaryOverlay.tsx`, final chip standings in `FinalLeaderboardModal.tsx` (plus Return Home CTA) | M5 | ORIGINAL_REQUEST R1, Survey 1 |
| 14 | Top HUD Quick Return Home & Live MCP Badge | Add **Quick Return to Home** button and **Live MCP Status Badge** (plus chip stack & room code pill) in `TopHud.tsx` | M6 | ORIGINAL_REQUEST R3, Survey 1-3 |
| 15 | AI-Only Spectator Mode Multi-POV Stage | Dedicated `SpectatorStage.tsx` replacing `PanoramaViewer` & `GuessingMiniMap` in `spectator` mode, showing live Gemini/Claude/GPT-OSS POV feeds (`/api/agents/:id/viewport.jpg`), headings, step budgets, reasoning, wagers, and no human guess requirement | M6 | ORIGINAL_REQUEST R1, Survey 1-2 |
| 16 | `App.tsx` Welcome Hub <-> Arena Flow & `AgentHud` Integration | Wire `view: 'home' | 'arena'` initial Welcome Hub landing, room waiting lobby, mode-aware HUD visibility (`solo`/`pvp` hide AI summon controls; `spectator` mounts `SpectatorStage`), and clean Return Home transition | M6 | ORIGINAL_REQUEST R1-R3, Survey 1 |
| 17 | Opaque-Box E2E Test Suite & `verify-e2e.mjs` Updates | Update `scripts/verify-e2e.mjs` + create comprehensive Tier 1-4 E2E suite covering Welcome Hub landing, all 5 modes, 3 region gamemodes, betting/`wager`, multi-tab room sync, AI spectator completion, Top HUD Home + MCP badge, and live browser checks | E2E Track | ORIGINAL_REQUEST AC, Survey 3 |
| 18 | Full E2E Pass (Tiers 1-4), Browser Verification & Tier 5 Hardening | Run `npm run typecheck`, `npm run build`, `scripts/verify-e2e.mjs`, live browser verification on `http://localhost:5173/` (leaving ports 5173/3001 intact), and Tier 5 white-box adversarial coverage hardening | M7 | ORIGINAL_REQUEST AC |

## Not Yet Implemented Features (Roadmap)

| # | Feature | Estimated Effort | Details & Implementation Notes |
|---|---------|------------------|--------------------------------|
| 1 | **Move All Compute to Google Cloud (`gcloud`)** | ~1h (server + MCP bridge) + ~2–3h (cloud-native AI bots) | **Part A — Web App, Game Engine, Panorama Renderer & MCP Bridge (~30–60 min):** Pure Node.js (`express`, `ws`, `jpeg-js`, `pngjs`) with no native OS dependencies. Mount `/mcp` + `/sse` (`mcp-server/src/sseServer.ts`) onto the single Express server (`web/server/index.ts`), add a `Dockerfile`, and deploy either via `gcloud run deploy` (`--max-instances=1` / `--min-instances=1` since rooms and WebSocket state live in memory inside `GameEngine`) or a Compute Engine VM (`e2-medium` / `e2-standard-2`) for persistent `cache/panoramas/` disk caching, permanent HTTPS, and faster direct Mapillary/CDN fetches without local proxies or temporary `trycloudflare.com` URLs.<br>**Part B — Cloud-Native Autonomous AI Bots (~2–3 hours):** Replace local Windows `agy.exe` spawning in `web/server/agyRunner.ts` with an in-process multimodal agent loop using Vertex AI / Gemini API (`@google/genai`, plus optional Anthropic/OpenAI SDKs) with API keys in GCP Secret Manager, calling the 6 game actions directly. *(Alternative with 0 code changes: deploy only the server + `/mcp` endpoint and connect external AI clients remotely to `https://<your-cloud-run-url>/mcp`.)* |
| 2 | **True Two-Step Wizard Layout & Upgraded Welcome Hub UI** | ~1–2h | Refactor `web/src/components/WelcomeHub.tsx` so Step 1 fills the viewport without rendering Step 2 underneath until confirmed, move Spectator Mode into the top header to leave a balanced 2×2 core mode grid, conditionally render only mode-relevant Step 2 sections (hiding AI lineup in `solo`/`pvp`, room controls in single-player, and Confidence Betting in `solo`), and apply the deeper obsidian/radial-glow palette. |
| 3 | **Persistent Room State & Multi-Instance Scaling** | ~3–4h | Persist rooms, match history, leaderboards, and session state (e.g., Redis or Firestore) instead of keeping state solely in-memory in `GameEngine`, enabling horizontal scaling beyond `--max-instances=1` and surviving server restarts. |
| 4 | **Authenticated Public MCP Bridge** | ~1h | Add optional bearer-token / API-key authentication to `mcp-server/src/sseServer.ts` (`/mcp` and `/sse`) before exposing the MCP bridge publicly on the internet. |
| 5 | **Non-Query-String WebSocket Session Auth** | ~30–45m | Move `sessionToken` out of the `/ws?sessionToken=...` query string in `web/src/lib/useGameSocket.ts` and `web/server/wsHub.ts` into a first-frame auth message or `HttpOnly` cookie/header so tokens do not appear in proxy/CDN access logs. |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Shared Contracts & MCP Tooling | `shared/src/*`, `mcp-server/src/*` (Feature #1, #2, #3) | none | DONE (sub_orch_m1_gen2: 02721c0a-b7f4-462e-9c91-3290029f0683) |
| M2 | Location & Region Pools | `web/server/panorama/*` (Feature #4, #5) | M1 | IN_PROGRESS (5630e8a8-74ea-4b7c-b9f3-9885dd14fff1) |
| M3 | Backend Room Engine, Modes, Betting & MCP Telemetry | `web/server/gameEngine.ts`, `wsHub.ts`, `routes/api.ts`, `agyRunner.ts`, `index.ts` (Feature #6, #7, #8, #9, #10) | M1, M2 | PLANNED |
| M4 | Frontend Client Sync & Two-Step Welcome Hub | `web/src/lib/*`, `web/src/components/WelcomeHub.tsx`, `LobbyModal.tsx` (Feature #11, #12) | M1, M3 | PLANNED |
| M5 | Frontend Betting & Results Overlays | `web/src/components/GuessingMiniMap.tsx`, `RoundSummaryOverlay.tsx`, `FinalLeaderboardModal.tsx` (Feature #13) | M1 | IN_PROGRESS (185ec3bc-737c-4f46-a4ac-9f4778e23af7) |
| M6 | Arena Integration, Top HUD & AI Spectator Stage | `web/src/App.tsx`, `TopHud.tsx`, `SpectatorStage.tsx`, `AgentHud.tsx` (Feature #14, #15, #16) | M4, M5 | PLANNED |
| E2E | Opaque-Box E2E Testing Track | `TEST_INFRA.md`, `scripts/verify-e2e.mjs`, `scripts/e2e/*`, `TEST_READY.md` (Feature #17) | none | IN_PROGRESS (8b31e448-4be1-4e1d-8597-445a49704d8f) |
| M7 | Final Milestone (E2E Pass + Tier 5 Adversarial Hardening) | Phase 1: 100% E2E Tiers 1-4 + live browser verification on `5173`; Phase 2: Tier 5 adversarial coverage hardening (Feature #18) | M6, E2E | PLANNED |

## Interface Contracts

### `shared/src/types.ts` Contracts
- `GameMode = '1v1' | 'ffa' | 'pvp_ai' | 'pvp' | 'solo' | 'spectator'`
- `LocationMode = 'standard' | 'big_cities' | 'mountain_regions'`
- `McpStatusInfo`:
  - `{ connected: boolean; status: 'connected' | 'bridge_ready' | 'offline'; httpBridgeReachable: boolean; activeAgentSockets: number; activeMcpAgents: number; transports: string[]; lastActivityAt: number | null; agyAvailable: boolean }`
- `HumanPlayerView`:
  - Add `chips: number; currentWager: number | null; connected: boolean; isHost?: boolean;`
- `PlayerInfo` (AI agents) & `AgentGameState`:
  - Add `transport?: string; chips: number; currentWager: number | null;` (`AgentGameState` also exposes `locationMode: LocationMode`, `bettingEnabled: boolean`, `chips: number`, `currentWager: number | null`).
- `PlayerGuess`: `{ playerId, latitude, longitude, reasoning?, wager?, submittedAt }`
- `RoundPlayerScore`: `{ playerId, name, isHuman, color, model?, guess, distanceKm, score, wager?, chipDelta?, chipsAfter? }`
- `LeaderboardEntry`: `{ playerId, name, isHuman, color, model?, totalScore, roundScores, averageDistanceKm, wins, chips?, netChips? }`
- `PublicGameState`:
  - Keep `human: HumanPlayerView` (personalized per requesting player/tab; spectator placeholder in `spectator` mode)
  - Add `roomCode: string`, `hostPlayerId: string | null`, `humans: HumanPlayerView[]`, `locationMode: LocationMode`, `bettingEnabled: boolean`, `startingChips: number`, `mcpStatus: McpStatusInfo`.
- `HealthInfo`: Keep existing fields (never log/print raw tokens in UI or logs), optionally include `mcpStatus?: McpStatusInfo`.

### REST & WebSocket API Contracts (`web/server/`)
- **WebSocket** `/ws?role=ui|agent&roomCode=...&playerId=...&playerName=...&agentId=...`:
  - Personalized `state_sync` per `roomCode` + `playerId`.
  - Room-scoped broadcasts (`activity_event`, `agent_camera_updated`, `timer_tick`, `round_ended`, `match_ended`).
- **Room & Match Endpoints**:
  - `POST /api/rooms` -> `{ roomCode, hostPlayerId, state }` (creates a room in `'lobby'` or starts immediately if `autoStart: true`).
  - `POST /api/rooms/:code/join` -> `{ playerId, playerName }` -> `{ state }` (joins human to room; returns 404 if invalid code).
  - `POST /api/rooms/:code/start` -> `{ playerId? }` -> `{ state }` (host starts match from `'lobby'` -> `'active'`).
  - `POST /api/rooms/:code/leave` -> `{ playerId }` -> `{ ok: true }` (marks human disconnected / removes from room, stops active `AgyRunner` if room no longer has active match participants).
  - `POST /api/match/new` -> accepts `{ mode, locationMode, bettingEnabled, startingChips, totalRounds, roundDurationSec, provider, humanName, playerId, roomCode, selectedModels, maxStepsPerRound, timeoutSec, autoPlayEnabled }`; configures both `GameEngine` and `AgyRunner` atomically and starts match.
  - `GET /api/match` -> accepts `?roomCode=...&playerId=...` (or `X-Room-Code` / `X-Player-Id` headers), defaults to active room + `'human'`.
  - `POST /api/human/camera|move|return-to-start|guess` & `POST /api/match/end-round|next-round` -> accept `roomCode` & `playerId` via header/query/body; `/guess` accepts `{ latitude, longitude, wager? }`.
  - `GET /api/mcp/status` -> returns `McpStatusInfo`; `POST /api/mcp/heartbeat` -> `{ transport, activeSessions?, agentId? }`.

### MCP Tool Contract (`mcp-server/src/mcpFactory.ts`)
- `submit_guess`: `{ latitude: number (-90..90), longitude: number (-180..180), reasoning?: string, wager?: int >= 0, agent_id?: string }`.
- `GameBackendClient.submitGuess(latitude, longitude, reasoning?, agentId?, wager?)` forwards `wager` in `POST /api/agents/:agentId/guess`.
