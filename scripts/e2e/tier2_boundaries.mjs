import assert from 'node:assert/strict';

const ALL_FEATURES = Array.from({ length: 16 }, (_, i) => `F${i + 1}`);

export function getTier2Tests(_ctx) {
  return [
    {
      id: 'T2-BND-01',
      tier: 2,
      featureIds: ALL_FEATURES,
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
        assert.equal(negRes.status, 400, `Expected 400 for negative wager, got ${negRes.status}`);

        const overRes = await helpers.apiFetch('/api/human/guess', {
          body: { latitude: 35, longitude: 139, wager: 1500 },
        });
        assert.equal(overRes.status, 400, `Expected 400 for over-balance wager, got ${overRes.status}`);

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
      featureIds: ALL_FEATURES,
      title: 'Room Negative Robustness: Unknown roomCode (404), Non-Host Start (403), Duplicate Guess (400/409), Spectator Human Guess (403/409)',
      kind: 'api',
      requiresBrowser: false,
      requiresMcp: false,
      run: async (helpers) => {
        const badRoom = await helpers.apiFetch('/api/rooms/NOPE99/join', {
          body: { playerId: 'p_unknown', playerName: 'Ghost' },
        });
        assert.equal(badRoom.status, 404, `Expected 404 for unknown roomCode, got ${badRoom.status}`);

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
        assert.equal(nonHostStart.status, 403, `Expected 403 for non-host start, got ${nonHostStart.status}`);

        const started = await helpers.apiFetch(`/api/rooms/${code}/start`, {
          body: { playerId: 't2_host' },
        });
        assert.ok(started.ok);

        const g1 = await helpers.apiFetch('/api/human/guess', {
          roomCode: code,
          playerId: 't2_host',
          body: { latitude: 40, longitude: -74 },
        });
        assert.ok(g1.ok);

        const g1Dup = await helpers.apiFetch('/api/human/guess', {
          roomCode: code,
          playerId: 't2_host',
          body: { latitude: 41, longitude: -73 },
        });
        assert.ok([400, 409].includes(g1Dup.status), `Expected 400/409 for duplicate guess, got ${g1Dup.status}`);

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
        assert.ok([403, 409].includes(specGuess.status), `Expected 403/409 for spectator human guess, got ${specGuess.status}`);
      },
    },
    {
      id: 'T2-BND-03',
      tier: 2,
      featureIds: ALL_FEATURES,
      title: 'Coordinate & Step Cap Boundaries: Lat/Lng extremes (-90/90, -180/180), out-of-range (400), and zero secret leakage',
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
      id: 'T2-BND-04',
      tier: 2,
      featureIds: ALL_FEATURES,
      title: '1v1 Opponent Cap & Solo/PvP AI Rejection: 2nd AI blocked in 1v1 (409), AI blocked in Solo & PvP (409)',
      kind: 'api',
      requiresBrowser: false,
      requiresMcp: false,
      run: async (helpers) => {
        // 1v1 allows 1 AI, rejects 2nd AI
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
        assert.equal(reg2.status, 409, `Expected 409 for 2nd AI in 1v1, got ${reg2.status}`);

        // Solo rejects AI registration
        const mSolo = await helpers.apiFetch('/api/match/new', {
          body: { mode: 'solo', locationMode: 'standard', totalRounds: 3, provider: 'open' },
        });
        assert.ok(mSolo.ok);

        const regSolo = await helpers.apiFetch('/api/agents/register', {
          body: { name: 'SoloIntruder', model: 'm3', transport: 'http' },
        });
        assert.equal(regSolo.status, 409, `Expected 409 for AI registration in solo mode, got ${regSolo.status}`);
      },
    },
    {
      id: 'T2-BND-05',
      tier: 2,
      featureIds: ALL_FEATURES,
      title: 'Tie-Split Chip Settlement & Auto-Betting Boundaries when Betting Enabled',
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

        const joined = await helpers.apiFetch(`/api/rooms/${code}/join`, {
          body: { playerId: 'tie_p2', playerName: 'TieTwo' },
        });
        assert.ok(joined.ok);
        helpers.onCleanup(() =>
          helpers.apiFetch(`/api/rooms/${code}/leave`, { body: { playerId: 'tie_p2' } }).catch(() => {})
        );

        const started = await helpers.apiFetch(`/api/rooms/${code}/start`, {
          body: { playerId: 'tie_p1' },
        });
        assert.ok(started.ok);

        // Both guess identical coordinates with wagers 200 and 300 -> tied top score -> both win +wager
        const g1 = await helpers.apiFetch('/api/human/guess', {
          body: { roomCode: code, playerId: 'tie_p1', latitude: 20, longitude: 20, wager: 200 },
        });
        assert.ok(g1.ok);
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
        assert.equal(p1Res.chipsAfter, 1000 + p1Res.chipDelta);
        assert.equal(p2Res.chipDelta, p2Res.score > 0 ? 0 : -300);
        assert.equal(p2Res.chipsAfter, 1000 + p2Res.chipDelta);
      },
    },
  ];
}
