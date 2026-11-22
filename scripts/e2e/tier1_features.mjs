import assert from 'node:assert/strict';

const ALL_FEATURES = Array.from({ length: 16 }, (_, i) => `F${i + 1}`);

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
      id: 'T1-F1-01',
      tier: 1,
      featureIds: ALL_FEATURES,
      title: 'Shared Contracts: PublicGameState exposes expanded GameMode, LocationMode, betting & MCP status fields',
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
        assert.equal(s.roundSummary, null, 'Active round must not leak roundSummary target coordinates');
        helpers.assertNoSecretLeak(res.text, 'T1-F1-01 /api/match/new');
      },
    },
    {
      id: 'T1-F2-01',
      tier: 1,
      featureIds: ALL_FEATURES,
      title: 'MCP submit_guess accepts optional wager and MCP heartbeat marks bridge_ready/connected',
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
      id: 'T1-F4-01',
      tier: 1,
      featureIds: ALL_FEATURES,
      title: 'Mountain Regions & Big Cities location pools filter round targets without city/mountain bleed',
      kind: 'api',
      requiresBrowser: false,
      requiresMcp: false,
      run: async (helpers) => {
        const mntStart = await helpers.apiFetch('/api/match/new', {
          body: {
            mode: 'solo',
            locationMode: 'mountain_regions',
            bettingEnabled: false,
            totalRounds: 3,
            provider: 'open',
            humanName: 'MountainTester',
          },
        });
        assert.ok(mntStart.ok);
        const mntGuess = await helpers.apiFetch('/api/human/guess', {
          body: { latitude: 46.59, longitude: 7.9 },
        });
        assert.ok(mntGuess.ok);
        const mntTarget = mntGuess.data.roundSummary?.target;
        assert.ok(mntTarget, 'Expected roundSummary after solo guess');
        assert.ok(
          !BIG_CITY_NAMES.has(mntTarget.city),
          `Mountain Regions Only returned big city ${mntTarget.city}`
        );

        const cityStart = await helpers.apiFetch('/api/match/new', {
          body: {
            mode: 'solo',
            locationMode: 'big_cities',
            bettingEnabled: false,
            totalRounds: 3,
            provider: 'open',
            humanName: 'CityTester',
          },
        });
        assert.ok(cityStart.ok);
        const cityGuess = await helpers.apiFetch('/api/human/guess', {
          body: { latitude: 48.85, longitude: 2.35 },
        });
        assert.ok(cityGuess.ok);
        const cityTarget = cityGuess.data.roundSummary?.target;
        assert.ok(cityTarget, 'Expected roundSummary after solo guess');
        assert.ok(
          BIG_CITY_NAMES.has(cityTarget.city),
          `Big Cities Only returned non-city ${cityTarget.city}`
        );
      },
    },
    {
      id: 'T1-F6-01',
      tier: 1,
      featureIds: ALL_FEATURES,
      title: 'Room creation, multi-human join, start, and WebSocket room-scoped state_sync',
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
      id: 'T1-F9-01',
      tier: 1,
      featureIds: ALL_FEATURES,
      title: 'Welcome Hub two-step flow, Top HUD badges, and Arena controls render cleanly in browser',
      kind: 'browser',
      requiresBrowser: true,
      requiresMcp: false,
      run: async (helpers) => {
        const tab = await helpers.openBrowserTab(helpers.uiUrl);
        helpers.onCleanup(() => helpers.browserDriver.closeTab(tab));

        await helpers.browserDriver.waitForSelector(tab, '[data-testid="mode-card-solo"]', 10000);
        await helpers.browserDriver.clickSelector(tab, '[data-testid="mode-card-solo"]', 5000);
        await helpers.browserDriver.waitForSelector(tab, '[data-testid="location-big_cities"]', 6000);
        await helpers.browserDriver.clickSelector(tab, '[data-testid="betting-toggle"]', 5000);
        await helpers.browserDriver.clickSelector(tab, '[data-testid="rounds-3"]', 5000);
        await helpers.browserDriver.clickSelector(tab, '[data-testid="play-button"]', 5000);

        await helpers.browserDriver.waitForSelector(tab, '[data-testid="quick-return-home"]', 10000);
        await helpers.browserDriver.waitForSelector(tab, '[data-testid="live-mcp-badge"]', 6000);
        await helpers.browserDriver.waitForSelector(tab, 'input[aria-label="Confidence wager amount"]', 6000);

        const { consoleErrors, pageErrors } = helpers.browserDriver.getErrors(tab);
        assert.deepEqual(pageErrors, []);
        assert.deepEqual(consoleErrors, []);
      },
    },
  ];
}
