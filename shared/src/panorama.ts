import { normalizeHeading } from './geo.js';
import type { CameraView } from './types.js';

/**
 * Converts zoom level [0..3] into vertical Field of View (degrees).
 * zoom 0 -> 90 deg, zoom 1 -> 54.5 deg, zoom 2 -> 39.1 deg, zoom 3 -> 30.5 deg
 */
export function zoomToFov(zoom: number): number {
  const clampedZoom = Math.max(0, Math.min(3, Number.isFinite(zoom) ? zoom : 0));
  return Number((90 / (1 + clampedZoom * 0.65)).toFixed(2));
}

export function clampCamera(
  heading: number,
  pitch: number,
  zoom: number
): CameraView {
  const safeHeading = Number.isFinite(heading) ? normalizeHeading(heading) : 0;
  const safePitch = Number.isFinite(pitch)
    ? Math.max(-85, Math.min(85, pitch))
    : 0;
  const safeZoom = Number.isFinite(zoom) ? Math.max(0, Math.min(3, zoom)) : 0;

  return {
    heading: Number(safeHeading.toFixed(2)),
    pitch: Number(safePitch.toFixed(2)),
    zoom: Number(safeZoom.toFixed(2)),
    fov: zoomToFov(safeZoom),
  };
}

export const GAME_RULES_MARKDOWN = `# GeoGuessr MCP Arena — Rules & Exploration Guide

## Objective
You are placed in a 360° street-level panorama somewhere on Earth. Explore your surroundings visually, deduce your real-world location, and submit a WGS84 \`latitude\` (-90 to 90) and \`longitude\` (-180 to 180) guess before the round ends.

## Scoring Formula
Points are awarded on a **0 to 5,000** exponential scale per round based on Haversine great-circle distance:
\`\`\`
score = round(5000 * exp(-distance_km / 2000))
\`\`\`
- \`0 km\` -> **5,000 pts**
- \`100 km\` -> **4,756 pts**
- \`500 km\` -> **3,894 pts**
- \`2,000 km\` -> **1,839 pts**
- \`5,000 km\` -> **410 pts**

## Matchup Modes
Matches run in one of six modes (reported as \`mode\` in \`get_game_state\`):
- **\`1v1\` (Player vs AI Duel)**: 1 human player vs 1 AI opponent.
- **\`ffa\` (Player vs AI Free-For-All)**: 1 human player vs multiple AI opponents.
- **\`pvp_ai\` (Player vs Player vs AI)**: Multiple human players in a shared room competing against each other and AI opponents.
- **\`pvp\` (Player vs Player)**: Multiple human players in a shared room only (no AI opponents).
- **\`solo\` (Solo Practice)**: Single human player exploration only (no AI opponents).
- **\`spectator\` (AI-Only Spectator Mode)**: Autonomous AI opponents compete against each other while humans watch live POV feeds; no human guess is required, and a round completes once all participating AI agents submit guesses (or the timer expires).

In multi-human rooms (\`pvp\` and \`pvp_ai\`), all connected human players and participating AI agents must lock in guesses (or let the round timer expire) before the round reveals the target.

## Location & Region Gamemodes
Matches select locations according to \`locationMode\` (reported in \`get_game_state\`):
- **\`standard\`**: Global mix of all supported regions (cities, towns, landmarks, and mountains).
- **\`big_cities\`**: Major metropolitan areas and dense urban hubs only.
- **\`mountain_regions\`**: Alpine valleys, mountain passes, highland towns, and mountain landmarks only.

## Confidence Betting Mode
When \`bettingEnabled\` is \`true\` in \`get_game_state\`:
- Every human and AI player starts the match with \`startingChips\` (default \`1000\` chips), tracked in \`chips\`.
- Players wager chips based on their confidence before locking in a guess.
- **AI Wager Parameter**: Pass an optional non-negative integer \`wager\` (\`0\` up to your current \`chips\` balance) in \`submit_guess\`. Wager higher when strong visual clues (readable signage, unique landmarks, road markings) confirm your region, and lower when uncertain.
- **Omitted Wager Fallback**: If an AI agent omits \`wager\` while \`bettingEnabled\` is \`true\`, the server applies a deterministic confidence-based auto-wager from the agent's available chip stack.
- **Round Settlement**: At round end, chip payouts are settled based on round outcomes (top finishers earn positive \`chipDelta\` proportional to their wager and round performance; losing wagers forfeit staked chips down to a \`0\` floor). Both \`RoundSummary\` and \`game://leaderboard\` report \`wager\`, \`chipDelta\`, \`chipsAfter\`, \`chips\`, and \`netChips\`.
- When \`bettingEnabled\` is \`false\`, \`wager\` is ignored.

## Coordinate & Camera Conventions
- **Latitude**: \`+90\` is North Pole, \`-90\` is South Pole.
- **Longitude**: \`-180\` to \`+180\` (Negative = West / Americas; Positive = East / Europe, Africa, Asia, Oceania).
- **Heading**: \`0° = North\`, \`90° = East\`, \`180° = South\`, \`270° = West\`.
- **Pitch**: \`0° = Horizon\`, \`+90° = Straight Up\`, \`-90° = Straight Down\`.
- **Zoom**: \`0\` (wide 90° FOV) to \`3\` (telephoto ~30.5° FOV for reading distant signs).

## Exploration Strategy for AI Agents
1. Call \`get_game_state\` first to check round status, \`mode\`, \`locationMode\`, \`bettingEnabled\` / \`chips\`, time remaining, and available road exits.
2. Call \`look_around\` to inspect your starting view.
3. Use \`pan_and_zoom\` to scan all four cardinal headings (\`0°, 90°, 180°, 270°\`) and check **sun position** (sun in the south generally indicates Northern Hemisphere; sun in the north indicates Southern Hemisphere).
4. Zoom in (\`zoom: 2\` or \`3\`) on street signs, license plates, shop text, bollards, and landmarks.
5. Inspect **driving side**, **architecture**, **vegetation**, and **road markings**.
6. Use \`move\` (\`forward\`, \`left\`, \`right\`, \`backward\`, or a specific \`node_id\`) to walk down the street toward intersections and new signs. Use \`return_to_start\` anytime to orient yourself back at spawn.
7. Call \`submit_guess\` with your final coordinates, concise \`reasoning\` summarizing the clues you observed, and (if \`bettingEnabled\` is \`true\`) a confidence-calibrated integer \`wager\` (0 to \`chips\`).
`;
