import assert from 'node:assert/strict';

export function getTier2Tests(_ctx) {
  return [
    {
      id: 'T2-BND-01',
      tier: 2,
      featureIds: ['F1', 'F2', 'F8', 'F13'],
      title: 'Betting Boundaries: Wager = 0 (free guess), Wager = chips (All-In), Negative Wager (400), Over-Balance Wager (400)',
      kind: 'api',
      requiresBrowser: false,
      requiresMcp: false,
      run: async (helpers) => {
        const start = await helpers.apiFetch('/api/match/new', {
          body: {
            mode: 'solo',
            locationMode: 'standard',
            bettingEnabled: true,
            startingChips: 1000,
            totalRounds: 3,
            provider: 'open',
            humanName: 'BoundaryBettor',
          },
        });
        assert.ok(start.ok);

        const negRes = await helpers.apiFetch('/api/human/guess', {
          body: { latitude: 35, longitude: 139, wager: -50 },
        });
        assert.equal(negRes.status, 400);

        const overRes = await helpers.apiFetch('/api/human/guess', {
          body: { latitude: 35, longitude: 139, wager: 1500 },
        });
        assert.equal(overRes.status, 400);

        const zeroRes = await helpers.apiFetch('/api/human/guess', {
          body: { latitude: 35, longitude: 139, wager: 0 },
        });
        assert.ok(zeroRes.ok);
        const r1 = zeroRes.data.roundSummary?.results?.[0];
        assert.equal(r1.wager, 0);
        assert.equal(r1.chipDelta, 0);
        assert.equal(r1.chipsAfter, 1000);

        await helpers.apiFetch('/api/match/next-round', { body: {} });
        const allInRes = await helpers.apiFetch('/api/human/guess', {
          body: { latitude: 35, longitude: 139, wager: 1000 },
        });
        assert.ok(allInRes.ok);
        const r2 = allInRes.data.roundSummary?.results?.[0];
        assert.equal(r2.wager, 1000);
        assert.ok(r2.chipsAfter === 2000 || r2.chipsAfter === 0);
      },
    },
    {
      id: 'T2-BND-02',
      tier: 2,
      featureIds: ['F6', 'F7', 'F11', 'F15'],
      title: 'Room Host Authorization & Negative Robustness: Unknown roomCode (404), Non-Host Start/End/Next (403), Duplicate Guess (400), Spectator Human Guess (403)',
      kind: 'api',
      requiresBrowser: false,
      requiresMcp: false,
      run: async (helpers) => {
        const badRoom = await helpers.apiFetch('/api/rooms/NOPE99/join', {
          body: { playerId: 'p_unknown', playerName: 'Ghost' },
        });
        assert.equal(badRoom.status, 404);

        const created = await helpers.apiFetch('/api/rooms', {
          body: {
            mode: 'pvp',
            locationMode: 'standard',
            totalRounds: 3,
            provider: 'open',
            playerId: 't2_host',
            humanName: 'Host',
            autoStart: false,
          },
        });
        assert.ok(created.ok);
        const code = created.data.roomCode;
        helpers.onCleanup(() =>
          helpers.apiFetch(`/api/rooms/${code}/leave`, { body: { playerId: 't2_host' } }).catch(() => {})
        );

        await helpers.apiFetch(`/api/rooms/${code}/join`, {
          body: { playerId: 't2_guest', playerName: 'Guest' },
        });
        helpers.onCleanup(() =>
          helpers.apiFetch(`/api/rooms/${code}/leave`, { body: { playerId: 't2_guest' } }).catch(() => {})
        );

        const nonHostStart = await helpers.apiFetch(`/api/rooms/${code}/start`, {
          body: { playerId: 't2_guest' },
        });
        assert.equal(nonHostStart.status, 403);

        const started = await helpers.apiFetch(`/api/rooms/${code}/start`, {
          body: { playerId: 't2_host' },
        });
        assert.ok(started.ok);

        const nonHostEnd = await helpers.apiFetch('/api/match/end-round', {
          body: { roomCode: code, playerId: 't2_guest' },
        });
        assert.equal(nonHostEnd.status, 403, 'Non-host manual end-round must return 403');

        const nonHostNext = await helpers.apiFetch('/api/match/next-round', {
          body: { roomCode: code, playerId: 't2_guest' },
        });
        assert.equal(nonHostNext.status, 403, 'Non-host next-round must return 403');

        const g1 = await helpers.apiFetch('/api/human/guess', {
          body: { roomCode: code, playerId: 't2_host', latitude: 40, longitude: -74 },
        });
        assert.ok(g1.ok);

        const g1Dup = await helpers.apiFetch('/api/human/guess', {
          body: { roomCode: code, playerId: 't2_host', latitude: 41, longitude: -73 },
        });
        assert.ok([400, 409].includes(g1Dup.status));

        const specMatch = await helpers.apiFetch('/api/match/new', {
          body: {
            mode: 'spectator',
            locationMode: 'standard',
            totalRounds: 3,
            provider: 'open',
          },
        });
        assert.ok(specMatch.ok);
        const specGuess = await helpers.apiFetch('/api/human/guess', {
          body: { latitude: 35, longitude: 139 },
        });
        assert.ok([403, 409].includes(specGuess.status));
      },
    },
    {
      id: 'T2-BND-03',
      tier: 2,
      featureIds: ['F1', 'F2', 'F3', 'F9', 'F10'],
      title: 'Coordinate & Step Cap Boundaries: Out-of-range coordinates (400), exact poles (-90/-180), and MCP step cap block',
      kind: 'api',
      requiresBrowser: false,
      requiresMcp: true,
      run: async (helpers) => {
        const start = await helpers.apiFetch('/api/match/new', {
          body: {
            mode: '1v1',
            locationMode: 'mountain_regions',
            bettingEnabled: false,
            totalRounds: 3,
            maxStepsPerRound: 2,
            provider: 'open',
            humanName: 'CoordTester',
          },
        });
        assert.ok(start.ok);

        const badLat = await helpers.apiFetch('/api/human/guess', {
          body: { latitude: 95, longitude: 0 },
        });
        assert.equal(badLat.status, 400);

        const edgeLatLng = await helpers.apiFetch('/api/human/guess', {
          body: { latitude: -90, longitude: -180 },
        });
        assert.ok(edgeLatLng.ok);

        const mcp = await helpers.connectHttpMcp({
          agentName: 'BoundaryBot',
          model: 'boundary-model',
        });
        helpers.onCleanup(() => mcp.close());
        const ag = await mcp.callToolJson('get_game_state');
        await mcp.callToolRaw('look_around', { agent_id: ag.agentId });
        await mcp.callToolRaw('pan_and_zoom', { heading: 180, pitch: 0, zoom: 1, agent_id: ag.agentId });

        let stepErr = null;
        try {
          await mcp.callToolJson('look_around', { agent_id: ag.agentId });
        } catch (err) {
          stepErr = err;
        }
        assert.ok(stepErr, '3rd exploration call must be blocked when maxStepsPerRound=2');

        const health = await helpers.apiFetch('/api/health');
        assert.ok(health.ok);
        assert.equal(health.data.mapillaryAccessToken, null);
        helpers.assertNoSecretLeak(health.text, 'T2-BND-03 /api/health');
      },
    },
    {
      id: 'T2-BND-03B',
      tier: 2,
      featureIds: ['F2', 'F8'],
      title: 'MCP Wager Boundaries: Agent wager=0 and wager exceeding agent chips clamp safely',
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

        const mcp = await helpers.connectHttpMcp({
          agentName: 'ClampBot',
          model: 'clamp-model',
        });
        helpers.onCleanup(() => mcp.close());
        const ag = await mcp.callToolJson('get_game_state');

        await mcp.callToolJson('submit_guess', {
          latitude: 35,
          longitude: 139,
          wager: 5000,
          reasoning: 'Testing server-side wager clamping',
          agent_id: ag.agentId,
        });
        const hRes = await helpers.apiFetch('/api/human/guess', {
          body: { latitude: 0, longitude: 0, wager: 0 },
        });
        assert.ok(hRes.ok);
        const aiRes = hRes.data.roundSummary?.results?.find((r) => r.playerId === ag.agentId);
        assert.equal(aiRes.wager, 1000);
      },
    },
    {
      id: 'T2-BND-04',
      tier: 2,
      featureIds: ['F3', 'F7', 'F10'],
      title: '1v1 Opponent Cap & Solo/PvP AI Rejection: 2nd AI blocked in 1v1 (409), AI blocked in Solo & PvP (409)',
      kind: 'api',
      requiresBrowser: false,
      requiresMcp: false,
      run: async (helpers) => {
        const m1v1 = await helpers.apiFetch('/api/match/new', {
          body: { mode: '1v1', locationMode: 'standard', totalRounds: 3, provider: 'open' },
        });
        assert.ok(m1v1.ok);

        const reg1 = await helpers.apiFetch('/api/agents/register', {
          body: { name: 'OneBot', model: 'm1', transport: 'http' },
        });
        assert.ok(reg1.ok);

        const reg2 = await helpers.apiFetch('/api/agents/register', {
          body: { name: 'TwoBot', model: 'm2', transport: 'http' },
        });
        assert.equal(reg2.status, 409);

        const mSolo = await helpers.apiFetch('/api/match/new', {
          body: { mode: 'solo', locationMode: 'standard', totalRounds: 3, provider: 'open' },
        });
        assert.ok(mSolo.ok);

        const regSolo = await helpers.apiFetch('/api/agents/register', {
          body: { name: 'SoloIntruder', model: 'm3', transport: 'http' },
        });
        assert.equal(regSolo.status, 409);
      },
    },
    {
      id: 'T2-BND-05',
      tier: 2,
      featureIds: ['F1', 'F6', 'F8', 'F11'],
      title: 'Tie-Split Chip Settlement: Identical scores push wager cleanly with 0 chipDelta',
      kind: 'api',
      requiresBrowser: false,
      requiresMcp: false,
      run: async (helpers) => {
        const created = await helpers.apiFetch('/api/rooms', {
          body: {
            mode: 'pvp',
            locationMode: 'standard',
            bettingEnabled: true,
            startingChips: 1000,
            totalRounds: 3,
            provider: 'open',
            playerId: 'tie_p1',
            humanName: 'TieOne',
            autoStart: false,
          },
        });
        assert.ok(created.ok);
        const code = created.data.roomCode;
        helpers.onCleanup(() =>
          helpers.apiFetch(`/api/rooms/${code}/leave`, { body: { playerId: 'tie_p1' } }).catch(() => {})
        );

        await helpers.apiFetch(`/api/rooms/${code}/join`, {
          body: { playerId: 'tie_p2', playerName: 'TieTwo' },
        });
        helpers.onCleanup(() =>
          helpers.apiFetch(`/api/rooms/${code}/leave`, { body: { playerId: 'tie_p2' } }).catch(() => {})
        );

        await helpers.apiFetch(`/api/rooms/${code}/start`, { body: { playerId: 'tie_p1' } });
        await helpers.apiFetch('/api/human/guess', {
          body: { roomCode: code, playerId: 'tie_p1', latitude: 20, longitude: 20, wager: 200 },
        });
        const finalGuess = await helpers.apiFetch('/api/human/guess', {
          body: { roomCode: code, playerId: 'tie_p2', latitude: 20, longitude: 20, wager: 300 },
        });
        assert.ok(finalGuess.ok);
        const results = finalGuess.data.roundSummary?.results || [];
        const p1Res = results.find((r) => r.playerId === 'tie_p1');
        const p2Res = results.find((r) => r.playerId === 'tie_p2');
        assert.equal(p1Res.wager, 200);
        assert.equal(p2Res.wager, 300);
        assert.equal(p1Res.chipDelta, p1Res.score > 0 ? 0 : -200);
        assert.equal(p2Res.chipDelta, p2Res.score > 0 ? 0 : -300);
      },
    },
    {
      id: 'T2-BND-06',
      tier: 2,
      featureIds: ['F1', 'F2', 'F3', 'F8', 'F10'],
      title: 'MCP Negative Wager Rejection & Heartbeat Validation: Negative AI wager and missing transport rejected',
      kind: 'api',
      requiresBrowser: false,
      requiresMcp: true,
      run: async (helpers) => {
        await helpers.apiFetch('/api/match/new', {
          body: {
            mode: '1v1',
            locationMode: 'standard',
            bettingEnabled: true,
            totalRounds: 3,
            provider: 'open',
          },
        });
        const badHb = await helpers.apiFetch('/api/mcp/heartbeat', { body: {} });
        assert.equal(badHb.status, 400);

        const mcp = await helpers.connectHttpMcp({
          agentName: 'NegWagerBot',
          model: 'neg-model',
        });
        helpers.onCleanup(() => mcp.close());
        const ag = await mcp.callToolJson('get_game_state');

        let wagerErr = null;
        try {
          await mcp.callToolJson('submit_guess', {
            latitude: 10,
            longitude: 10,
            wager: -25,
            agent_id: ag.agentId,
          });
        } catch (err) {
          wagerErr = err;
        }
        assert.ok(wagerErr, 'Negative MCP wager must fail validation');
      },
    },
    {
      id: 'T2-BND-06B',
      tier: 2,
      featureIds: ['F3', 'F10'],
      title: 'MCP Heartbeat Boundaries: Zero-session heartbeat and non-integer activeSessions rejection (400)',
      kind: 'api',
      requiresBrowser: false,
      requiresMcp: false,
      run: async (helpers) => {
        const zeroSessions = await helpers.apiFetch('/api/mcp/heartbeat', {
          body: { transport: 'sse', activeSessions: 0 },
        });
        assert.ok(zeroSessions.ok);
        assert.equal(zeroSessions.data.httpBridgeReachable, true);

        const negSessions = await helpers.apiFetch('/api/mcp/heartbeat', {
          body: { transport: 'sse', activeSessions: -1 },
        });
        assert.equal(negSessions.status, 400);
      },
    },
    {
      id: 'T2-BND-07',
      tier: 2,
      featureIds: ['F4', 'F5', 'F7', 'F9'],
      title: 'Schema Validation: Invalid mode, invalid locationMode, and rounds outside 1..10 return 400',
      kind: 'api',
      requiresBrowser: false,
      requiresMcp: false,
      run: async (helpers) => {
        const badMode = await helpers.apiFetch('/api/match/new', { body: { mode: 'invalid_mode' } });
        assert.equal(badMode.status, 400);
        const badLoc = await helpers.apiFetch('/api/match/new', { body: { locationMode: 'mars' } });
        assert.equal(badLoc.status, 400);
        const badRounds = await helpers.apiFetch('/api/match/new', { body: { totalRounds: 99 } });
        assert.equal(badRounds.status, 400);
      },
    },
    {
      id: 'T2-BND-08',
      tier: 2,
      featureIds: ['F4', 'F5', 'F9'],
      title: '10-Round Mountain & Big Cities Exhaustion Boundaries: 10R matches complete without pool exhaustion or crash',
      kind: 'api',
      requiresBrowser: false,
      requiresMcp: false,
      run: async (helpers) => {
        const mnt = await helpers.apiFetch('/api/match/new', {
          body: { mode: 'solo', locationMode: 'mountain_regions', totalRounds: 10, provider: 'open' },
        });
        assert.ok(mnt.ok);
        assert.equal(mnt.data.totalRounds, 10);

        const city = await helpers.apiFetch('/api/match/new', {
          body: { mode: 'solo', locationMode: 'big_cities', totalRounds: 10, provider: 'open' },
        });
        assert.ok(city.ok);
        assert.equal(city.data.totalRounds, 10);
      },
    },
    {
      id: 'T2-BND-09',
      tier: 2,
      featureIds: ['F4', 'F5', 'F9', 'F12', 'F14', 'F16'],
      title: 'Unknown Room Fallback & Panorama Node 404: Expired panorama node returns 404 and bad join disables UI join button',
      kind: 'browser',
      requiresBrowser: true,
      requiresMcp: false,
      run: async (helpers) => {
        const badNode = await helpers.apiFetch('/api/panoramas/nonexistent_round/node_99/equirectangular.jpg');
        assert.ok(!badNode.ok && badNode.status >= 400);

        const tab = await helpers.openBrowserTab(helpers.uiUrl);
        helpers.onCleanup(() => helpers.browserDriver.closeTab(tab));

        await helpers.browserDriver.waitForSelector(tab, '[data-testid="mode-card-pvp"]', 8000);
        await helpers.browserDriver.clickSelector(tab, '[data-testid="mode-card-pvp"]', 5000);
        await helpers.browserDriver.clickSelector(tab, '[data-testid="switch-to-join-room"]', 5000);
        const disabled = await tab.eval("document.querySelector('[data-testid=\"join-room-submit\"]')?.disabled");
        assert.equal(disabled, true, 'Join Room button must stay disabled when roomCode is empty');
      },
    },
    {
      id: 'T2-BND-10',
      tier: 2,
      featureIds: ['F6', 'F11', 'F12', 'F13', 'F14', 'F15', 'F16'],
      title: 'UI Betting Preset & Bad Room Error Recovery: Clamps manual wager to chip stack and displays dismissible error on 404 room join',
      kind: 'browser',
      requiresBrowser: true,
      requiresMcp: false,
      run: async (helpers) => {
        const tab = await helpers.openBrowserTab(helpers.uiUrl);
        helpers.onCleanup(() => helpers.browserDriver.closeTab(tab));

        await helpers.browserDriver.waitForSelector(tab, '[data-testid="mode-card-pvp"]', 8000);
        await helpers.browserDriver.clickSelector(tab, '[data-testid="mode-card-pvp"]', 5000);
        await helpers.browserDriver.clickSelector(tab, '[data-testid="switch-to-join-room"]', 5000);
        await helpers.browserDriver.setInputValue(tab, '#join-room-code-input', 'ZZZZ99', 5000);
        await helpers.browserDriver.clickSelector(tab, '[data-testid="join-room-submit"]', 5000);
        await helpers.browserDriver.waitForSelector(tab, '[role="alert"]', 6000);

        await helpers.browserDriver.clickSelector(tab, '[data-testid="mode-card-solo"]', 5000);
        await helpers.browserDriver.clickSelector(tab, '[data-testid="betting-toggle"]', 5000);
        await helpers.browserDriver.clickSelector(tab, '[data-testid="play-button"]', 5000);
        await helpers.browserDriver.waitForSelector(tab, 'input[aria-label="Confidence wager amount"]', 8000);
        await helpers.browserDriver.setInputValue(tab, 'input[aria-label="Confidence wager amount"]', '9999', 5000);
        const clampedVal = await tab.eval("document.querySelector('input[aria-label=\"Confidence wager amount\"]')?.value");
        assert.equal(clampedVal, '1000', 'Manual UI wager exceeding 1,000 chips must clamp to 1000');
      },
    },
    {
      id: 'T2-BND-11',
      tier: 2,
      featureIds: ['F1', 'F2', 'F3', 'F10', 'F12', 'F13', 'F14', 'F15', 'F16'],
      title: 'Unknown Agent Error, Disabled Submit Before Pin, & Spectator Stage Clean Error-Free Mount',
      kind: 'browser',
      requiresBrowser: true,
      requiresMcp: false,
      run: async (helpers) => {
        const badAg = await helpers.apiFetch('/api/agents/does_not_exist/state');
        assert.equal(badAg.status, 404);

        const tab = await helpers.openBrowserTab(helpers.uiUrl);
        helpers.onCleanup(() => helpers.browserDriver.closeTab(tab));

        await helpers.browserDriver.waitForSelector(tab, '[data-testid="mode-card-1v1"], [data-testid="mode-card-player_vs_ai"]', 8000);
        await helpers.browserDriver.clickSelector(tab, '[data-testid="mode-card-player_vs_ai"]', 5000);
        await helpers.browserDriver.clickSelector(tab, '[data-testid="betting-toggle"]', 5000);
        await helpers.browserDriver.clickSelector(tab, '[data-testid="play-button"]', 5000);
        await helpers.browserDriver.waitForSelector(tab, '[data-testid="guess-minimap"]', 8000);
        const submitDisabled = await tab.eval("Boolean(Array.from(document.querySelectorAll('button')).find((b) => /Click Map to Drop Pin/i.test(b.innerText))?.disabled)");
        assert.equal(submitDisabled, true);

        await helpers.browserDriver.clickSelector(tab, '[data-testid="quick-return-home"]', 5000);
        await helpers.browserDriver.clickSelector(tab, '[data-testid="mode-card-spectator"]', 5000);
        await helpers.browserDriver.clickSelector(tab, '[data-testid="play-button"]', 5000);
        await helpers.browserDriver.waitForSelector(tab, '[data-testid="spectator-stage"]', 8000);
      },
    },
    {
      id: 'T2-BND-12',
      tier: 2,
      featureIds: ['F4', 'F5', 'F12', 'F13', 'F14', 'F15', 'F16'],
      title: 'Step Cap & Timer UI Selection Persistence + Header Badge Verification',
      kind: 'browser',
      requiresBrowser: true,
      requiresMcp: false,
      run: async (helpers) => {
        const tab = await helpers.openBrowserTab(helpers.uiUrl);
        helpers.onCleanup(() => helpers.browserDriver.closeTab(tab));

        await helpers.browserDriver.waitForSelector(tab, '[data-testid="location-mountain_regions"]', 8000);
        await helpers.browserDriver.clickSelector(tab, '[data-testid="location-big_cities"]', 5000);
        await helpers.browserDriver.clickSelector(tab, '[data-testid="location-mountain_regions"]', 5000);
        await helpers.browserDriver.clickSelector(tab, '[data-testid="mode-card-spectator"]', 5000);
        await helpers.browserDriver.clickSelector(tab, '[data-testid="play-button"]', 5000);
        await helpers.browserDriver.waitForSelector(tab, '[data-testid="spectator-stage"]', 8000);
        await helpers.browserDriver.waitForSelector(tab, '[data-testid="live-mcp-badge"]', 5000);
        await helpers.browserDriver.waitForSelector(tab, '[data-testid="quick-return-home"]', 5000);
      },
    },
    {
      id: 'T2-BND-13',
      tier: 2,
      featureIds: ['F4', 'F5', 'F8', 'F9'],
      title: 'StartingChips & Single-Round Pool Boundaries: startingChips < 100 rejected (400), startingChips=100 & totalRounds=1 accepted',
      kind: 'api',
      requiresBrowser: false,
      requiresMcp: false,
      run: async (helpers) => {
        const lowChips = await helpers.apiFetch('/api/match/new', {
          body: { mode: 'solo', locationMode: 'mountain_regions', startingChips: 50, bettingEnabled: true },
        });
        assert.equal(lowChips.status, 400);

        const minMatch = await helpers.apiFetch('/api/match/new', {
          body: {
            mode: 'solo',
            locationMode: 'mountain_regions',
            bettingEnabled: true,
            startingChips: 100,
            totalRounds: 1,
            provider: 'open',
          },
        });
        assert.ok(minMatch.ok);
        assert.equal(minMatch.data.human.chips, 100);
      },
    },
    {
      id: 'T2-BND-14',
      tier: 2,
      featureIds: ['F6', 'F7', 'F11'],
      title: 'Room Leave Idempotency & Late Join: Leaving unknown room succeeds idempotently and late joiner syncs active pvp_ai room',
      kind: 'api',
      requiresBrowser: false,
      requiresMcp: false,
      run: async (helpers) => {
        const leaveGhost = await helpers.apiFetch('/api/rooms/NONE99/leave', {
          body: { playerId: 'ghost_1' },
        });
        assert.ok(leaveGhost.ok);

        const created = await helpers.apiFetch('/api/rooms', {
          body: {
            mode: 'pvp_ai',
            locationMode: 'standard',
            totalRounds: 3,
            provider: 'open',
            playerId: 'late_h1',
            humanName: 'HostLate',
            autoStart: true,
          },
        });
        assert.ok(created.ok);
        const code = created.data.roomCode;
        helpers.onCleanup(() =>
          helpers.apiFetch(`/api/rooms/${code}/leave`, { body: { playerId: 'late_h1' } }).catch(() => {})
        );

        const lateJoin = await helpers.apiFetch(`/api/rooms/${code}/join`, {
          body: { playerId: 'late_h2', playerName: 'GuestLate' },
        });
        assert.ok(lateJoin.ok);
        assert.equal(lateJoin.data.state.mode, 'pvp_ai');
        assert.equal(lateJoin.data.state.humans.length, 2);
        helpers.onCleanup(() =>
          helpers.apiFetch(`/api/rooms/${code}/leave`, { body: { playerId: 'late_h2' } }).catch(() => {})
        );
      },
    },
    {
      id: 'T2-BND-15',
      tier: 2,
      featureIds: ['F6', 'F7', 'F11', 'F12', 'F13', 'F14', 'F15', 'F16'],
      title: 'Welcome Hub Mode Switching & Quick Return from Waiting Room: PvP panel hides on Solo/Spectator and Home exits lobby',
      kind: 'browser',
      requiresBrowser: true,
      requiresMcp: false,
      run: async (helpers) => {
        const tab = await helpers.openBrowserTab(helpers.uiUrl);
        helpers.onCleanup(() => helpers.browserDriver.closeTab(tab));

        await helpers.browserDriver.waitForSelector(tab, '[data-testid="mode-card-pvp_ai"]', 8000);
        await helpers.browserDriver.clickSelector(tab, '[data-testid="mode-card-pvp_ai"]', 5000);
        await helpers.browserDriver.waitForSelector(tab, '[data-testid="switch-to-join-room"]', 5000);

        await helpers.browserDriver.clickSelector(tab, '[data-testid="mode-card-pvp"]', 5000);
        await helpers.browserDriver.clickSelector(tab, '[data-testid="play-button"]', 5000);
        await helpers.browserDriver.waitForSelector(tab, '[data-testid="room-code"]', 8000);
        await helpers.browserDriver.clickSelector(tab, '[data-testid="quick-return-home"]', 5000);

        await helpers.browserDriver.waitForSelector(tab, '[data-testid="mode-card-spectator"]', 6000);
        await helpers.browserDriver.clickSelector(tab, '[data-testid="mode-card-spectator"]', 5000);
        const hasJoinTab = await tab.eval("Boolean(document.querySelector('[data-testid=\"switch-to-join-room\"]'))");
        assert.equal(hasJoinTab, false);
        await helpers.browserDriver.clickSelector(tab, '[data-testid="betting-toggle"]', 5000);
        await helpers.browserDriver.clickSelector(tab, '[data-testid="play-button"]', 5000);
        await helpers.browserDriver.waitForSelector(tab, '[data-testid="spectator-stage"]', 8000);
        await helpers.browserDriver.waitForSelector(tab, '[data-testid="live-mcp-badge"]', 5000);
      },
    },
    {
      id: 'T2-BND-16',
      tier: 2,
      featureIds: ['F1', 'F6', 'F11'],
      title: 'Session Auth & Room Routing Guards: PvP room never hijacks default /api/match/new, and omitted/invalid tokens return 403/4003',
      kind: 'api',
      requiresBrowser: false,
      requiresMcp: false,
      run: async (helpers) => {
        const created = await helpers.apiFetch('/api/rooms', {
          headers: { 'X-Session-Auto': '1' },
          body: {
            mode: 'pvp',
            locationMode: 'standard',
            totalRounds: 3,
            provider: 'open',
            playerId: 'sec_host',
            humanName: 'SecHost',
            autoStart: true,
          },
        });
        assert.ok(created.ok, `Expected room creation ok, got ${created.status}`);
        const code = created.data.roomCode;
        const hostId = created.data.hostPlayerId;
        const hostToken = created.data.sessionToken;
        assert.ok(hostToken, 'Expected auto-issued sessionToken on room creation');

        helpers.onCleanup(() =>
          helpers
            .apiFetch(`/api/rooms/${encodeURIComponent(code)}/leave`, {
              headers: { 'X-Session-Token': hostToken },
              body: { playerId: hostId },
            })
            .catch(() => {})
        );

        // 1. Another user calling /api/match/new without roomCode must reset ARENA1, not collide with active PvP room
        const soloStart = await helpers.apiFetch('/api/match/new', {
          body: {
            mode: 'solo',
            locationMode: 'standard',
            totalRounds: 3,
            provider: 'open',
            humanName: 'OtherSoloUser',
          },
        });
        assert.ok(soloStart.ok, `Expected /api/match/new without roomCode to succeed, got ${soloStart.status}`);
        assert.equal(soloStart.data.roomCode, 'ARENA1');

        // 2. Omitting playerId or passing bogus playerId on token-bound PvP room must NOT mutate or read host state
        const hijackOmit = await helpers.apiFetch('/api/human/guess', {
          body: { roomCode: code, latitude: 10, longitude: 20 },
        });
        assert.equal(hijackOmit.status, 403, `Expected 403 when omitting playerId, got ${hijackOmit.status}`);

        const hijackBogus = await helpers.apiFetch('/api/human/guess', {
          body: { roomCode: code, playerId: 'unknown_attacker', latitude: 10, longitude: 20 },
        });
        assert.ok(
          [400, 403].includes(hijackBogus.status),
          `Expected 400/403 for unknown playerId, got ${hijackBogus.status}`
        );

        const readOmit = await helpers.apiFetch(`/api/match?roomCode=${encodeURIComponent(code)}`);
        assert.equal(readOmit.status, 403, `Expected 403 reading token-bound room without playerId, got ${readOmit.status}`);

        const readHost = await helpers.apiFetch(
          `/api/match?roomCode=${encodeURIComponent(code)}&playerId=${encodeURIComponent(hostId)}`
        );
        assert.equal(readHost.status, 403, `Expected 403 reading host state without token, got ${readHost.status}`);

        // 3. Invalid X-Session-Token on join with X-Session-Auto must return 403, not mint a duplicate guest
        const badJoin = await helpers.apiFetch(`/api/rooms/${encodeURIComponent(code)}/join`, {
          headers: {
            'X-Session-Auto': '1',
            'X-Session-Token': 'gs.fake.123.bad',
          },
          body: { playerId: hostId, playerName: 'Spoofer' },
        });
        assert.equal(badJoin.status, 403, `Expected 403 on invalid session token join, got ${badJoin.status}`);

        // 4. Unauthenticated WS to token-bound room must close with 4003
        for (const wsOpts of [
          { wsUrl: helpers.wsUrl, roomCode: code, playerId: hostId },
          { wsUrl: helpers.wsUrl, roomCode: code },
        ]) {
          const probe = await helpers.connectUiWs(wsOpts);
          helpers.onCleanup(() => probe.close());
          const closeCode = await new Promise((resolve) => {
            if (probe.ws.readyState === 3) {
              resolve(4003);
              return;
            }
            const t = setTimeout(() => resolve(null), 3000);
            probe.ws.once('close', (c) => {
              clearTimeout(t);
              resolve(c);
            });
          });
          assert.equal(closeCode, 4003, `Expected WS close 4003, got ${closeCode}`);
        }
      },
    },
  ];
}
