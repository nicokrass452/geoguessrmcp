import assert from 'node:assert/strict';

const BIG_CITY_NAMES = new Set([
  'Tokyo',
  'Paris',
  'Reykjavik',
  'Rio de Janeiro',
  'Cairo / Giza',
  'New York City',
  'Sydney',
  'Cape Town',
  'Marrakech',
  'London',
  'San Francisco',
]);

export function getTier1Tests(_ctx) {
  return [
    {
      id: 'T1-CON-01',
      tier: 1,
      featureIds: ['F1', 'F7', 'F8', 'F9', 'F10'],
      title: 'Shared Contracts & Match Creation: PublicGameState exposes modes, locationMode, betting, roomCode, and mcpStatus',
      kind: 'api',
      requiresBrowser: false,
      requiresMcp: false,
      run: async (helpers) => {
        const res = await helpers.apiFetch('/api/match/new', {
          body: {
            mode: 'ffa',
            locationMode: 'big_cities',
            bettingEnabled: true,
            startingChips: 1000,
            totalRounds: 3,
            provider: 'open',
            humanName: 'ContractTester',
          },
        });
        assert.ok(res.ok, `POST /api/match/new failed: ${res.status}`);
        const s = res.data;
        assert.equal(s.mode, 'ffa');
        assert.equal(s.locationMode, 'big_cities');
        assert.equal(s.bettingEnabled, true);
        assert.equal(s.startingChips, 1000);
        assert.equal(s.human.chips, 1000);
        assert.ok(typeof s.roomCode === 'string' && s.roomCode.length >= 4);
        assert.ok(Array.isArray(s.humans) && s.humans.length >= 1);
        assert.ok(s.mcpStatus && ['offline', 'bridge_ready', 'connected'].includes(s.mcpStatus.status));
        assert.equal(s.roundSummary, null, 'Active round must not leak roundSummary');
        helpers.assertNoSecretLeak(res.text, 'T1-CON-01 /api/match/new');
      },
    },
    {
      id: 'T1-CON-02',
      tier: 1,
      featureIds: ['F1', 'F8', 'F9', 'F10'],
      title: 'Atomic Match Config & Telemetry: Health endpoint & pre-match setup update active match cleanly',
      kind: 'api',
      requiresBrowser: false,
      requiresMcp: false,
      run: async (helpers) => {
        const matchRes = await helpers.apiFetch('/api/match/new', {
          body: {
            mode: '1v1',
            locationMode: 'standard',
            bettingEnabled: false,
            totalRounds: 5,
            roundDurationSec: 60,
            provider: 'open',
            humanName: 'SetupHost',
          },
        });
        assert.ok(matchRes.ok);
        assert.equal(matchRes.data.totalRounds, 5);
        assert.equal(matchRes.data.roundDurationSec, 60);
        assert.equal(matchRes.data.human.name, 'SetupHost');

        const healthRes = await helpers.apiFetch('/api/health');
        assert.ok(healthRes.ok);
        assert.equal(healthRes.data.mapillaryAccessToken, null);
        assert.ok(healthRes.data.mcpStatus);
        helpers.assertNoSecretLeak(healthRes.text, 'T1-CON-02 /api/health');
      },
    },
    {
      id: 'T1-MCP-01',
      tier: 1,
      featureIds: ['F1', 'F2', 'F3', 'F8', 'F10'],
      title: 'MCP Streamable HTTP: submit_guess accepts optional wager and updates live MCP status to connected',
      kind: 'mcp',
      requiresBrowser: false,
      requiresMcp: true,
      run: async (helpers) => {
        const newRes = await helpers.apiFetch('/api/match/new', {
          body: {
            mode: '1v1',
            locationMode: 'standard',
            bettingEnabled: true,
            startingChips: 1000,
            totalRounds: 3,
            provider: 'open',
            humanName: 'WagerHuman',
          },
        });
        assert.ok(newRes.ok);

        const mcp = await helpers.connectHttpMcp({
          agentName: 'Tier1WagerBot',
          model: 'tier1-model',
        });
        helpers.onCleanup(() => mcp.close());

        const state = await mcp.callToolJson('get_game_state');
        assert.equal(state.bettingEnabled, true);
        assert.equal(state.chips ?? state.myChips, 1000);

        const statusRes = await helpers.apiFetch('/api/mcp/status');
        assert.ok(statusRes.ok);
        assert.equal(statusRes.data.status, 'connected');
        assert.ok(statusRes.data.activeMcpAgents >= 1);

        const guessRes = await mcp.callToolJson('submit_guess', {
          latitude: 35.6595,
          longitude: 139.7004,
          wager: 250,
          reasoning: 'Tier 1 explicit wager test',
          agent_id: state.agentId,
        });
        assert.ok(guessRes.accepted === true || guessRes.status === 'guess_recorded');
      },
    },
    {
      id: 'T1-MCP-02',
      tier: 1,
      featureIds: ['F2', 'F3', 'F7', 'F10'],
      title: 'MCP SSE & Heartbeat: SSE transport connects, explores scene, and heartbeats report transport metadata',
      kind: 'mcp',
      requiresBrowser: false,
      requiresMcp: true,
      run: async (helpers) => {
        await helpers.apiFetch('/api/match/new', {
          body: {
            mode: 'ffa',
            locationMode: 'standard',
            bettingEnabled: false,
            totalRounds: 3,
            provider: 'open',
          },
        });

        const mcp = await helpers.connectSseMcp({
          agentName: 'SseProbeBot',
          model: 'sse-model',
        });
        helpers.onCleanup(() => mcp.close());

        const state = await mcp.callToolJson('get_game_state');
        assert.ok(state.agentId);

        const lookRes = await mcp.callToolRaw('look_around', { agent_id: state.agentId });
        helpers.assertJpeg(helpers.getImageContent(lookRes), 'T1-MCP-02 look_around');

        const statusRes = await helpers.apiFetch('/api/mcp/status');
        assert.ok(statusRes.ok);
        assert.equal(statusRes.data.status, 'connected');
        assert.ok(statusRes.data.transports.includes('sse'));
      },
    },
    {
      id: 'T1-MCP-04',
      tier: 1,
      featureIds: ['F3', 'F10'],
      title: 'MCP Heartbeat Endpoint: Posting transport heartbeat records active bridge transport telemetry',
      kind: 'api',
      requiresBrowser: false,
      requiresMcp: false,
      run: async (helpers) => {
        const hb = await helpers.apiFetch('/api/mcp/heartbeat', {
          body: { transport: 'streamable-http', activeSessions: 1 },
        });
        assert.ok(hb.ok);
        assert.equal(hb.data.httpBridgeReachable, true);
        assert.ok(hb.data.transports.includes('streamable-http'));
      },
    },
    {
      id: 'T1-MCP-03',
      tier: 1,
      featureIds: ['F2', 'F3', 'F8', 'F10'],
      title: 'MCP Stdio & Confidence Auto-Betting: stdio transport + omitted wager triggers deterministic confidence wager',
      kind: 'mcp',
      requiresBrowser: false,
      requiresMcp: true,
      run: async (helpers) => {
        await helpers.apiFetch('/api/match/new', {
          body: {
            mode: '1v1',
            locationMode: 'standard',
            bettingEnabled: true,
            startingChips: 1000,
            totalRounds: 3,
            provider: 'open',
          },
        });

        const mcp = await helpers.connectStdioMcp({
          agentName: 'StdioAutoBetBot',
          model: 'stdio-model',
        });
        helpers.onCleanup(() => mcp.close());

        const state = await mcp.callToolJson('get_game_state');
        await mcp.callToolRaw('look_around', { agent_id: state.agentId });
        await mcp.callToolJson('submit_guess', {
          latitude: 48.8566,
          longitude: 2.3522,
          reasoning: 'Detailed European architectural clues observed near avenue.',
          agent_id: state.agentId,
        });

        const humanGuess = await helpers.apiFetch('/api/human/guess', {
          body: { latitude: 0, longitude: 0, wager: 100 },
        });
        assert.ok(humanGuess.ok);
        const aiResult = humanGuess.data.roundSummary?.results?.find(
          (r) => r.playerId === state.agentId
        );
        assert.ok(aiResult && typeof aiResult.wager === 'number' && aiResult.wager > 0);
      },
    },
    {
      id: 'T1-LOC-01',
      tier: 1,
      featureIds: ['F4', 'F5', 'F9'],
      title: 'Mountain Regions Pool: Generates mountain/non-city locations across multiple rounds',
      kind: 'api',
      requiresBrowser: false,
      requiresMcp: false,
      run: async (helpers) => {
        const start = await helpers.apiFetch('/api/match/new', {
          body: {
            mode: 'solo',
            locationMode: 'mountain_regions',
            bettingEnabled: false,
            totalRounds: 5,
            provider: 'open',
            humanName: 'MountainTester',
          },
        });
        assert.ok(start.ok);

        const seen = new Set();
        for (let r = 1; r <= 3; r++) {
          const g = await helpers.apiFetch('/api/human/guess', {
            body: { latitude: 46.59, longitude: 7.9 },
          });
          assert.ok(g.ok);
          const target = g.data.roundSummary?.target;
          assert.ok(target && !BIG_CITY_NAMES.has(target.city), `Unexpected city in mountain_regions: ${target?.city}`);
          seen.add(target.name);
          if (r < 3) await helpers.apiFetch('/api/match/next-round', { body: {} });
        }
        assert.equal(seen.size, 3);
      },
    },
    {
      id: 'T1-LOC-02',
      tier: 1,
      featureIds: ['F4', 'F5', 'F9'],
      title: 'Big Cities Only Pool: Generates strictly major cities and excludes alpine peaks',
      kind: 'api',
      requiresBrowser: false,
      requiresMcp: false,
      run: async (helpers) => {
        const start = await helpers.apiFetch('/api/match/new', {
          body: {
            mode: 'solo',
            locationMode: 'big_cities',
            bettingEnabled: false,
            totalRounds: 3,
            provider: 'open',
            humanName: 'CityTester',
          },
        });
        assert.ok(start.ok);
        const g = await helpers.apiFetch('/api/human/guess', {
          body: { latitude: 48.85, longitude: 2.35 },
        });
        assert.ok(g.ok);
        const target = g.data.roundSummary?.target;
        assert.ok(target && BIG_CITY_NAMES.has(target.city), `Expected big city, got ${target?.city}`);
      },
    },
    {
      id: 'T1-LOC-03',
      tier: 1,
      featureIds: ['F4', 'F5'],
      title: 'Standard Pool & Provider Fallback: Supports all catalog regions cleanly',
      kind: 'api',
      requiresBrowser: false,
      requiresMcp: false,
      run: async (helpers) => {
        const start = await helpers.apiFetch('/api/match/new', {
          body: {
            mode: 'solo',
            locationMode: 'standard',
            provider: 'wikimedia',
            totalRounds: 3,
          },
        });
        assert.ok(start.ok);
        assert.equal(start.data.locationMode, 'standard');
        assert.ok(
          ['wikimedia-commons', 'open-procedural-360'].includes(start.data.activeLocationProvider)
        );
      },
    },
    {
      id: 'T1-LOC-04',
      tier: 1,
      featureIds: ['F4', 'F5'],
      title: 'Mountain Panorama Render: Equirectangular panorama JPEG renders cleanly for mountain_regions target',
      kind: 'api',
      requiresBrowser: false,
      requiresMcp: false,
      run: async (helpers) => {
        const start = await helpers.apiFetch('/api/match/new', {
          body: {
            mode: 'solo',
            locationMode: 'mountain_regions',
            totalRounds: 3,
            provider: 'open',
          },
        });
        assert.ok(start.ok);
        const panoUrl = start.data.human?.panoramaUrl;
        assert.ok(panoUrl);
        const jpgRes = await helpers.apiFetch(panoUrl, { raw: true });
        assert.ok(jpgRes.ok);
        helpers.assertJpeg(jpgRes.buffer, 'T1-LOC-04 mountain equirectangular.jpg');
      },
    },
    {
      id: 'T1-ROOM-03',
      tier: 1,
      featureIds: ['F6', 'F11'],
      title: 'Room State Isolation: Independent human move in PvP room updates only acting player position',
      kind: 'api',
      requiresBrowser: false,
      requiresMcp: false,
      run: async (helpers) => {
        const c = await helpers.apiFetch('/api/rooms', {
          body: {
            mode: 'pvp',
            locationMode: 'standard',
            totalRounds: 3,
            provider: 'open',
            playerId: 'iso_p1',
            humanName: 'IsoHost',
            autoStart: true,
          },
        });
        assert.ok(c.ok);
        const code = c.data.roomCode;
        helpers.onCleanup(() =>
          helpers.apiFetch(`/api/rooms/${code}/leave`, { body: { playerId: 'iso_p1' } }).catch(() => {})
        );
        await helpers.apiFetch(`/api/rooms/${code}/join`, {
          body: { playerId: 'iso_p2', playerName: 'IsoGuest' },
        });
        helpers.onCleanup(() =>
          helpers.apiFetch(`/api/rooms/${code}/leave`, { body: { playerId: 'iso_p2' } }).catch(() => {})
        );

        const moveTarget = c.data.state.human?.availableMoves?.[0]?.nodeId;
        if (moveTarget) {
          const moved = await helpers.apiFetch('/api/human/move', {
            body: { roomCode: code, playerId: 'iso_p1', nodeId: moveTarget },
          });
          assert.ok(moved.ok);
          assert.equal(moved.data.human.currentNodeId, moveTarget);
        }
        const p2State = await helpers.apiFetch(`/api/match?roomCode=${code}&playerId=iso_p2`);
        assert.ok(p2State.ok);
        assert.equal(p2State.data.human.stepCount, 0);
      },
    },
    {
      id: 'T1-UI-02',
      tier: 1,
      featureIds: ['F12', 'F14', 'F16'],
      title: 'Welcome Hub 1v1 Submode & Arena Match Setup Button: Switches 1v1/FFA and opens LobbyModal in arena',
      kind: 'browser',
      requiresBrowser: true,
      requiresMcp: false,
      run: async (helpers) => {
        const tab = await helpers.openBrowserTab(helpers.uiUrl);
        helpers.onCleanup(() => helpers.browserDriver.closeTab(tab));

        await helpers.browserDriver.waitForSelector(tab, '[data-testid="submode-1v1"]', 8000);
        await helpers.browserDriver.clickSelector(tab, '[data-testid="submode-1v1"]', 5000);
        await helpers.browserDriver.clickSelector(tab, '[data-testid="play-button"]', 5000);
        await helpers.browserDriver.waitForSelector(tab, '[data-testid="live-mcp-badge"]', 8000);
        await helpers.browserDriver.waitForSelector(tab, '[data-testid="quick-return-home"]', 6000);
      },
    },
    {
      id: 'T1-UI-03',
      tier: 1,
      featureIds: ['F12'],
      title: 'Welcome Hub Step 2 Pre-Match Controls: Renders Rounds (3/5/10), Timer, Step Cap, and Provider selectors',
      kind: 'browser',
      requiresBrowser: true,
      requiresMcp: false,
      run: async (helpers) => {
        const tab = await helpers.openBrowserTab(helpers.uiUrl);
        helpers.onCleanup(() => helpers.browserDriver.closeTab(tab));

        await helpers.browserDriver.waitForSelector(tab, '[data-testid="welcome-next-step"]', 8000);
        await helpers.browserDriver.clickSelector(tab, '[data-testid="welcome-next-step"]', 5000);
        for (const id of ['rounds-3', 'rounds-5', 'rounds-10', 'play-button']) {
          await helpers.browserDriver.waitForSelector(tab, `[data-testid="${id}"]`, 5000);
        }
      },
    },
    {
      id: 'T1-ROOM-01',
      tier: 1,
      featureIds: ['F1', 'F6', 'F7', 'F11'],
      title: 'Room Creation, Multi-Human Join & Start: Broadcasts personalized WebSocket state_sync per playerId',
      kind: 'ws',
      requiresBrowser: false,
      requiresMcp: false,
      run: async (helpers) => {
        const hostId = 't1_host_1';
        const guestId = 't1_guest_2';

        const createRes = await helpers.apiFetch('/api/rooms', {
          body: {
            mode: 'pvp',
            locationMode: 'standard',
            bettingEnabled: false,
            totalRounds: 3,
            provider: 'open',
            playerId: hostId,
            humanName: 'HostPlayer',
            autoStart: false,
          },
        });
        assert.ok(createRes.ok);
        const roomCode = createRes.data.roomCode;
        assert.equal(createRes.data.state.matchStatus, 'lobby');
        helpers.onCleanup(() =>
          helpers.apiFetch(`/api/rooms/${roomCode}/leave`, { body: { playerId: hostId } }).catch(() => {})
        );

        const wsHost = await helpers.connectUiWs({ roomCode, playerId: hostId });
        helpers.onCleanup(() => wsHost.close());
        await wsHost.waitForMessage((m) => m.type === 'state_sync', 4000, { fromIndex: 0 });

        const joinRes = await helpers.apiFetch(`/api/rooms/${roomCode}/join`, {
          body: { playerId: guestId, playerName: 'GuestPlayer' },
        });
        assert.ok(joinRes.ok);
        helpers.onCleanup(() =>
          helpers.apiFetch(`/api/rooms/${roomCode}/leave`, { body: { playerId: guestId } }).catch(() => {})
        );

        const syncAfterJoin = await wsHost.waitForMessage(
          (m) => m.type === 'state_sync' && m.state?.humans?.length === 2,
          4000
        );
        assert.equal(syncAfterJoin.state.humans.length, 2);

        const startRes = await helpers.apiFetch(`/api/rooms/${roomCode}/start`, {
          body: { playerId: hostId },
        });
        assert.ok(startRes.ok);
        assert.equal(startRes.data.state.matchStatus, 'active');
      },
    },
    {
      id: 'T1-ROOM-02',
      tier: 1,
      featureIds: ['F6', 'F7', 'F9', 'F11'],
      title: 'PvPvAI Room & Leave Cleanup: Host leave transfers host and stops abandoned AI runs',
      kind: 'api',
      requiresBrowser: false,
      requiresMcp: false,
      run: async (helpers) => {
        const createRes = await helpers.apiFetch('/api/rooms', {
          body: {
            mode: 'pvp_ai',
            locationMode: 'standard',
            totalRounds: 3,
            provider: 'open',
            playerId: 'host_leave_1',
            humanName: 'HostA',
            autoStart: true,
          },
        });
        assert.ok(createRes.ok);
        const code = createRes.data.roomCode;
        await helpers.apiFetch(`/api/rooms/${code}/join`, {
          body: { playerId: 'guest_stay_2', playerName: 'GuestB' },
        });
        await helpers.apiFetch(`/api/rooms/${code}/leave`, {
          body: { playerId: 'host_leave_1' },
        });
        const stateAfter = await helpers.apiFetch(`/api/match?roomCode=${code}&playerId=guest_stay_2`);
        assert.ok(stateAfter.ok);
        assert.equal(stateAfter.data.hostPlayerId, 'guest_stay_2');
        await helpers.apiFetch(`/api/rooms/${code}/leave`, {
          body: { playerId: 'guest_stay_2' },
        });
      },
    },
    {
      id: 'T1-UI-01',
      tier: 1,
      featureIds: ['F11', 'F12', 'F13', 'F14', 'F16'],
      title: 'Welcome Hub Two-Step Flow -> Solo Betting Arena: Renders Welcome Hub, Top HUD badges, and Betting UI',
      kind: 'browser',
      requiresBrowser: true,
      requiresMcp: false,
      run: async (helpers) => {
        const tab = await helpers.openBrowserTab(helpers.uiUrl);
        helpers.onCleanup(() => helpers.browserDriver.closeTab(tab));

        await helpers.browserDriver.waitForSelector(tab, '[data-testid="welcome-mcp-badge"]', 10000);
        await helpers.browserDriver.waitForSelector(tab, '[data-testid="mode-card-solo"]', 6000);
        await helpers.browserDriver.clickSelector(tab, '[data-testid="mode-card-solo"]', 5000);
        await helpers.browserDriver.waitForSelector(tab, '[data-testid="location-big_cities"]', 6000);
        await helpers.browserDriver.clickSelector(tab, '[data-testid="location-big_cities"]', 5000);
        await helpers.browserDriver.clickSelector(tab, '[data-testid="betting-toggle"]', 5000);
        await helpers.browserDriver.clickSelector(tab, '[data-testid="rounds-3"]', 5000);
        await helpers.browserDriver.clickSelector(tab, '[data-testid="play-button"]', 5000);

        await helpers.browserDriver.waitForSelector(tab, '[data-testid="quick-return-home"]', 10000);
        await helpers.browserDriver.waitForSelector(tab, '[data-testid="live-mcp-badge"]', 6000);
        await helpers.browserDriver.waitForSelector(tab, '[data-testid="top-hud-chips"]', 6000);
        await helpers.browserDriver.waitForSelector(tab, 'input[aria-label="Confidence wager amount"]', 6000);

        await helpers.browserDriver.clickSelector(tab, '[data-testid="quick-return-home"]', 5000);
        await helpers.browserDriver.waitForSelector(tab, '[data-testid="mode-card-solo"]', 6000);

        const { consoleErrors, pageErrors } = helpers.browserDriver.getErrors(tab);
        assert.deepEqual(pageErrors, []);
        assert.deepEqual(consoleErrors, []);
      },
    },
    {
      id: 'T1-SPEC-01',
      tier: 1,
      featureIds: ['F1', 'F2', 'F3', 'F6', 'F7', 'F8', 'F10', 'F12', 'F13', 'F14', 'F15', 'F16'],
      title: 'Spectator Stage & Multi-Mode UI: Renders SpectatorStage without minimap, shows live POV card & bets, and supports Return Home',
      kind: 'browser',
      requiresBrowser: true,
      requiresMcp: true,
      run: async (helpers) => {
        const tab = await helpers.openBrowserTab(helpers.uiUrl);
        helpers.onCleanup(() => helpers.browserDriver.closeTab(tab));

        await helpers.browserDriver.waitForSelector(tab, '[data-testid="mode-card-spectator"]', 10000);
        await helpers.browserDriver.clickSelector(tab, '[data-testid="mode-card-spectator"]', 5000);
        await helpers.browserDriver.clickSelector(tab, '[data-testid="betting-toggle"]', 5000);
        await helpers.browserDriver.clickSelector(tab, '[data-testid="rounds-3"]', 5000);
        await helpers.browserDriver.clickSelector(tab, '[data-testid="play-button"]', 5000);

        await helpers.browserDriver.waitForSelector(tab, '[data-testid="spectator-stage"]', 10000);
        const hasMiniMap = await tab.eval("Boolean(document.querySelector('[data-testid=\"guess-minimap\"]'))");
        assert.equal(hasMiniMap, false);

        const mcp = await helpers.connectHttpMcp({
          mcpHttpUrl: helpers.mcpHttpUrl,
          agentName: 'Tier1SpectatorBot',
          model: 't1-spec-model',
        });
        helpers.onCleanup(() => mcp.close());
        const st = await mcp.callToolJson('get_game_state');

        await helpers.browserDriver.waitForSelector(tab, `[data-testid="spectator-card-${st.agentId}"]`, 8000);
        await helpers.browserDriver.waitForSelector(tab, '[data-testid="live-mcp-badge"]', 6000);

        await mcp.callToolJson('submit_guess', {
          latitude: 35.6595,
          longitude: 139.7004,
          wager: 200,
          reasoning: 'Tier 1 spectator round completion check',
          agent_id: st.agentId,
        });

        await helpers.browserDriver.waitForText(tab, 'body', 'Round 1 of 3 Summary', 8000);
        const { consoleErrors, pageErrors } = helpers.browserDriver.getErrors(tab);
        assert.deepEqual(pageErrors, []);
        assert.deepEqual(consoleErrors, []);
      },
    },
    {
      id: 'T1-SPEC-02',
      tier: 1,
      featureIds: ['F4', 'F5', 'F6', 'F11', 'F12', 'F13', 'F14', 'F15', 'F16'],
      title: 'Welcome Hub All 5 Mode Cards & 3 Region Cards + Multi-Tab PvP Waiting Room Code Display',
      kind: 'browser',
      requiresBrowser: true,
      requiresMcp: false,
      run: async (helpers) => {
        const tab = await helpers.openBrowserTab(helpers.uiUrl);
        helpers.onCleanup(() => helpers.browserDriver.closeTab(tab));

        for (const id of [
          'mode-card-player_vs_ai',
          'mode-card-pvp_ai',
          'mode-card-pvp',
          'mode-card-solo',
          'mode-card-spectator',
          'location-standard',
          'location-big_cities',
          'location-mountain_regions',
        ]) {
          await helpers.browserDriver.waitForSelector(tab, `[data-testid="${id}"]`, 6000);
        }

        await helpers.browserDriver.clickSelector(tab, '[data-testid="mode-card-pvp"]', 5000);
        await helpers.browserDriver.clickSelector(tab, '[data-testid="location-mountain_regions"]', 5000);
        await helpers.browserDriver.clickSelector(tab, '[data-testid="betting-toggle"]', 5000);
        await helpers.browserDriver.clickSelector(tab, '[data-testid="play-button"]', 5000);

        await helpers.browserDriver.waitForSelector(tab, '[data-testid="room-code"]', 8000);
        await helpers.browserDriver.waitForSelector(tab, '[data-testid="lobby-start-match"]', 6000);
        await helpers.browserDriver.clickSelector(tab, '[data-testid="lobby-start-match"]', 5000);
        await helpers.browserDriver.waitForSelector(tab, '[data-testid="guess-minimap"]', 8000);
        await helpers.browserDriver.waitForSelector(tab, '[data-testid="top-hud-chips"]', 6000);
      },
    },
    {
      id: 'T1-SPV-01',
      tier: 1,
      featureIds: ['F13', 'F14', 'F15', 'F16'],
      title: 'HUD Modes & Settlement Views: Solo hides AgentHud and Spectator HUD omits human chip pill',
      kind: 'browser',
      requiresBrowser: true,
      requiresMcp: false,
      run: async (helpers) => {
        const tab = await helpers.openBrowserTab(helpers.uiUrl);
        helpers.onCleanup(() => helpers.browserDriver.closeTab(tab));

        await helpers.browserDriver.waitForSelector(tab, '[data-testid="mode-card-solo"]', 8000);
        await helpers.browserDriver.clickSelector(tab, '[data-testid="mode-card-solo"]', 5000);
        await helpers.browserDriver.clickSelector(tab, '[data-testid="play-button"]', 5000);
        await helpers.browserDriver.waitForSelector(tab, '[data-testid="quick-return-home"]', 8000);

        const bodyTxt = await tab.eval('document.body.innerText');
        assert.equal(/Auto AI Opponents/i.test(bodyTxt), false);

        await helpers.browserDriver.clickSelector(tab, '[data-testid="quick-return-home"]', 5000);
        await helpers.browserDriver.clickSelector(tab, '[data-testid="mode-card-spectator"]', 5000);
        await helpers.browserDriver.clickSelector(tab, '[data-testid="betting-toggle"]', 5000);
        await helpers.browserDriver.clickSelector(tab, '[data-testid="play-button"]', 5000);
        await helpers.browserDriver.waitForSelector(tab, '[data-testid="spectator-stage"]', 8000);
        const hasTopHumanChips = await tab.eval("Boolean(document.querySelector('[data-testid=\"top-hud-chips\"]'))");
        assert.equal(hasTopHumanChips, false);
      },
    },
    {
      id: 'T1-BET-01',
      tier: 1,
      featureIds: ['F1', 'F2', 'F8', 'F11', 'F13', 'F15'],
      title: 'Confidence Betting Payouts: Higher-scoring bettor wins +wager while lower-scoring bettor loses -wager',
      kind: 'api',
      requiresBrowser: false,
      requiresMcp: true,
      run: async (helpers) => {
        await helpers.apiFetch('/api/match/new', {
          body: {
            mode: '1v1',
            locationMode: 'standard',
            bettingEnabled: true,
            startingChips: 1000,
            totalRounds: 3,
            provider: 'open',
            playerId: 'bet_h1',
            humanName: 'BetWinner',
          },
        });

        const mcp = await helpers.connectHttpMcp({
          agentName: 'BetLoserBot',
          model: 'bet-model',
        });
        helpers.onCleanup(() => mcp.close());
        const ag = await mcp.callToolJson('get_game_state');

        await mcp.callToolJson('submit_guess', {
          latitude: -75,
          longitude: 170,
          wager: 400,
          agent_id: ag.agentId,
        });
        const gRes = await helpers.apiFetch('/api/human/guess', {
          body: { playerId: 'bet_h1', latitude: 40, longitude: 0, wager: 300 },
        });
        assert.ok(gRes.ok);
        const results = gRes.data.roundSummary?.results || [];
        const hRes = results.find((r) => r.isHuman);
        const aRes = results.find((r) => !r.isHuman);
        assert.ok(hRes && aRes);
        assert.equal(Math.abs(hRes.chipDelta), 300);
        assert.equal(Math.abs(aRes.chipDelta), 400);
      },
    },
    {
      id: 'T1-SPEC-03',
      tier: 1,
      featureIds: ['F15'],
      title: 'Spectator Stage Viewport JPEG: Connected MCP agent renders valid JPEG camera feed in spectator mode',
      kind: 'mcp',
      requiresBrowser: false,
      requiresMcp: true,
      run: async (helpers) => {
        await helpers.apiFetch('/api/match/new', {
          body: {
            mode: 'spectator',
            locationMode: 'standard',
            totalRounds: 3,
            provider: 'open',
          },
        });
        const mcp = await helpers.connectHttpMcp({
          agentName: 'SpecCamBot',
          model: 'spec-cam-model',
        });
        helpers.onCleanup(() => mcp.close());
        const st = await mcp.callToolJson('get_game_state');
        const imgRes = await helpers.apiFetch(`/api/agents/${encodeURIComponent(st.agentId)}/viewport.jpg`, {
          raw: true,
        });
        assert.ok(imgRes.ok);
        helpers.assertJpeg(imgRes.buffer, 'T1-SPEC-03 spectator viewport.jpg');
      },
    },
  ];
}
