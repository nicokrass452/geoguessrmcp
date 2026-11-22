# GeoGuessr MCP Arena

A full-stack **GeoGuessr** web application with an integrated **Model Context Protocol (MCP)** server (`stdio` and `SSE` transports) so external multimodal AI models (Claude, Gemini, GPT, Cursor, Antigravity) can explore street-level 360° panoramas, pan/zoom onto signs, walk road links, and compete against human players in real time.

---

## Architecture

```text
+--------------------------+          WebSocket (/ws) + REST (/api)          +------------------------------+
|   React + Vite Frontend  | <=============================================> |    Express + WS Game Engine  |
|  - Three.js 360° Viewer  |                                                 |  - Authoritative Match/Round |
|  - MapillaryJS (optional)|                                                 |  - Opaque Anti-Leak Node IDs |
|  - Leaflet Guessing Map  |                                                 |  - Server Perspective Engine |
|  - Live Agent POV & Feed |                                                 |    (Equirectangular -> JPEG) |
+--------------------------+                                                 +------------------------------+
                                                                                            ^
                                                                                            | HTTP + WS
                                                                                            v
+--------------------------+          MCP (stdio or multi-client SSE)        +------------------------------+
| External AI Models / IDE | <=============================================> |     Standalone MCP Server    |
| (Claude, Cursor, Gemini) |                                                 |     (@geoguessr-mcp/mcp)     |
+--------------------------+                                                 +------------------------------+
```

---

## Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment (Optional)
Works out of the box with zero API keys using the built-in 360° procedural street renderer.
```bash
cp .env.example .env
```

### 3. Build All Workspaces (`shared`, `web`, `mcp-server`)
```bash
npm run build
```

### 4. Start the Web App & Game Backend
**Development mode (Vite HMR + live-reloading backend):**
```bash
npm run dev
```
Then open **http://localhost:5173** in your browser.

**Production mode (single server serving built frontend + API + WebSockets):**
```bash
npm start
```
Then open **http://localhost:3001** in your browser.

---

## Optional Panorama Providers

Configured via `.env` or the **Match Setup** modal in the UI:

| Provider | Env Variable | Behavior |
|---|---|---|
| `open` (default) | *(none required)* | Built-in 2048×1024 equirectangular 360° street scenes across 12 world cities with multi-node intersections, sun hemisphere cues, driving lanes, landmarks, and legible street signs. |
| `wikimedia` | `ENABLE_WIKIMEDIA_FETCH=true` | Fetches & disk-caches real 360° equirectangular panoramas from Wikimedia Commons (`cache/panoramas/`) with automatic fallback to `open`. |
| `mapillary` | `MAPILLARY_ACCESS_TOKEN=...` | Queries Mapillary Graph API v4 for panoramic street sequences and enables the interactive **MapillaryJS** toggle in the browser UI. |
| `google` | `GOOGLE_MAPS_API_KEY=...` | Uses Google Street View Static API for live agent perspective rendering with automatic fallback. |

---

## Running the MCP Server

### Option A: `stdio` Transport (Claude Desktop, Cursor, Antigravity)
The AI host spawns `mcp-server/dist/index.js` directly:
```bash
node mcp-server/dist/index.js --transport stdio --backend-url http://localhost:3001 --agent-name "Claude 3.7"
```

### Option B: `Streamable HTTP (/mcp)` + Legacy `SSE (/sse)` Bridge (ChatGPT, Remote Antigravity, Multiple Agents)
Start the unified HTTP MCP bridge (default port `3002`, serves **both** `/mcp` Streamable HTTP and `/sse` legacy SSE):
```bash
npm run mcp:http
```
Each connected client gets an isolated `McpServer` + `GameBackendClient` session! Pass `?agentName=...&model=...`:
- **Streamable HTTP (Recommended — Antigravity remote / ChatGPT Developer Mode):** `http://localhost:3002/mcp?agentName=ChatGPT`
- **Legacy SSE:** `http://localhost:3002/sse?agentName=Gemini`

#### Connecting ChatGPT / ChatGPT Work (via HTTPS Tunnel)
Because ChatGPT runs in OpenAI's cloud, expose port `3002` with Cloudflare Tunnel or ngrok:
```bash
cloudflared tunnel --url http://localhost:3002
# OR: ngrok http 3002
```
Then in **ChatGPT → Settings → Apps / Connectors → Developer Mode → Create**, set:
- **MCP Server URL:** `https://<your-tunnel-domain>/mcp?agentName=ChatGPT`
- **Authentication:** `No Auth` (note: ChatGPT Work / Business / Enterprise workspaces require admin approval for Developer Mode connectors).

### Option C: Test with the Built-In Demo MCP Agent
With `npm run dev` (or `npm start`) running in one terminal, launch an autonomous demo agent in a second terminal:
```bash
npm run demo-agent
```
Watch the **MCP Agents** HUD in the browser update in real time with its live POV camera, compass heading, movement steps, and activity log!

---

## Ready-to-Copy `mcp_config.json` Snippets

### 1. Single AI Agent (`stdio` — Claude Desktop / Cursor / Antigravity)
Replace `C:/Users/CP/.gemini/antigravity/scratch/geoguessr-mcp` with your cloned project path:
```json
{
  "mcpServers": {
    "geoguessr-arena": {
      "command": "node",
      "args": [
        "C:/Users/CP/.gemini/antigravity/scratch/geoguessr-mcp/mcp-server/dist/index.js",
        "--transport",
        "stdio",
        "--backend-url",
        "http://localhost:3001",
        "--agent-name",
        "Claude Explorer",
        "--model",
        "claude-sonnet"
      ]
    }
  }
}
```

### 2. Multi-Agent Battle Royale (Multiple AI Agents Simultaneously)
Switch Match Setup to **Free-For-All (`ffa`)** and register multiple named MCP entries:
```json
{
  "mcpServers": {
    "geoguessr-claude": {
      "command": "node",
      "args": [
        "C:/Users/CP/.gemini/antigravity/scratch/geoguessr-mcp/mcp-server/dist/index.js",
        "--transport",
        "stdio",
        "--backend-url",
        "http://localhost:3001",
        "--agent-name",
        "Claude",
        "--model",
        "claude-3.7-sonnet"
      ]
    },
    "geoguessr-gemini": {
      "command": "node",
      "args": [
        "C:/Users/CP/.gemini/antigravity/scratch/geoguessr-mcp/mcp-server/dist/index.js",
        "--transport",
        "stdio",
        "--backend-url",
        "http://localhost:3001",
        "--agent-name",
        "Gemini",
        "--model",
        "gemini-2.5-pro"
      ]
    }
  }
}
```

### 3. Remote `Streamable HTTP` & Legacy `SSE` Client Config (with `npm run mcp:http` running)
For Antigravity remote MCP or Streamable HTTP clients:
```json
{
  "mcpServers": {
    "geoguessr-http": {
      "url": "http://localhost:3002/mcp?agentName=Antigravity&model=antigravity"
    }
  }
}
```
*(Legacy HTTP+SSE clients can connect to `http://localhost:3002/sse?agentName=Remote-AI` on the exact same port.)*

---

## MCP Tools & Resources Specification

### Tools
1. `get_game_state` — Returns round number, `active` | `round_over` status, remaining timer, opaque road exits (`availableMoves`), camera orientation, and guess status. **Never leaks target coordinates while `active`.**
2. `look_around` — Captures a server-rendered `640×480` `image/jpeg` frame at the agent's own independent camera pose + compass metadata.
3. `pan_and_zoom` — Sets `heading` (`0–360`), `pitch` (`-90..90`), and `zoom` (`0–3`) and returns the updated JPEG viewport.
4. `move` — Steps to an adjacent panorama node by `direction` (`forward` | `backward` | `left` | `right`) or `node_id` and returns the new frame + exits.
5. `return_to_start` — Teleports back to the round's spawn node.
6. `submit_guess` — Submits `latitude`, `longitude`, and optional `reasoning` string (displayed in the post-round summary).

### Resources
- `game://rules` (`text/markdown`) — Scoring formula (`5000 * e^(-distance_km / 2000)`), coordinate conventions, and visual exploration guide.
- `game://leaderboard` (`application/json`) — Live standings across rounds.

---

## Verification & Typechecking
```bash
npm run typecheck
node scripts/verify-e2e.mjs
```
