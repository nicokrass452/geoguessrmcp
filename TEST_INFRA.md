# GeoGuessr-MCP E2E Test Infrastructure Specification (`TEST_INFRA.md`)

> **Authoritative Sources**: `ORIGINAL_REQUEST.md` (`R1`–`R3`, Acceptance Criteria) and `PROJECT.md` (`F1`–`F16`, Interface Contracts).  
> **Scope**: Opaque-box, requirement-driven End-to-End verification across REST (`/api/*`), WebSocket (`/ws`), MCP (`stdio`, Streamable HTTP `/mcp`, legacy SSE `/sse`), and Headless Browser CDP (`scripts/e2e/browser.mjs`).

---

## 1. Test Philosophy

1. **Opaque-Box & Requirement-Driven**
   - Every test derives strictly from external product requirements (`ORIGINAL_REQUEST.md` `R1`–`R3`) and published interface contracts (`PROJECT.md` § Interface Contracts).
   - Tests interact **exclusively** through public external boundaries: HTTP REST endpoints (`/api/*`), WebSocket frames (`/ws`), MCP tools/resources (`stdio`, `/mcp`, `/sse`), and rendered Browser DOM via Chrome/Edge DevTools Protocol (CDP).
   - Tests NEVER import internal server modules (`web/server/*`, `web/src/*`, `mcp-server/src/*`) or inspect internal React/server class state.

2. **Independence & Deterministic Isolation**
   - Every test case sets up its own state using unique `roomCode` / `playerId` values or fresh match resets (`POST /api/match/new` or `POST /api/rooms`), never relying on execution order from prior tests.
   - Default E2E execution spawns isolated server processes on dedicated ports **`3101`** (backend + built SPA) and **`3102`** (MCP HTTP/SSE bridge) with `PANORAMA_PROVIDER=open` and `ENABLE_WIKIMEDIA_FETCH=false` for fast, deterministic offline execution.
   - Per-case `onCleanup()` hooks run in `finally` blocks so MCP sessions, WebSocket clients, and temporary browser tabs are always closed cleanly.

3. **4-Tier Progressive Verification Methodology**
   - **Tier 1 — Functional & Equivalence Partitioning (`80` cases, `>=5` per feature `F1`–`F16`)**: Exercises every primary behavior and valid equivalence class for all 16 features.
   - **Tier 2 — Boundary Value Analysis & Negative/Robustness (`80` cases, `>=5` per feature `F1`–`F16`)**: Exercises exact numeric boundaries (`min - 1`, `min`, `max`, `max + 1`), invalid enums, malformed/missing IDs, non-host unauthorized actions, duplicate submissions, disconnect resilience, and secret-redaction checks.
   - **Tier 3 — Pairwise Combinatorial Interactions (`18` cases, `>=16`)**: 2-way covering array across `GameMode (6) × LocationMode (3) × BettingEnabled (2) × TotalRounds (3) × RoundTimer (2) × PanoramaProvider (3) × McpTransport (4)` covering 100% of valid 2-factor pairs without running all `2,592` Cartesian combinations.
   - **Tier 4 — Real-World Workload & E2E Browser Scenarios (`10` cases, `>=8`)**: Multi-step user + AI agent + multi-tab journeys across Welcome Hub, Pre-Match Setup, multi-tab WebSocket room sync, live MCP exploration/wager/guessing, round/match settlement, AI-Only Spectator Mode, and Top HUD Return Home.

4. **Port Isolation & Secret-Redaction Safety**
   - **NEVER** kill, restart, or bind live developer server ports **`5173`** (Vite) or **`3001`** (dev backend). `FORBIDDEN_PORTS = [5173, 3001]` is enforced by `assertSafePort()`.
   - **NEVER** kill browser processes globally (`taskkill /IM msedge.exe` or `chrome.exe`). Browser CDP uses an isolated temporary `--user-data-dir` and `--remote-debugging-port=0`, tracking and terminating only its own spawned child PID.
   - **NEVER** read `.env` files or print raw token values (`MAPILLARY_ACCESS_TOKEN`, `GOOGLE_MAPS_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`).
   - Isolated spawned backend (`3101`) and MCP server (`3102`) explicitly blank secret env vars (`MAPILLARY_ACCESS_TOKEN=''`, `GOOGLE_MAPS_API_KEY=''`, `OPENAI_API_KEY=''`, `ANTHROPIC_API_KEY=''`, plus `GEOGUESSR_AGENT_*=''` on MCP spawns) so `dotenv.config({ override: false })` cannot load real credentials or stale agent defaults into the isolated test environment.
   - `assertNoSecretLeak()` and `scrubSecrets()` scan HTTP payloads, WS frames, MCP outputs, DOM text, and runner logs without ever echoing matched secret values.

---

## 2. Full Feature Coverage Inventory

| Feature ID | Feature Name (`PROJECT.md`) | Req Mapping | Tier 1 (Func) | Tier 2 (BVA/Neg) | Tier 3 (Pairwise) | Tier 4 (Scenarios) | Total Direct Cases |
|---|---|---|:---:|:---:|:---:|:---:|:---:|
| **F1** | Shared Types & Contracts | R1–R3 | 5 (`T1-F01-01..05`) | 5 (`T2-F01-01..05`) | ✓ | ✓ | 10+ |
| **F2** | MCP `submit_guess` Wager & Rules | R1 | 5 (`T1-F02-01..05`) | 5 (`T2-F02-01..05`) | ✓ | ✓ | 10+ |
| **F3** | MCP Bridge Heartbeat & Transport Tracking | R3 | 5 (`T1-F03-01..05`) | 5 (`T2-F03-01..05`) | ✓ | ✓ | 10+ |
| **F4** | Region-Tagged Location Catalog & Mountain Expansion | R1 | 5 (`T1-F04-01..05`) | 5 (`T2-F04-01..05`) | ✓ | ✓ | 10+ |
| **F5** | Mountain Mapillary Seeds & Strict Pool Filtering | R1 | 5 (`T1-F05-01..05`) | 5 (`T2-F05-01..05`) | ✓ | ✓ | 10+ |
| **F6** | Multi-Room & Multi-Human WS Sync | R1 | 5 (`T1-F06-01..05`) | 5 (`T2-F06-01..05`) | ✓ | ✓ | 10+ |
| **F7** | 5 Matchup Modes Enforcement | R1 | 5 (`T1-F07-01..05`) | 5 (`T2-F07-01..05`) | ✓ | ✓ | 10+ |
| **F8** | Confidence Chip Betting & Settlement | R1 | 5 (`T1-F08-01..05`) | 5 (`T2-F08-01..05`) | ✓ | ✓ | 10+ |
| **F9** | Atomic Pre-Match Setup & Return Home Reset | R2–R3 | 5 (`T1-F09-01..05`) | 5 (`T2-F09-01..05`) | ✓ | ✓ | 10+ |
| **F10** | Backend Live MCP Telemetry | R3 | 5 (`T1-F10-01..05`) | 5 (`T2-F10-01..05`) | ✓ | ✓ | 10+ |
| **F11** | Tab-Scoped Client Session & Room API/WS Hooks | R1–R2 | 5 (`T1-F11-01..05`) | 5 (`T2-F11-01..05`) | ✓ | ✓ | 10+ |
| **F12** | Two-Step Welcome Hub & Pre-Match Setup UI | R1–R2 | 5 (`T1-F12-01..05`) | 5 (`T2-F12-01..05`) | ✓ | ✓ | 10+ |
| **F13** | Betting UI & Settlement Overlays | R1 | 5 (`T1-F13-01..05`) | 5 (`T2-F13-01..05`) | ✓ | ✓ | 10+ |
| **F14** | Top HUD Quick Return Home & Live MCP Badge | R3 | 5 (`T1-F14-01..05`) | 5 (`T2-F14-01..05`) | ✓ | ✓ | 10+ |
| **F15** | AI-Only Spectator Mode Multi-POV Stage | R1 | 5 (`T1-F15-01..05`) | 5 (`T2-F15-01..05`) | ✓ | ✓ | 10+ |
| **F16** | `App.tsx` Welcome Hub <-> Arena Flow & `AgentHud` Integration | R1–R3 | 5 (`T1-F16-01..05`) | 5 (`T2-F16-01..05`) | ✓ | ✓ | 10+ |
| **Totals** | **All 16 Features (`F1`–`F16`)** | **R1–R3** | **80** | **80** | **18** | **10** | **188** |

---

## 3. Category-Partition Equivalence Classes, BVA & Tier 1 / Tier 2 Specifications

### F1: Shared Types & Contracts
- **Partitions**:
  - `GameMode`: `{ '1v1', 'ffa', 'pvp_ai', 'pvp', 'solo', 'spectator' }` vs invalid string
  - `LocationMode`: `{ 'standard', 'big_cities', 'mountain_regions' }` vs invalid string
  - `PublicGameState` shape: `{ roomCode, hostPlayerId, humans[], human, agents[], locationMode, bettingEnabled, startingChips, mcpStatus }`
  - `AgentGameState` shape: `{ locationMode, bettingEnabled, chips, currentWager }` + zero target leakage during active round
  - `RoundSummary` & `LeaderboardEntry` betting fields: `{ wager, chipDelta, chipsAfter }` / `{ chips, netChips }`
- **Tier 1 (Functional)**:
  - `T1-F01-01`: Start match for each of the 6 `GameMode` values; verify `PublicGameState.mode` echoes the exact enum.
  - `T1-F01-02`: Start match for each of the 3 `LocationMode` values; verify `PublicGameState.locationMode` echoes exact enum.
  - `T1-F01-03`: Verify `PublicGameState` exposes `roomCode` (non-empty string), `hostPlayerId`, `humans` array, `bettingEnabled` (boolean), `startingChips` (number), and `mcpStatus` object with all 8 fields (`connected`, `status`, `httpBridgeReachable`, `activeAgentSockets`, `activeMcpAgents`, `transports`, `lastActivityAt`, `agyAvailable`).
  - `T1-F01-04`: Connect MCP agent and call `get_game_state`; verify `AgentGameState` includes `locationMode`, `bettingEnabled`, `chips`, `currentWager`, and strictly omits `target` / keeps `roundSummary === null` while active.
  - `T1-F01-05`: Complete a round with `bettingEnabled: true`; verify `RoundSummary.results[]` includes `wager`, `chipDelta`, `chipsAfter` and `GET /api/leaderboard` entries include `chips` and `netChips`.
- **Tier 2 (BVA & Negative)**:
  - `T2-F01-01`: `POST /api/match/new` with invalid `mode: 'battle_royale'` -> HTTP 400 validation error.
  - `T2-F01-02`: `POST /api/match/new` with invalid `locationMode: 'desert_only'` -> HTTP 400 validation error.
  - `T2-F01-03`: `PublicGameState.human` and `AgentGameState` during active round -> assert serialized JSON does not contain target `latitude`/`longitude` of `currentRound`.
  - `T2-F01-04`: `RoundSummary` with `bettingEnabled: false` -> `chips`/`chipDelta` remain null/undefined or unchanged without negative chip corruption.
  - `T2-F01-05`: `GET /api/health` & `PublicGameState` secret-redaction scan -> `assertNoSecretLeak()` passes; no `.env` raw keys leaked.

### F2: MCP `submit_guess` Wager & Rules
- **Partitions**:
  - `submit_guess` `wager`: omitted (`undefined`), `0` (min), positive integer (`1..chips`), `> chips` (over-budget), negative (`-1`), non-integer float (`10.5`).
  - `game://rules` resource content: contains scoring formula + betting/wager instructions.
- **Tier 1 (Functional)**:
  - `T1-F02-01`: Read `game://rules` via `stdio`, `streamable-http`, and `sse`; verify it contains `5000 * exp(-distance_km / 2000)` AND chip betting / `wager` documentation.
  - `T1-F02-02`: Call `submit_guess` via MCP with explicit valid `wager: 250` in betting match -> accepted; `agentState.currentWager === 250`.
  - `T1-F02-03`: Call `submit_guess` via MCP with `wager: 0` in betting match -> accepted; `agentState.currentWager === 0`.
  - `T1-F02-04`: Call `submit_guess` via MCP omitting `wager` in betting match -> accepted; deterministic confidence auto-bet sets non-null `wager >= 0` (`currentWager` or settled `RoundPlayerScore.wager`).
  - `T1-F02-05`: Call `submit_guess` via MCP with `agent_id` override AND `wager` -> routes to target agent and records wager on that agent only.
- **Tier 2 (BVA & Negative)**:
  - `T2-F02-01`: `submit_guess` with `wager: -1` (min - 1) -> MCP tool / Zod error rejected, guess not locked.
  - `T2-F02-02`: `submit_guess` with `wager: 10.5` (non-integer) -> rejected by schema validation.
  - `T2-F02-03`: `submit_guess` with `wager: 999999` (`> chips`) -> either rejected with 400/error OR strictly capped to available `chips` (`settled wager <= pre-round chips`, `chipsAfter >= 0`).
  - `T2-F02-04`: `submit_guess` with boundary coordinates `latitude: -90, longitude: -180` and `latitude: 90, longitude: 180` -> accepted; `latitude: 90.0001` or `longitude: -180.0001` -> rejected.
  - `T2-F02-05`: Duplicate `submit_guess` in same round -> rejected (`already submitted`), original coordinates and wager preserved.

### F3: MCP Bridge Heartbeat & Transport Tracking
- **Partitions**:
  - Transports: `stdio`, `streamable-http` (`/mcp`), `sse` (`/sse`), HTTP bridge `/health`.
  - Lifecycle: bridge startup heartbeat, active session count, graceful disconnect / `DELETE /mcp`.
- **Tier 1 (Functional)**:
  - `T1-F03-01`: Start HTTP MCP server on `3102` pointing to `3101`; `GET /health` returns `{ status: 'ok', transports: ['streamable-http', 'sse'] }`.
  - `T1-F03-02`: After HTTP MCP startup (even with 0 AI clients), backend `GET /api/mcp/status` detects `httpBridgeReachable: true` and `status` is `'bridge_ready'` or `'connected'`.
  - `T1-F03-03`: Connect `stdio` MCP client; verify `PublicGameState.agents[i].transport === 'stdio'` and `mcpStatus.transports` includes `'stdio'`.
  - `T1-F03-04`: Connect `streamable-http` (`/mcp`) client; verify `transport === 'streamable-http'`, `Mcp-Session-Id` present, and `mcpStatus.transports` includes `'streamable-http'`.
  - `T1-F03-05`: Connect `sse` (`/sse`) client; verify `transport === 'sse'` and `mcpStatus.transports` includes `'sse'`.
- **Tier 2 (BVA & Negative)**:
  - `T2-F03-01`: Terminate `streamable-http` session (`DELETE /mcp`) and close `sse` & `stdio` clients; verify `activeMcpAgents` drops to `0` and status transitions back to `'bridge_ready'`.
  - `T2-F03-02`: Stop HTTP MCP server process (`3102`); verify backend `GET /api/mcp/status` reports `httpBridgeReachable: false` and `status: 'offline'` (when no stdio/agent sockets remain).
  - `T2-F03-03`: `POST /api/mcp/heartbeat` with empty body `{}` or missing `transport` -> handles gracefully (400 or safe default without crashing backend).
  - `T2-F03-04`: `POST /mcp` without `Mcp-Session-Id` and non-initialize payload -> HTTP 400 JSON-RPC error `-32000`.
  - `T2-F03-05`: `POST /mcp` or `POST /messages` with unknown `sessionId` -> HTTP 404.

### F4: Region-Tagged Location Catalog & Mountain Expansion
- **Partitions**:
  - `LocationMode`: `'standard'`, `'big_cities'`, `'mountain_regions'`
  - Round counts: `1` (min), `3`, `5`, `10` (max)
- **Tier 1 (Functional)**:
  - `T1-F04-01`: Start 10-round match in `mountain_regions` (`provider: 'open'`); force-end and advance through all 10 rounds; verify every round target is a mountain/alpine location.
  - `T1-F04-02`: In the 10-round `mountain_regions` match above, verify all 10 `target.name` (or `city`) values are **100% unique** (zero repeats across 10 rounds -> proves `>=10` mountain locations exist).
  - `T1-F04-03`: Start 5-round match in `big_cities` (`provider: 'open'`); advance all 5 rounds; verify all 5 targets are city/urban catalog locations (excluding pure mountain valleys like Lauterbrunnen).
  - `T1-F04-04`: Start 10-round match in `standard` (`provider: 'open'`); verify targets are valid, distinct across rounds, and cover the full catalog.
  - `T1-F04-05`: For mountain locations, fetch `equirectangular.jpg` and MCP `look_around` JPEG; verify valid JPEG headers (`0xFF 0xD8 0xFF`, size > 5 KB) and valid `availableMoves` road graph links.
- **Tier 2 (BVA & Negative)**:
  - `T2-F04-01`: Boundary `totalRounds: 1` (min) in `mountain_regions` -> starts 1-round match, completes cleanly to `finished` after R1.
  - `T2-F04-02`: Boundary `totalRounds: 10` (max) in `mountain_regions` -> 10 unique mountain targets without index overflow.
  - `T2-F04-03`: `totalRounds: 0` (min - 1) -> rejected with HTTP 400.
  - `T2-F04-04`: `totalRounds: 11` (max + 1) -> rejected with HTTP 400.
  - `T2-F04-05`: Request equirectangular JPEG for expired `roundId` or non-existent `nodeId` -> returns safe fallback or HTTP 400/404 without server crash.

### F5: Mountain Mapillary Seeds & Strict Pool Filtering
- **Partitions**:
  - Provider choice: `'open'`, `'auto'`, `'wikimedia'`, `'mapillary'`, `'google'` (unconfigured external providers fall back cleanly to `'open'` without leaking across region pools).
  - Pool isolation across `LocationMode` and match resets.
- **Tier 1 (Functional)**:
  - `T1-F05-01`: Start `mountain_regions` match with `provider: 'auto'` (no external tokens); verify fallback uses `open-procedural-360` AND still enforces `mountain_regions` catalog pool.
  - `T1-F05-02`: Start `big_cities` match with `provider: 'auto'`; verify fallback uses `big_cities` catalog pool.
  - `T1-F05-03`: Start `mountain_regions` match with `provider: 'wikimedia'` (offline/fallback); verify `activeLocationProvider` reflects wikimedia/open fallback and target remains in mountain category.
  - `T1-F05-04`: Start `standard` match with `provider: 'open'`; verify `activeLocationProvider === 'open-procedural-360'` and all rounds build valid scenes.
  - `T1-F05-05`: Switch `locationMode` mid-session via new match (`mountain_regions` -> `big_cities`); verify previous match's used location pool does not leak into the new match.
- **Tier 2 (BVA & Negative)**:
  - `T2-F05-01`: Request `provider: 'mapillary'` when `MAPILLARY_ACCESS_TOKEN` is unset -> gracefully resolves to `'open-procedural-360'` without error, honoring `locationMode`.
  - `T2-F05-02`: Request `provider: 'google'` when `GOOGLE_MAPS_API_KEY` is unset -> gracefully resolves to `'open-procedural-360'` without error, honoring `locationMode`.
  - `T2-F05-03`: Invalid `provider: 'bing_streetside'` -> HTTP 400 validation error.
  - `T2-F05-04`: Rapidly start 5 sequential `mountain_regions` matches; verify `usedMapillarySeedIds` / location pool resets cleanly per match.
  - `T2-F05-05`: Verify `GET /api/health` when tokens unset reports `mapillary: false, google: false, open: true` and `mapillaryAccessToken: null`.

### F6: Multi-Room & Multi-Human WS Sync
- **Partitions**:
  - Room lifecycle: create (`lobby` vs `autoStart`), join (`valid code` vs `invalid`), start (`host` vs `non-host`), leave.
  - Per-tab `playerId`: default `'human'`, custom `playerId` A & B in same room, separate `roomCode` R1 & R2 isolation.
- **Tier 1 (Functional)**:
  - `T1-F06-01`: `POST /api/rooms` creates room in `'lobby'` with generated `roomCode` and `hostPlayerId`; `humans` contains host with `isHost: true`.
  - `T1-F06-02`: Second player joins via `POST /api/rooms/:code/join` with `{ playerId: 'p2', playerName: 'Bob' }`; both `GET /api/match?roomCode=...&playerId=p1` and `playerId=p2` show `humans.length === 2` with personalized `state.human.id`.
  - `T1-F06-03`: Connect two UI WebSockets (`playerId=p1`, `playerId=p2`) to same `roomCode`; host calls `POST /api/rooms/:code/start`; both sockets receive `state_sync` transitioning `'lobby' -> 'active'` and each sees its own `state.human.id`.
  - `T1-F06-04`: Create Room A and Room B simultaneously; submit guess in Room A -> Room B WS receives zero `round_ended` or `state_sync` cross-talk.
  - `T1-F06-05`: Player 2 calls `POST /api/rooms/:code/leave`; verify Player 2 is marked `connected: false` or removed and Player 1's `state_sync` updates accordingly.
- **Tier 2 (BVA & Negative)**:
  - `T2-F06-01`: `POST /api/rooms/NOPE99/join` with unknown `roomCode` -> HTTP 404.
  - `T2-F06-02`: Non-host player (`p2`) calls `POST /api/rooms/:code/start` -> rejected (HTTP 403/400/409).
  - `T2-F06-03`: `POST /api/rooms/:code/join` with empty `playerName: ""` or `> 40` chars -> HTTP 400 validation error.
  - `T2-F06-04`: Re-joining same `roomCode` with same `playerId` -> idempotently restores player without duplicating entry in `humans[]`.
  - `T2-F06-05`: Backwards-compatible `GET /api/match` without `roomCode` or `playerId` -> returns valid default room state without crashing.

### F7: 5 Matchup Modes Enforcement
- **Partitions**:
  - `1v1` (1 human + max 1 AI), `ffa` (1 human + multi AI), `pvp_ai` (multi-human + AI), `pvp` (multi-human, no AI), `solo` (1 human, no AI), `spectator` (AI-only, no human guess).
- **Tier 1 (Functional)**:
  - `T1-F07-01`: `solo` mode -> human submits guess alone -> `roundStatus` immediately transitions to `'round_over'`.
  - `T1-F07-02`: `1v1` mode -> 1st MCP agent connects (succeeds); human + 1st agent guess -> round ends.
  - `T1-F07-03`: `pvp` mode -> 2 humans in room; H1 guesses -> round stays `'active'`; H2 guesses -> round immediately becomes `'round_over'`.
  - `T1-F07-04`: `pvp_ai` mode -> 2 humans + 1 MCP agent; H1 + H2 guess -> stays `'active'` waiting for AI; AI submits guess -> `'round_over'`.
  - `T1-F07-05`: `spectator` mode -> 2 MCP agents connect; both submit guesses with ZERO human guess -> `roundStatus` automatically transitions to `'round_over'` (`endedReason: 'all_guessed'`).
- **Tier 2 (BVA & Negative)**:
  - `T2-F07-01`: `1v1` mode -> 2nd MCP agent attempts `POST /api/agents/register` -> rejected with HTTP 409.
  - `T2-F07-02`: `solo` mode -> MCP agent attempts to register -> rejected (HTTP 409/400) so solo remains human-only.
  - `T2-F07-03`: `pvp` mode -> MCP agent attempts to register -> rejected (HTTP 409/400) so PvP remains human-only.
  - `T2-F07-04`: `spectator` mode -> human calls `POST /api/human/guess` -> rejected (HTTP 400/409) because spectator has no human guessing.
  - `T2-F07-05`: `pvp_ai` / `spectator` with 1 agent disconnecting mid-round after remaining agents guessed -> round completion triggers `'round_over'` without deadlock.

### F8: Confidence Chip Betting & Settlement
- **Partitions**:
  - `bettingEnabled`: `false` vs `true`; `startingChips`: default `1000`, custom `startingChips`.
  - `wager`: `0`, `1..chips`, `chips` (all-in), omitted on AI (confidence auto-betting).
- **Tier 1 (Functional)**:
  - `T1-F08-01`: Start match with `bettingEnabled: true` -> all humans & registered AI agents initialize with `chips === 1000` (`startingChips`).
  - `T1-F08-02`: Human wagers `200` and guesses accurately (beats AI who wagered `100` and guessed far away) -> round settlement produces positive `chipDelta` for winner, negative `chipDelta` for loser, `chipsAfter === chipsBefore + chipDelta`.
  - `T1-F08-03`: AI agent omits `wager` in `submit_guess` -> deterministic confidence auto-betting assigns `wager` in `[0, agent.chips]` and settles `chipDelta` and `chipsAfter`.
  - `T1-F08-04`: Multi-round chip carryover: Round 1 `chipsAfter` becomes Round 2 starting `chips` for every player, and `FinalLeaderboardEntry.chips` / `netChips` matches cumulative `sum(chipDelta)`.
  - `T1-F08-05`: Tied score / equal-distance guesses in betting round -> deterministic fair tie settlement without fractional NaN or negative balance corruption.
- **Tier 2 (BVA & Negative)**:
  - `T2-F08-01`: Human submits `wager: -1` (min - 1) -> HTTP 400 rejected.
  - `T2-F08-02`: Human submits `wager: 1001` (`startingChips + 1`) -> rejected with HTTP 400 (or strictly capped/rejected over-balance wager).
  - `T2-F08-03`: Human goes all-in (`wager === chips`) and loses -> `chipsAfter === 0` (floor at 0, never negative); in Round 2, max allowed wager is `0` (`0` wager still allowed).
  - `T2-F08-04`: `bettingEnabled: false` -> submitting non-zero `wager` ignored/rejected without altering chip totals; `roundSummary` does not award chip payouts.
  - `T2-F08-05`: `startingChips: 0` or negative in `POST /api/match/new` -> rejected by validation.

### F9: Atomic Pre-Match Setup & Return Home Reset
- **Partitions**:
  - Match config fields: `humanName`, `selectedModels`, `totalRounds`, `roundDurationSec`, `maxStepsPerRound`, `provider`, `locationMode`, `bettingEnabled`.
  - Return Home cleanup: `POST /api/rooms/:code/leave` / `POST /api/agy/stop`.
- **Tier 1 (Functional)**:
  - `T1-F09-01`: `POST /api/match/new` atomically applies all fields (`mode`, `locationMode`, `bettingEnabled`, `totalRounds: 3`, `roundDurationSec: 60`, `provider: 'open'`, `humanName: 'ExplorerOne'`, `selectedModels`, `maxStepsPerRound: 4`, `timeoutSec: 90`) in one call; both `/api/match` and `/api/agy/status` reflect exact config.
  - `T1-F09-02`: `POST /api/rooms` with `autoStart: true` atomically creates room and starts active Round 1 with all setup fields applied.
  - `T1-F09-03`: Timed match (`roundDurationSec: 10`) ticks down via WS `timer_tick` and automatically ends round with `endedReason: 'timeout'` at `0`.
  - `T1-F09-04`: `maxStepsPerRound: 2` applied via setup -> MCP agent makes 2 exploration calls (`look_around` + `pan_and_zoom`), 3rd exploration call is rejected with step-limit error telling agent to call `submit_guess`.
  - `T1-F09-05`: Leaving/returning home (`POST /api/rooms/:code/leave` or `POST /api/agy/stop`) leaves server clean so starting a subsequent match resets scores, chips, round=1, and `completedRounds=[]`.
- **Tier 2 (BVA & Negative)**:
  - `T2-F09-01`: `humanName: ""` (empty) or `"   "` (whitespace) -> HTTP 400 or sanitized non-empty fallback; `humanName` length 40 (max) accepted, 41 (max+1) -> HTTP 400.
  - `T2-F09-02`: `roundDurationSec: 9` (min-1) and `901` (max+1) -> HTTP 400; `roundDurationSec: 10` (min) and `null` (unlimited) -> accepted.
  - `T2-F09-03`: `maxStepsPerRound: 1` (min-1) and `21` (max+1) -> HTTP 400; `2` (min) and `20` (max) -> accepted.
  - `T2-F09-04`: `timeoutSec: 29` (min-1) and `301` (max+1) -> HTTP 400; `30` (min) and `300` (max) -> accepted.
  - `T2-F09-05`: `POST /api/match/next-round` called when match is already `'finished'` -> idempotently stays `'finished'` without advancing to Round `totalRounds + 1`.

### F10: Backend Live MCP Telemetry
- **Partitions**:
  - `McpStatusInfo.status`: `'offline'` vs `'bridge_ready'` vs `'connected'`.
  - Signal sources: WS `role=agent` socket, HTTP bridge health probe, recent `POST /api/mcp/heartbeat`.
- **Tier 1 (Functional)**:
  - `T1-F10-01`: With MCP bridge stopped and 0 agents -> `GET /api/mcp/status` returns `{ connected: false, status: 'offline', httpBridgeReachable: false, activeMcpAgents: 0 }`.
  - `T1-F10-02`: With MCP HTTP bridge running (`3102`) and 0 agents -> `GET /api/mcp/status` returns `status: 'bridge_ready'` (or `httpBridgeReachable: true`).
  - `T1-F10-03`: With active MCP agent connected (`stdio` or `streamable-http`) -> `GET /api/mcp/status` returns `{ connected: true, status: 'connected', activeMcpAgents >= 1 }`, and `PublicGameState.mcpStatus` matches.
  - `T1-F10-04`: `POST /api/mcp/heartbeat` with `{ transport: 'stdio', activeSessions: 1 }` updates `lastActivityAt` (non-null timestamp) and `transports` includes `'stdio'`.
  - `T1-F10-05`: Connect agent -> `mcpStatus.status` is `'connected'`; disconnect agent -> `mcpStatus` updates in `state_sync` / `/api/mcp/status` without restarting backend.
- **Tier 2 (BVA & Negative)**:
  - `T2-F10-01`: `GET /api/mcp/status` responds rapidly (`< 2s`) even when MCP health probe port is unreachable (no hanging request).
  - `T2-F10-02`: `POST /api/mcp/heartbeat` with `activeSessions: -1` -> rejected with HTTP 400 or clamped safely to `>= 0`.
  - `T2-F10-03`: Stale heartbeat recency (`> TTL`) without active sockets/bridge -> decays cleanly out of `'connected'` state.
  - `T2-F10-04`: Multiple simultaneous transports (`stdio` + `sse` + `streamable-http`) -> `transports` array deduplicated and `activeMcpAgents` equals exact live count.
  - `T2-F10-05`: Telemetry payload never contains raw tokens or filesystem secret paths (`assertNoSecretLeak`).

### F11: Tab-Scoped Client Session & Room API/WS Hooks (Browser CDP)
- **Partitions**:
  - `sessionStorage` tab isolation: Tab 1 vs Tab 2 get distinct `playerId`s.
  - Tab reload persistence: reloading Tab 1 retains same `playerId`.
  - WS URL scoping: connects with `roomCode` & `playerId`.
- **Tier 1 (Functional)**:
  - `T1-F11-01`: Open two tabs (Tab A & Tab B) in Browser CDP; inspect `sessionStorage` in both -> distinct `playerId` values generated per tab.
  - `T1-F11-02`: Reload Tab A; verify `sessionStorage` preserves Tab A's `playerId`.
  - `T1-F11-03`: In Tab A create a PvP room; join from Tab B with room code -> Tab B receives room state via WS without overwriting Tab A's `playerId`.
  - `T1-F11-04`: In Tab A submit a guess; verify Tab B's DOM updates via WS `state_sync` (shows Tab A guessed while Tab B still shows map pin prompt).
  - `T1-F11-05`: Verify `sessionStorage` / `localStorage` contains zero secret tokens.
- **Tier 2 (BVA & Negative)**:
  - `T2-F11-01`: Enter invalid/non-existent 6-char room code in Join UI -> displays visible error message and does NOT enter broken arena state.
  - `T2-F11-02`: Enter empty/whitespace room code -> Join action disabled or shows validation feedback.
  - `T2-F11-03`: Corrupt/clear `sessionStorage` `playerId` and reload -> client cleanly regenerates a valid `playerId` without crashing.
  - `T2-F11-04`: Temporarily drop WS or target non-existent room on rejoin -> UI shows reconnecting/error banner cleanly, recovers on valid room/start.
  - `T2-F11-05`: Two tabs creating separate Solo/PvP rooms -> neither tab's `useGameSocket` leaks updates from the other room.

### F12: Two-Step Welcome Hub & Pre-Match Setup UI (Browser CDP)
- **Partitions**:
  - Initial landing (`view === 'home'`): Welcome Hub visible, 360° battle viewport NOT active/obstructing.
  - Step 1: 5 matchup mode cards + Create/Join Room for PvP/PvPvAI.
  - Step 2: Location/region gamemodes, Confidence Betting toggle, Display Name, AI lineup, Rounds (`3/5/10`), Timer, Step Cap, Panorama Provider, Play CTA.
- **Tier 1 (Functional)**:
  - `T1-F12-01`: Load app root `/` -> Welcome Hub is rendered immediately (Step 1 mode cards visible, no active `GuessingMiniMap` or `RoundSummaryOverlay`).
  - `T1-F12-02`: Verify all 5 Step 1 matchup mode cards are selectable (`Player vs AI` with 1v1/FFA, `Player vs Player vs AI`, `Player vs Player`, `Solo Practice`, `AI-Only Spectator Mode`).
  - `T1-F12-03`: Select a mode -> advance to Step 2 -> verify `Standard (All regions)`, `Big Cities Only`, `Mountain Regions Only`, and `Confidence Betting` toggle are selectable.
  - `T1-F12-04`: Configure Display Name (`"Alice"`), Rounds (`3`), Timer, Step Cap, and Provider (`open`) on Home Screen and click **Play** -> enters Arena with `TopHud` showing `Alice`, `1 / 3`, and chosen mode.
  - `T1-F12-05`: Selecting `PvP` or `PvPvAI` exposes Room Create / Join by Room Code flow and waiting lobby before Host clicks Start.
- **Tier 2 (BVA & Negative)**:
  - `T2-F12-01`: Clear Display Name to empty `""` -> Play falls back safely or shows validation without sending invalid `""` error crash.
  - `T2-F12-02`: Rapidly toggle between Step 1 modes (`Solo` -> `Spectator` -> `PvP` -> `Player vs AI`) and back to Step 1 -> no stale room/modal state leaks.
  - `T2-F12-03`: In `Solo` or `PvP`, AI model lineup selector is hidden/disabled while in `Player vs AI` / `Spectator` it allows selecting/deselecting models.
  - `T2-F12-04`: Rapid double-click on **Play** -> guarded by busy/disabled state so only 1 match is created.
  - `T2-F12-05`: Check `Rounds` presets (`3`, `5`, `10`) -> active selection accurately persists across Step 1 <-> Step 2 navigation.

### F13: Betting UI & Settlement Overlays (Browser CDP)
- **Partitions**:
  - `GuessingMiniMap` with `bettingEnabled: true` vs `false`.
  - Wager controls: custom input + presets (`0`, `100`, `250`, `500`, `All-In`).
  - `RoundSummaryOverlay` & `FinalLeaderboardModal`: wager, chip delta (`+`/`-`), chips after, Return Home CTA.
- **Tier 1 (Functional)**:
  - `T1-F13-01`: Start betting match -> `GuessingMiniMap` renders chip stack (`1,000`) and wager selector/presets; start non-betting match -> wager selector hidden.
  - `T1-F13-02`: Click map pin, select wager preset (e.g., `250`), click Submit Guess -> locked guess shows submitted status and backend records `wager: 250`.
  - `T1-F13-03`: Complete round -> `RoundSummaryOverlay` displays wager, chip delta, and resulting chip balance for participants.
  - `T1-F13-04`: Complete final round -> `FinalLeaderboardModal` displays final chip standings / net chips alongside scores.
  - `T1-F13-05`: On `FinalLeaderboardModal`, click **Return Home** -> returns cleanly to Welcome Hub.
- **Tier 2 (BVA & Negative)**:
  - `T2-F13-01`: Attempt to enter negative wager or wager `> currentChips` in UI input -> clamped or submit disabled / validation error shown.
  - `T2-F13-02`: Wager `0` chips -> permitted, shows `0` wager and `0` chip delta on settlement.
  - `T2-F13-03`: All-In wager (`1000`) -> permitted; if chip balance hits `0` in R2, wager presets `> 0` are disabled/clamped to `0`.
  - `T2-F13-04`: Submit button remains disabled before dropping a pin on the Leaflet map even when a wager is selected.
  - `T2-F13-05`: Double-click Submit Guess in betting mode -> prevented by `submitting` guard, no duplicate guess error toast.

### F14: Top HUD Quick Return Home & Live MCP Badge (Browser CDP)
- **Partitions**:
  - Top HUD elements: Quick Return to Home button, Live MCP Status Badge (`offline` / `bridge_ready` / `connected`), chip stack (when betting enabled), room code pill (when multi-player room).
- **Tier 1 (Functional)**:
  - `T1-F14-01`: Enter Arena -> `TopHud` renders **Quick Return to Home** button and **Live MCP Status Badge**.
  - `T1-F14-02`: With MCP HTTP bridge stopped and 0 agents -> badge reflects offline state; start MCP bridge (`3102`) -> badge updates to `bridge_ready` / ready; connect MCP agent -> badge updates to `connected`.
  - `T1-F14-03`: In betting match, `TopHud` displays current chip balance (`1,000` -> updated after R1).
  - `T1-F14-04`: In `PvP` / `PvPvAI` match, `TopHud` displays the room code pill matching the active `roomCode`.
  - `T1-F14-05`: Click **Quick Return to Home** mid-match -> leaves room/stops active runs and returns immediately to Welcome Hub (`view === 'home'`).
- **Tier 2 (BVA & Negative)**:
  - `T2-F14-01`: Click **Quick Return to Home** during `round_over` summary overlay -> cleanly dismisses overlay and returns to Welcome Hub.
  - `T2-F14-02`: Click **Quick Return to Home** during `matchStatus === 'finished'` -> cleans up leaderboard modal and returns to Welcome Hub.
  - `T2-F14-03`: Return Home -> start a completely new match in a different mode (`spectator` -> `solo`) -> Top HUD mode badge, round counter, and chip display reset cleanly.
  - `T2-F14-04`: Disconnect all MCP agents while watching Arena -> Live MCP badge transitions from `connected` back to `bridge_ready` / `offline` without page reload.
  - `T2-F14-05`: Responsive narrow viewport (`390x844` mobile / `1024x768`) -> Quick Return Home button and Live MCP badge remain visible and clickable (not clipped off-screen).

### F15: AI-Only Spectator Mode Multi-POV Stage (Browser CDP + MCP)
- **Partitions**:
  - `SpectatorStage` vs `PanoramaViewer` + `GuessingMiniMap`.
  - Live POV cards: Gemini / Claude / GPT-OSS / connected MCP agents, `/api/agents/:id/viewport.jpg`, heading, step budget, status, reasoning, wagers.
- **Tier 1 (Functional)**:
  - `T1-F15-01`: Launch `spectator` mode -> `SpectatorStage` is mounted, while human `GuessingMiniMap` is NOT rendered.
  - `T1-F15-02`: Connect 2+ live MCP agents in `spectator` mode -> `SpectatorStage` renders a live POV card for each agent with valid loaded `<img>` (`/api/agents/:id/viewport.jpg`).
  - `T1-F15-03`: Call `pan_and_zoom` & `move` from MCP agent -> `SpectatorStage` card updates heading/step count and `frameVersion` query on POV `<img>` refreshes.
  - `T1-F15-04`: All MCP agents call `submit_guess` (with reasoning + optional wager) -> round automatically ends and `RoundSummaryOverlay` appears with zero human input.
  - `T1-F15-05`: Click Next Round on `RoundSummaryOverlay` in `spectator` mode -> advances to Round 2 with reset agent POVs and step counters.
- **Tier 2 (BVA & Negative)**:
  - `T2-F15-01`: `spectator` mode with 0 connected agents -> `SpectatorStage` renders clear waiting/empty state without crashing.
  - `T2-F15-02`: `spectator` mode with 1 agent disconnecting before guessing while remaining agents have guessed -> round still completes cleanly.
  - `T2-F15-03`: Direct `GET /api/agents/nonexistent/viewport.jpg` -> returns HTTP 404 (not 500).
  - `T2-F15-04`: Spectator clicking Return Home mid-round -> cleanly exits `SpectatorStage`, stops any active runs, returns to Welcome Hub.
  - `T2-F15-05`: `spectator` mode with `bettingEnabled: true` -> displays AI agent wagers and settles AI chip payouts on `RoundSummaryOverlay` without expecting a human wager.

### F16: `App.tsx` Welcome Hub <-> Arena Flow & `AgentHud` Integration (Browser CDP)
- **Partitions**:
  - Mode-aware HUD visibility: `solo`/`pvp` hide AI summon/`AgentHud` controls; `1v1`/`ffa`/`pvp_ai` show `AgentHud` + `PanoramaViewer` + `GuessingMiniMap`; `spectator` shows `SpectatorStage`.
  - Round-trip Welcome Hub <-> Arena transitions.
- **Tier 1 (Functional)**:
  - `T1-F16-01`: Start `solo` mode -> `AgentHud` / AI Summon controls are hidden, `PanoramaViewer` & `GuessingMiniMap` are active.
  - `T1-F16-02`: Start `pvp` mode -> `AgentHud` / AI Summon controls are hidden, room code and human roster/status visible.
  - `T1-F16-03`: Start `ffa` (or `pvp_ai`) mode -> `AgentHud` is visible alongside `PanoramaViewer` & `GuessingMiniMap`, and live MCP activity events appear in `AgentHud` feed.
  - `T1-F16-04`: Complete 1 full cycle: Welcome Hub -> Arena -> Return Home -> Welcome Hub -> second Arena match with different mode -> all components mount/unmount cleanly with zero uncaught console/page errors.
  - `T1-F16-05`: Verify `AgentHud` **Connect** modal opens and closes cleanly, and snippets never leak any `.env` secret tokens.
- **Tier 2 (BVA & Negative)**:
  - `T2-F16-01`: Browser console error & `pageerror` listener across full Welcome Hub -> Play -> Guess -> Summary -> Return Home -> 0 uncaught JS exceptions.
  - `T2-F16-02`: Trigger backend error -> error banner renders and dismiss (`✕`) button clears it.
  - `T2-F16-03`: Minimize and expand `AgentHud` during active `ffa` match -> toggles cleanly without losing live agent list.
  - `T2-F16-04`: `RoundSummaryOverlay` -> click Next Round on final round -> transitions to `FinalLeaderboardModal`, never skips leaderboard.
  - `T2-F16-05`: `FinalLeaderboardModal` -> click **Play Again** -> starts fresh match (R1) with same settings and reset scores/chips.

---

## 4. Tier 3 — Pairwise Combinatorial Matrix (18 Cases)

**Factors & Levels**:
- **Mode** (6): `1v1`, `ffa`, `pvp_ai`, `pvp`, `solo`, `spectator`
- **Location** (3): `standard`, `big_cities`, `mountain_regions`
- **Betting** (2): `off` (`false`), `on` (`true`)
- **Rounds** (3): `3`, `5`, `10`
- **Timer** (2): `none` (`null`), `timed` (`10s` / `60s`)
- **Provider** (3): `open`, `auto`, `wikimedia`
- **MCP Transport** (4): `none`, `stdio`, `streamable-http`, `sse`

| Case ID | Mode | Location | Betting | Rounds | Timer | Provider | MCP Transport | Key Pairwise Oracle |
|---|---|---|---|---|---|---|---|---|
| `T3-PW-01` | `1v1` | `standard` | `on` | `5` | `timed` | `open` | `stdio` | 1v1 + stdio wager + standard + 5R + timed |
| `T3-PW-02` | `1v1` | `big_cities` | `on` | `10` | `none` | `auto` | `streamable-http` | 1v1 + big_cities + on + 10R + streamable |
| `T3-PW-03` | `1v1` | `mountain_regions` | `off` | `3` | `none` | `wikimedia` | `sse` | 1v1 + mountain + off + 3R + sse |
| `T3-PW-04` | `ffa` | `standard` | `on` | `3` | `timed` | `wikimedia` | `streamable-http` | ffa + standard + on + 3R + timed + streamable |
| `T3-PW-05` | `ffa` | `big_cities` | `off` | `10` | `timed` | `open` | `sse` | ffa + big_cities + off + 10R + timed + sse |
| `T3-PW-06` | `ffa` | `mountain_regions` | `on` | `5` | `none` | `auto` | `stdio` | ffa + mountain + on + 5R + stdio |
| `T3-PW-07` | `pvp_ai` | `standard` | `off` | `5` | `none` | `auto` | `sse` | pvp_ai (2H+AI) + standard + off + 5R + sse |
| `T3-PW-08` | `pvp_ai` | `big_cities` | `off` | `3` | `timed` | `wikimedia` | `stdio` | pvp_ai (2H+AI) + big_cities + off + 3R + timed + stdio |
| `T3-PW-09` | `pvp_ai` | `mountain_regions` | `on` | `10` | `timed` | `open` | `streamable-http` | pvp_ai (2H+AI) + mountain + on + 10R + timed + streamable |
| `T3-PW-10` | `pvp` | `standard` | `off` | `10` | `timed` | `open` | `none` | pvp (2H, 0 AI) + standard + off + 10R + timed |
| `T3-PW-11` | `pvp` | `big_cities` | `on` | `3` | `none` | `auto` | `none` | pvp (2H, 0 AI) + big_cities + on + 3R |
| `T3-PW-12` | `pvp` | `mountain_regions` | `on` | `5` | `none` | `wikimedia` | `none` | pvp (2H, 0 AI) + mountain + on + 5R |
| `T3-PW-13` | `solo` | `standard` | `on` | `10` | `none` | `wikimedia` | `none` | solo + standard + on + 10R |
| `T3-PW-14` | `solo` | `big_cities` | `off` | `5` | `timed` | `open` | `none` | solo + big_cities + off + 5R + timed |
| `T3-PW-15` | `solo` | `mountain_regions` | `off` | `3` | `none` | `auto` | `none` | solo + mountain + off + 3R |
| `T3-PW-16` | `spectator` | `standard` | `on` | `10` | `timed` | `auto` | `stdio` | spectator + standard + on + 10R + timed + stdio |
| `T3-PW-17` | `spectator` | `big_cities` | `off` | `5` | `timed` | `wikimedia` | `streamable-http` | spectator + big_cities + off + 5R + timed + streamable |
| `T3-PW-18` | `spectator` | `mountain_regions` | `on` | `3` | `none` | `open` | `sse` | spectator + mountain + on + 3R + sse |

---

## 5. Tier 4 — Real-World Application Scenarios (10 Scenarios)

| Scenario ID | Scenario Name | Interfaces Exercised | Steps & End-to-End Oracle |
|---|---|---|---|
| `T4-SCN-01` | **Welcome Hub -> Solo Play -> Multi-Round -> Final Settlement -> Return Home** | Browser CDP + REST + WS | Open `/` -> assert Welcome Hub (no active minimap) -> Step 1: Solo Practice -> Step 2: Standard, 3 rounds, Display Name `"SoloTraveler"`, `open` -> Play -> complete R1–R3 via map pin + Submit Guess -> inspect `RoundSummaryOverlay` & `FinalLeaderboardModal` -> click Return Home -> assert back on Welcome Hub. |
| `T4-SCN-02` | **Multi-Tab PvP Room-Code Sync over WebSocket** | 2 Browser CDP Tabs + WS + REST | Tab 1 selects Player vs Player + Create Room -> displays `roomCode` in lobby -> Tab 2 opens app, enters `roomCode` + name `"PlayerTwo"`, joins -> both tabs show 2 humans -> Host (Tab 1) clicks Start -> both tabs enter R1 -> Tab 1 moves/guesses -> Tab 2 sees live status -> Tab 2 guesses -> both tabs receive `round_ended` simultaneously. |
| `T4-SCN-03` | **Multi-Tab PvPvAI with Live MCP Client (`streamable-http`)** | 2 Browser CDP Tabs + Streamable HTTP MCP + WS | Tab 1 creates `pvp_ai` room -> Tab 2 joins -> Host starts -> Streamable HTTP MCP agent connects, calls `look_around`, `pan_and_zoom`, `move`, and `submit_guess` with `reasoning` -> Tab 1 & Tab 2 both guess -> round ends with 3 entries (2 humans + 1 AI) and AI deduction shown on both tabs. |
| `T4-SCN-04` | **AI-Only Spectator Mode with 3 Live MCP Clients** | Browser CDP + `stdio` + `sse` + `streamable-http` | Select AI-Only Spectator Mode on Welcome Hub -> Play -> connect 3 MCP clients (Gemini/Claude/GPT-OSS identities) -> assert `SpectatorStage` renders 3 live POV cards (`/api/agents/:id/viewport.jpg` valid JPEG), no human `GuessingMiniMap` -> each AI calls `look_around` + `pan_and_zoom` + `submit_guess` -> round auto-completes without human input -> `RoundSummaryOverlay` shows all 3 AI scores & deductions. |
| `T4-SCN-05` | **Mountain Regions Only 10-Round Endurance** | REST + MCP + Browser CDP | Configure `mountain_regions`, `10` rounds, `open` -> play/advance through all 10 rounds -> assert 10/10 targets are mountain locations with 0 duplicate locations -> complete match to `FinalLeaderboardModal` (`10` round badges). |
| `T4-SCN-06` | **Big Cities Only vs Standard Region Filtering** | REST + Browser CDP | Run 5-round `big_cities` match -> assert 5/5 targets belong to big-city pool (zero mountain-only valleys); run 10-round `standard` match -> assert full-catalog availability. |
| `T4-SCN-07` | **Confidence Betting Mode Full Match (`wager` + Auto-Betting)** | Browser CDP + MCP + REST | Enable Confidence Betting (`startingChips: 1000`) -> Human wagers `300` via UI -> AI-1 submits `submit_guess` with explicit `wager: 400` -> AI-2 submits `submit_guess` omitting `wager` (auto-betting) -> verify `RoundSummaryOverlay` shows `wager`, `chipDelta`, `chipsAfter`, R2 carries updated chips, `FinalLeaderboardModal` shows final chip standings. |
| `T4-SCN-08` | **Top HUD Return Home & Live MCP Status Badge Lifecycle** | Browser CDP + MCP Process Lifecycle | Start with MCP bridge offline -> badge shows `offline`; start MCP HTTP server (`3102`) -> badge transitions to `bridge_ready`; connect MCP agent -> badge shows `connected`; disconnect agent -> drops back to `bridge_ready`; click **Quick Return to Home** -> returns to Welcome Hub & cleans up room. |
| `T4-SCN-09` | **Pre-Match Setup Propagation (Timer, Step Cap, Name, Lineup)** | Browser CDP + REST + MCP | On Welcome Hub Step 2 set Display Name `"AlpineAce"`, Rounds `3`, Timer `10s`/`60s`, Step Cap `3`, AI models, Provider `open` -> Play -> verify Top HUD name/rounds/timer, verify MCP agent hits step cap at call 4, verify timed round auto-ends at `0` with `endedReason: 'timeout'`. |
| `T4-SCN-10` | **Mid-Match Reconnect, Resilience & Zero Secret Leak Audit** | 2 Browser CDP Tabs + WS + Audit | Reload Tab 2 mid-match -> `sessionStorage` `playerId` persists and rejoins cleanly; non-host attempting host-only action gets graceful error; run `assertNoSecretLeak()` across all API responses, WS frames, DOM text, and stdout -> 0 leaks, 0 uncaught browser errors. |

---

## 6. Test Architecture & CLI Runner Semantics

### Module Layout
- `scripts/verify-e2e.mjs` — CLI entrypoint & orchestrator (`node scripts/verify-e2e.mjs [flags]`).
- `scripts/e2e/harness.mjs` — Port constants (`BACKEND_PORT = 3101`, `MCP_HTTP_PORT = 3102`, `FORBIDDEN_PORTS = [5173, 3001]`, `LIVE_UI_URL = 'http://localhost:5173'`), isolated server spawner/cleanup, HTTP/WS/MCP (`stdio`/`streamable-http`/`sse`) opaque-box clients, `assertNoSecretLeak()`, `scrubSecrets()`, suite registry & reporter.
- `scripts/e2e/browser.mjs` — Pure-Node headless Chrome/Edge DevTools Protocol (CDP) driver using `globalThis.WebSocket` (with `ws` fallback) + `fetch` and isolated temp `--user-data-dir` (plus optional Playwright fallback if no Edge/Chrome binary is present).
- `scripts/e2e/tier1_features.mjs` — Tier 1 functional cases (`>=80`, `>=5` per feature `F1`–`F16`).
- `scripts/e2e/tier2_boundaries.mjs` — Tier 2 BVA & negative cases (`>=80`, `>=5` per feature `F1`–`F16`).
- `scripts/e2e/tier3_pairwise.mjs` — Tier 3 pairwise combinatorial cases (`>=16`, `18` defined).
- `scripts/e2e/tier4_scenarios.mjs` — Tier 4 real-world E2E + CDP browser scenarios (`>=8`, `10` defined).

### CLI Flags & Semantics (`node scripts/verify-e2e.mjs [flags]`)

| Flag | Behavior |
|---|---|
| *(no flags)* | Starts isolated backend (`3101`) + MCP HTTP/SSE (`3102`), runs discovered tiers (`--with-browser` auto-enabled if Edge/Chrome binary is detected, or controlled via `--with-browser` / `--no-browser`), prints summary, shuts down `3101`/`3102`. |
| `--help`, `-h` | Prints CLI usage and exits `0`. |
| `--tier <1\|2\|3\|4\|all>` | Filters execution to selected tier(s) (comma-separated or repeated) or `all` (default `all`). Fails exit `1` if an explicitly requested tier file is missing. |
| `--feature <F1..F16>` | Filters cases matching feature ID(s) (e.g. `F1` or `F1,F6`). |
| `--filter <pattern>` | Case-insensitive substring or `/regex/` filter on `id`, `title`, or `featureIds`. Regex defaults to `'i'` when no flags are provided; any `g` flag is stripped to prevent stateful `lastIndex` bugs. Malformed `/regex/` syntax or invalid flags fail in `parseArgs` with exit `2`. |
| `--list` | Lists matching test cases (`[Tier N] <id> (<kind>) [<features>] — <title>`) and per-tier / per-feature counts; exits `0` without starting servers or requiring `dist/` (still enforces `--require-all-tiers` if passed). |
| `--syntax-only` | Imports `harness.mjs`, `browser.mjs`, and discovered `tier*.mjs` modules, validates schemas/unique IDs; exits `0` without starting servers or requiring `dist/` (still enforces `--require-all-tiers` if passed). |
| `--dry-run` | Performs `--syntax-only` validation, checks `checkBuildArtifacts()` status (warning if unbuilt unless `--require-build` is set), and prints execution plan; exits `0` (or `1` if `--require-build` / `--require-all-tiers` fails). |
| `--with-browser` | Forces headless CDP browser checks; fails if no Edge/Chrome executable (or Playwright fallback) is available. |
| `--no-browser` | Skips `browser` cases cleanly with status `'skipped'`. Argument order applies with `--live-ui` / `--live-ui-url` (whichever comes last determines `withBrowser`). |
| `--live-ui` | Points browser checks at `LIVE_UI_URL` (`http://localhost:5173`), sets `liveUi = true`, and enables `--with-browser` without touching/killing `5173` or `3001`. |
| `--live-ui-url <url>` | Validates URL syntax (exit `2` if invalid), sets `liveUi = true`, overrides `uiUrl`, and enables `--with-browser` (unless overridden by a subsequent `--no-browser`). |
| `--skip-server` | Skips spawning `3101`/`3102`. Exits `0` early if `0` cases match; otherwise probes `${BASE_URL}/api/health` when active (non-skipped) cases include `api`/`ws`/`mcp` or when `!liveUi`, and probes `${MCP_HTTP_URL}/health` when any active case has `requiresMcp` (`r.requiresMcp ?? r.kind === 'mcp'`). |
| `--require-all-tiers` | Fails with exit `1` if any of `tier1_features.mjs`..`tier4_scenarios.mjs` is missing or empty, and enforces `verifyAllTierCoverageInvariants` (`>=5` per `F1..F16` in T1/T2, `>=16` in T3, `>=8` in T4) across `--syntax-only`, `--list`, `--dry-run`, and live runs (conflicts with `--tier <subset>`). |
| `--require-build` | Fails with exit `1` during `--dry-run` if `dist/` build artifacts (`checkBuildArtifacts()`) are missing (`--syntax-only` and `--list` ignore it; live runs without `--skip-server` always require build artifacts). |
| `--json` | Emits secret-scrubbed JSON test summary at the end of execution. |

### Exit Codes
- `0` — All selected tests passed, `0` cases matched in live mode (`[WARN]`), or `--help` / `--list` / `--syntax-only` / `--dry-run` succeeded.
- `1` — One or more test assertions failed, module schema/ID validation failed, `--require-all-tiers` / `--require-build` failed, or unhandled startup/runtime error occurred.
- `2` — Invalid CLI arguments (unknown flag, missing option value, invalid `--tier`, invalid `--feature`, invalid `--live-ui-url`, or malformed `--filter /regex/`).
