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

const PAIRWISE_CASES = [
  {
    id: 'T3-PW-01',
    mode: '1v1',
    locationMode: 'standard',
    bettingEnabled: true,
    totalRounds: 5,
    timer: 'timed',
    provider: 'open',
    mcpTransport: 'stdio',
    featureIds: ['F1', 'F2', 'F3', 'F7', 'F8', 'F9'],
    title: 'Pairwise: 1v1 + standard + betting on + 5R + timed + open + stdio',
  },
  {
    id: 'T3-PW-02',
    mode: '1v1',
    locationMode: 'big_cities',
    bettingEnabled: true,
    totalRounds: 10,
    timer: 'none',
    provider: 'auto',
    mcpTransport: 'streamable-http',
    featureIds: ['F1', 'F2', 'F3', 'F4', 'F5', 'F7', 'F8'],
    title: 'Pairwise: 1v1 + big_cities + betting on + 10R + no timer + auto + streamable-http',
  },
  {
    id: 'T3-PW-03',
    mode: '1v1',
    locationMode: 'mountain_regions',
    bettingEnabled: false,
    totalRounds: 3,
    timer: 'none',
    provider: 'wikimedia',
    mcpTransport: 'sse',
    featureIds: ['F1', 'F3', 'F4', 'F5', 'F7', 'F8'],
    title: 'Pairwise: 1v1 + mountain_regions + betting off + 3R + no timer + wikimedia + sse',
  },
  {
    id: 'T3-PW-04',
    mode: 'ffa',
    locationMode: 'standard',
    bettingEnabled: true,
    totalRounds: 3,
    timer: 'timed',
    provider: 'wikimedia',
    mcpTransport: 'streamable-http',
    featureIds: ['F1', 'F2', 'F3', 'F5', 'F7', 'F8', 'F9'],
    title: 'Pairwise: ffa + standard + betting on + 3R + timed + wikimedia + streamable-http',
  },
  {
    id: 'T3-PW-05',
    mode: 'ffa',
    locationMode: 'big_cities',
    bettingEnabled: false,
    totalRounds: 10,
    timer: 'timed',
    provider: 'open',
    mcpTransport: 'sse',
    featureIds: ['F1', 'F3', 'F4', 'F5', 'F7', 'F9'],
    title: 'Pairwise: ffa + big_cities + betting off + 10R + timed + open + sse',
  },
  {
    id: 'T3-PW-06',
    mode: 'ffa',
    locationMode: 'mountain_regions',
    bettingEnabled: true,
    totalRounds: 5,
    timer: 'none',
    provider: 'auto',
    mcpTransport: 'stdio',
    featureIds: ['F1', 'F2', 'F3', 'F4', 'F5', 'F7', 'F8'],
    title: 'Pairwise: ffa + mountain_regions + betting on + 5R + no timer + auto + stdio',
  },
  {
    id: 'T3-PW-07',
    mode: 'pvp_ai',
    locationMode: 'standard',
    bettingEnabled: false,
    totalRounds: 5,
    timer: 'none',
    provider: 'auto',
    mcpTransport: 'sse',
    featureIds: ['F1', 'F3', 'F5', 'F6', 'F7', 'F9'],
    title: 'Pairwise: pvp_ai + standard + betting off + 5R + no timer + auto + sse',
  },
  {
    id: 'T3-PW-08',
    mode: 'pvp_ai',
    locationMode: 'big_cities',
    bettingEnabled: false,
    totalRounds: 3,
    timer: 'timed',
    provider: 'wikimedia',
    mcpTransport: 'stdio',
    featureIds: ['F1', 'F3', 'F4', 'F5', 'F6', 'F7', 'F9'],
    title: 'Pairwise: pvp_ai + big_cities + betting off + 3R + timed + wikimedia + stdio',
  },
  {
    id: 'T3-PW-09',
    mode: 'pvp_ai',
    locationMode: 'mountain_regions',
    bettingEnabled: true,
    totalRounds: 10,
    timer: 'timed',
    provider: 'open',
    mcpTransport: 'streamable-http',
    featureIds: ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9'],
    title: 'Pairwise: pvp_ai + mountain_regions + betting on + 10R + timed + open + streamable-http',
  },
  {
    id: 'T3-PW-10',
    mode: 'pvp',
    locationMode: 'standard',
    bettingEnabled: false,
    totalRounds: 10,
    timer: 'timed',
    provider: 'open',
    mcpTransport: 'none',
    featureIds: ['F1', 'F5', 'F6', 'F7', 'F9'],
    title: 'Pairwise: pvp + standard + betting off + 10R + timed + open + none',
  },
  {
    id: 'T3-PW-11',
    mode: 'pvp',
    locationMode: 'big_cities',
    bettingEnabled: true,
    totalRounds: 3,
    timer: 'none',
    provider: 'auto',
    mcpTransport: 'none',
    featureIds: ['F1', 'F4', 'F5', 'F6', 'F7', 'F8'],
    title: 'Pairwise: pvp + big_cities + betting on + 3R + no timer + auto + none',
  },
  {
    id: 'T3-PW-12',
    mode: 'pvp',
    locationMode: 'mountain_regions',
    bettingEnabled: true,
    totalRounds: 5,
    timer: 'none',
    provider: 'wikimedia',
    mcpTransport: 'none',
    featureIds: ['F1', 'F4', 'F5', 'F6', 'F7', 'F8'],
    title: 'Pairwise: pvp + mountain_regions + betting on + 5R + no timer + wikimedia + none',
  },
  {
    id: 'T3-PW-13',
    mode: 'solo',
    locationMode: 'standard',
    bettingEnabled: true,
    totalRounds: 10,
    timer: 'none',
    provider: 'wikimedia',
    mcpTransport: 'none',
    featureIds: ['F1', 'F5', 'F7', 'F8'],
    title: 'Pairwise: solo + standard + betting on + 10R + no timer + wikimedia + none',
  },
  {
    id: 'T3-PW-14',
    mode: 'solo',
    locationMode: 'big_cities',
    bettingEnabled: false,
    totalRounds: 5,
    timer: 'timed',
    provider: 'open',
    mcpTransport: 'none',
    featureIds: ['F1', 'F4', 'F5', 'F7', 'F9'],
    title: 'Pairwise: solo + big_cities + betting off + 5R + timed + open + none',
  },
  {
    id: 'T3-PW-15',
    mode: 'solo',
    locationMode: 'mountain_regions',
    bettingEnabled: false,
    totalRounds: 3,
    timer: 'none',
    provider: 'auto',
    mcpTransport: 'none',
    featureIds: ['F1', 'F4', 'F5', 'F7'],
    title: 'Pairwise: solo + mountain_regions + betting off + 3R + no timer + auto + none',
  },
  {
    id: 'T3-PW-16',
    mode: 'spectator',
    locationMode: 'standard',
    bettingEnabled: true,
    totalRounds: 10,
    timer: 'timed',
    provider: 'auto',
    mcpTransport: 'stdio',
    featureIds: ['F1', 'F2', 'F3', 'F5', 'F7', 'F8', 'F9'],
    title: 'Pairwise: spectator + standard + betting on + 10R + timed + auto + stdio',
  },
  {
    id: 'T3-PW-17',
    mode: 'spectator',
    locationMode: 'big_cities',
    bettingEnabled: false,
    totalRounds: 5,
    timer: 'timed',
    provider: 'wikimedia',
    mcpTransport: 'streamable-http',
    featureIds: ['F1', 'F3', 'F4', 'F5', 'F7', 'F9'],
    title: 'Pairwise: spectator + big_cities + betting off + 5R + timed + wikimedia + streamable-http',
  },
  {
    id: 'T3-PW-18',
    mode: 'spectator',
    locationMode: 'mountain_regions',
    bettingEnabled: true,
    totalRounds: 3,
    timer: 'none',
    provider: 'open',
    mcpTransport: 'sse',
    featureIds: ['F1', 'F2', 'F3', 'F4', 'F5', 'F7', 'F8'],
    title: 'Pairwise: spectator + mountain_regions + betting on + 3R + no timer + open + sse',
  },
];

async function connectMcpByTransport(helpers, transport, { agentName, model, roomCode }) {
  if (transport === 'stdio') {
    const client = await helpers.connectStdioMcp({
      backendUrl: helpers.baseUrl,
      agentName,
      model,
    });
    helpers.onCleanup(() => client.close());
    return client;
  }
  if (transport === 'streamable-http') {
    const client = await helpers.connectHttpMcp({
      mcpHttpUrl: helpers.mcpHttpUrl,
      agentName,
      model,
      roomCode,
    });
    helpers.onCleanup(() => client.close());
    assert.ok(client.sessionId, 'Streamable HTTP MCP client must expose sessionId');
    return client;
  }
  if (transport === 'sse') {
    const client = await helpers.connectSseMcp({
      mcpHttpUrl: helpers.mcpHttpUrl,
      agentName,
      model,
      roomCode,
    });
    helpers.onCleanup(() => client.close());
    return client;
  }
  throw new Error(`Unsupported MCP transport: ${transport}`);
}

function assertTargetMatchesLocationMode(target, locationMode, caseId) {
  assert.ok(target && typeof target === 'object', `${caseId}: missing round summary target`);
  assert.ok(typeof target.name === 'string' && target.name.trim().length > 0, `${caseId}: empty target.name`);
  assert.ok(typeof target.city === 'string' && target.city.trim().length > 0, `${caseId}: empty target.city`);
  assert.ok(
    typeof target.latitude === 'number' && target.latitude >= -90 && target.latitude <= 90,
    `${caseId}: invalid target.latitude ${target.latitude}`
  );
  assert.ok(
    typeof target.longitude === 'number' && target.longitude >= -180 && target.longitude <= 180,
    `${caseId}: invalid target.longitude ${target.longitude}`
  );

  if (locationMode === 'big_cities') {
    assert.ok(
      BIG_CITY_NAMES.has(target.city),
      `${caseId}: big_cities returned non-city target "${target.name}" (city="${target.city}")`
    );
    assert.notEqual(
      target.city,
      'Lauterbrunnen',
      `${caseId}: big_cities must never return Lauterbrunnen`
    );
  } else if (locationMode === 'mountain_regions') {
    assert.ok(
      !BIG_CITY_NAMES.has(target.city),
      `${caseId}: mountain_regions returned big-city target "${target.name}" (city="${target.city}")`
    );
  }
}

function assertProviderValid(state, providerChoice, caseId) {
  if (providerChoice === 'open' || providerChoice === 'auto') {
    assert.equal(
      state.activeLocationProvider,
      'open-procedural-360',
      `${caseId}: expected open-procedural-360 fallback for provider=${providerChoice}, got ${state.activeLocationProvider}`
    );
  } else if (providerChoice === 'wikimedia') {
    assert.ok(
      ['wikimedia-commons', 'open-procedural-360'].includes(state.activeLocationProvider),
      `${caseId}: unexpected activeLocationProvider for wikimedia: ${state.activeLocationProvider}`
    );
  }
}

async function runPairwiseCase(spec, helpers) {
  const roundDurationSec = spec.timer === 'timed' ? 60 : null;
  const startingChips = 1000;
  const apiTimeoutMs = spec.provider === 'wikimedia' ? 25000 : 12000;
  const isMultiHuman = spec.mode === 'pvp' || spec.mode === 'pvp_ai';

  const p1Id = helpers.uniquePlayerId('pw1');
  const p2Id = isMultiHuman ? helpers.uniquePlayerId('pw2') : null;

  let roomCode;
  let state;
  let ws1;
  let ws2 = null;

  if (isMultiHuman) {
    const createRes = await helpers.apiFetch('/api/rooms', {
      baseUrl: helpers.baseUrl,
      timeoutMs: apiTimeoutMs,
      body: {
        mode: spec.mode,
        locationMode: spec.locationMode,
        bettingEnabled: spec.bettingEnabled,
        startingChips,
        totalRounds: spec.totalRounds,
        roundDurationSec,
        provider: spec.provider,
        humanName: `${spec.id}-Host`,
        playerId: p1Id,
        autoStart: false,
        autoPlayEnabled: false,
        selectedModels: [],
      },
    });
    assert.ok(createRes.ok, `${spec.id}: POST /api/rooms failed (${createRes.status}): ${createRes.text}`);
    roomCode = createRes.data.roomCode;
    assert.ok(typeof roomCode === 'string' && roomCode.length > 0, `${spec.id}: missing roomCode`);
    assert.equal(createRes.data.state.matchStatus, 'lobby', `${spec.id}: expected initial lobby state`);
    assert.equal(createRes.data.state.humans.length, 1);
    assert.equal(createRes.data.state.humans[0].isHost, true);

    helpers.onCleanup(() =>
      helpers
        .apiFetch(`/api/rooms/${encodeURIComponent(roomCode)}/leave`, {
          baseUrl: helpers.baseUrl,
          body: { playerId: p1Id },
        })
        .catch(() => {})
    );

    const joinRes = await helpers.apiFetch(`/api/rooms/${encodeURIComponent(roomCode)}/join`, {
      baseUrl: helpers.baseUrl,
      body: { playerId: p2Id, playerName: `${spec.id}-Guest` },
    });
    assert.ok(joinRes.ok, `${spec.id}: POST /api/rooms/${roomCode}/join failed (${joinRes.status}): ${joinRes.text}`);
    assert.equal(joinRes.data.state.humans.length, 2, `${spec.id}: expected 2 humans in room`);

    helpers.onCleanup(() =>
      helpers
        .apiFetch(`/api/rooms/${encodeURIComponent(roomCode)}/leave`, {
          baseUrl: helpers.baseUrl,
          body: { playerId: p2Id },
        })
        .catch(() => {})
    );

    ws1 = await helpers.connectUiWs({ wsUrl: helpers.wsUrl, roomCode, playerId: p1Id });
    helpers.onCleanup(() => ws1.close());
    ws2 = await helpers.connectUiWs({ wsUrl: helpers.wsUrl, roomCode, playerId: p2Id });
    helpers.onCleanup(() => ws2.close());

    const ws1Idx = ws1.messages.length;
    const ws2Idx = ws2.messages.length;

    const startRes = await helpers.apiFetch(`/api/rooms/${encodeURIComponent(roomCode)}/start`, {
      baseUrl: helpers.baseUrl,
      timeoutMs: apiTimeoutMs,
      body: { playerId: p1Id },
    });
    assert.ok(startRes.ok, `${spec.id}: POST /api/rooms/${roomCode}/start failed (${startRes.status}): ${startRes.text}`);
    state = startRes.data.state;

    const sync1 = await ws1.waitForMessage(
      (m) => m.type === 'state_sync' && m.state?.matchStatus === 'active',
      5000,
      { fromIndex: ws1Idx }
    );
    const sync2 = await ws2.waitForMessage(
      (m) => m.type === 'state_sync' && m.state?.matchStatus === 'active',
      5000,
      { fromIndex: ws2Idx }
    );
    assert.equal(sync1.state.human.id, p1Id, `${spec.id}: WS1 personalized human mismatch`);
    assert.equal(sync2.state.human.id, p2Id, `${spec.id}: WS2 personalized human mismatch`);
  } else {
    const newRes = await helpers.apiFetch('/api/match/new', {
      baseUrl: helpers.baseUrl,
      timeoutMs: apiTimeoutMs,
      body: {
        mode: spec.mode,
        locationMode: spec.locationMode,
        bettingEnabled: spec.bettingEnabled,
        startingChips,
        totalRounds: spec.totalRounds,
        roundDurationSec,
        provider: spec.provider,
        humanName: `${spec.id}-Player`,
        playerId: p1Id,
        autoPlayEnabled: false,
        selectedModels: [],
      },
    });
    assert.ok(newRes.ok, `${spec.id}: POST /api/match/new failed (${newRes.status}): ${newRes.text}`);
    state = newRes.data;
    roomCode = state.roomCode;
    assert.ok(typeof roomCode === 'string' && roomCode.length > 0, `${spec.id}: missing roomCode on match state`);

    helpers.onCleanup(() =>
      helpers
        .apiFetch(`/api/rooms/${encodeURIComponent(roomCode)}/leave`, {
          baseUrl: helpers.baseUrl,
          body: { playerId: p1Id },
        })
        .catch(() => {})
    );

    ws1 = await helpers.connectUiWs({ wsUrl: helpers.wsUrl, roomCode, playerId: p1Id });
    helpers.onCleanup(() => ws1.close());
  }

  assert.equal(state.mode, spec.mode);
  assert.equal(state.locationMode, spec.locationMode);
  assert.equal(state.bettingEnabled, spec.bettingEnabled);
  assert.equal(state.totalRounds, spec.totalRounds);
  assert.equal(state.matchStatus, 'active');
  assertProviderValid(state, spec.provider, spec.id);

  if (spec.timer === 'timed') {
    assert.equal(state.roundDurationSec, 60, `${spec.id}: expected roundDurationSec === 60`);
    const tick = await ws1.waitForMessage((m) => m.type === 'timer_tick', 3500, { fromIndex: 0 });
    assert.ok(
      typeof tick.timeRemainingSec === 'number' && tick.timeRemainingSec >= 0 && tick.timeRemainingSec <= 60,
      `${spec.id}: unexpected timer_tick value ${tick.timeRemainingSec}`
    );
  } else {
    assert.equal(state.roundDurationSec, null, `${spec.id}: expected roundDurationSec === null`);
  }

  // Connect MCP agents or verify agent registration rejection for human-only modes
  const mcpAgents = [];

  if (spec.mcpTransport === 'none') {
    const blockedReg = await helpers.apiFetch('/api/agents/register', {
      baseUrl: helpers.baseUrl,
      body: { name: 'ForbiddenBot', model: 'none-test', roomCode },
    });
    assert.ok(
      !blockedReg.ok && (blockedReg.status === 409 || blockedReg.status === 400),
      `${spec.id}: mode=${spec.mode} must reject AI registration, got ${blockedReg.status}`
    );
  } else {
    const mcp1 = await connectMcpByTransport(helpers, spec.mcpTransport, {
      agentName: `${spec.id}-AI-1`,
      model: `${spec.mcpTransport}-model-1`,
      roomCode,
    });
    const agState1 = await mcp1.callToolJson('get_game_state');
    assert.ok(agState1?.agentId, `${spec.id}: MCP agent 1 missing agentId`);
    assert.equal(agState1.locationMode, spec.locationMode);
    assert.equal(agState1.bettingEnabled, spec.bettingEnabled);
    assert.equal(agState1.roundSummary, null, `${spec.id}: active round must keep roundSummary === null`);
    assert.equal(agState1.target, undefined, `${spec.id}: active round must not leak target`);
    mcpAgents.push({ client: mcp1, agentId: agState1.agentId });

    if (spec.mode === '1v1') {
      const capRes = await helpers.apiFetch('/api/agents/register', {
        baseUrl: helpers.baseUrl,
        body: { name: 'Extra1v1Bot', model: 'extra-model', roomCode },
      });
      assert.equal(
        capRes.status,
        409,
        `${spec.id}: 1v1 mode must reject 2nd AI registration with 409, got ${capRes.status}`
      );
    } else if (spec.mode === 'ffa' || spec.mode === 'spectator') {
      // Connect a 2nd AI agent to verify multi-AI behavior in ffa / spectator
      const secondTransport = spec.mcpTransport === 'stdio' ? 'stdio' : spec.mcpTransport;
      const mcp2 = await connectMcpByTransport(helpers, secondTransport, {
        agentName: `${spec.id}-AI-2`,
        model: `${secondTransport}-model-2`,
        roomCode,
      });
      const agState2 = await mcp2.callToolJson('get_game_state');
      assert.ok(agState2?.agentId && agState2.agentId !== agState1.agentId);
      mcpAgents.push({ client: mcp2, agentId: agState2.agentId });
    }

    const matchCheck = await helpers.apiFetch(
      `/api/match?roomCode=${encodeURIComponent(roomCode)}&playerId=${encodeURIComponent(p1Id)}`,
      { baseUrl: helpers.baseUrl }
    );
    assert.ok(matchCheck.ok);
    for (const ag of mcpAgents) {
      const found = matchCheck.data.agents.find((a) => a.id === ag.agentId);
      assert.ok(found, `${spec.id}: agent ${ag.agentId} not registered in room ${roomCode}`);
      assert.equal(found.transport, spec.mcpTransport, `${spec.id}: agent transport mismatch`);
    }

    if (spec.mode === 'spectator') {
      const rejectHumanGuess = await helpers.apiFetch('/api/human/guess', {
        baseUrl: helpers.baseUrl,
        body: { latitude: 10, longitude: 10, roomCode, playerId: p1Id },
      });
      assert.ok(
        !rejectHumanGuess.ok && (rejectHumanGuess.status === 400 || rejectHumanGuess.status === 409),
        `${spec.id}: spectator must reject human guess, got ${rejectHumanGuess.status}`
      );
    }
  }

  // Track starting chips for betting invariants
  const chipsByPlayer = new Map();
  if (spec.bettingEnabled) {
    if (spec.mode !== 'spectator') {
      chipsByPlayer.set(p1Id, startingChips);
      if (p2Id) chipsByPlayer.set(p2Id, startingChips);
    }
    for (const ag of mcpAgents) {
      chipsByPlayer.set(ag.agentId, startingChips);
    }
  }

  const seenTargetNames = [];

  for (let round = 1; round <= spec.totalRounds; round += 1) {
    const curRes = await helpers.apiFetch(
      `/api/match?roomCode=${encodeURIComponent(roomCode)}&playerId=${encodeURIComponent(p1Id)}`,
      { baseUrl: helpers.baseUrl }
    );
    assert.ok(curRes.ok);
    const curState = curRes.data;
    assert.equal(curState.currentRoundNumber, round, `${spec.id}: expected round ${round}`);
    assert.equal(curState.roundStatus, 'active', `${spec.id}: expected active round ${round}`);

    // Verify chip carryover at start of round
    if (spec.bettingEnabled) {
      if (spec.mode !== 'spectator') {
        assert.equal(
          curState.human.chips,
          chipsByPlayer.get(p1Id),
          `${spec.id}: R${round} human chips carryover mismatch`
        );
      }
      for (const ag of mcpAgents) {
        const agView = curState.agents.find((a) => a.id === ag.agentId);
        assert.ok(agView);
        assert.equal(
          agView.chips,
          chipsByPlayer.get(ag.agentId),
          `${spec.id}: R${round} agent ${ag.agentId} chips carryover mismatch`
        );
      }
    }

    const roundEndFromIdx = ws1.messages.length;

    // Human guesses (unless spectator)
    if (spec.mode !== 'spectator') {
      const p1Wager = spec.bettingEnabled
        ? Math.min(round % 2 === 1 ? 200 : 100, chipsByPlayer.get(p1Id) ?? 0)
        : undefined;
      const g1Res = await helpers.apiFetch('/api/human/guess', {
        baseUrl: helpers.baseUrl,
        body: {
          latitude: 35.6595,
          longitude: 139.7004,
          roomCode,
          playerId: p1Id,
          ...(p1Wager !== undefined ? { wager: p1Wager } : {}),
        },
      });
      assert.ok(g1Res.ok, `${spec.id}: R${round} P1 guess failed (${g1Res.status}): ${g1Res.text}`);

      if (spec.mode === 'solo') {
        assert.equal(g1Res.data.roundStatus, 'round_over', `${spec.id}: solo must end immediately on P1 guess`);
      } else {
        assert.equal(
          g1Res.data.roundStatus,
          'active',
          `${spec.id}: ${spec.mode} must stay active after first participant guesses`
        );
      }

      if (isMultiHuman && p2Id) {
        const p2Wager = spec.bettingEnabled
          ? Math.min(150, chipsByPlayer.get(p2Id) ?? 0)
          : undefined;
        const g2Res = await helpers.apiFetch('/api/human/guess', {
          baseUrl: helpers.baseUrl,
          body: {
            latitude: 48.8566,
            longitude: 2.3522,
            roomCode,
            playerId: p2Id,
            ...(p2Wager !== undefined ? { wager: p2Wager } : {}),
          },
        });
        assert.ok(g2Res.ok, `${spec.id}: R${round} P2 guess failed (${g2Res.status}): ${g2Res.text}`);

        if (spec.mode === 'pvp') {
          assert.equal(g2Res.data.roundStatus, 'round_over', `${spec.id}: pvp must end once both humans guess`);
        } else {
          // pvp_ai must still wait for AI agent
          assert.equal(
            g2Res.data.roundStatus,
            'active',
            `${spec.id}: pvp_ai must remain active after both humans guess until AI guesses`
          );
        }
      }
    }

    // AI MCP agent guesses
    for (let i = 0; i < mcpAgents.length; i += 1) {
      const ag = mcpAgents[i];
      if (round === 1 && i === 0) {
        await ag.client.callToolRaw('look_around', { agent_id: ag.agentId });
      }
      const agChips = chipsByPlayer.get(ag.agentId) ?? 0;
      const guessArgs = {
        latitude: i === 0 ? 46.5935 : -33.8568,
        longitude: i === 0 ? 7.9091 : 151.2153,
        reasoning: `${spec.id} round ${round} deduction for agent ${i + 1}`,
        agent_id: ag.agentId,
      };
      if (spec.bettingEnabled && i === 0) {
        // Explicit wager on AI-1 (including 0 on even rounds to cover zero-wager invariant)
        guessArgs.wager = round % 2 === 1 ? Math.min(250, agChips) : 0;
      }
      // Note: AI-2 (when present in ffa/spectator) intentionally omits wager to exercise confidence auto-betting
      const submitRes = await ag.client.callToolJson('submit_guess', guessArgs);
      assert.equal(submitRes.accepted, true, `${spec.id}: R${round} MCP submit_guess not accepted`);
    }

    const roundEndedMsg = await ws1.waitForMessage(
      (m) => m.type === 'round_ended' && m.summary?.roundNumber === round,
      10000,
      { fromIndex: roundEndFromIdx }
    );
    const summary = roundEndedMsg.summary;
    assert.ok(summary, `${spec.id}: missing round_ended summary on R${round}`);
    assertTargetMatchesLocationMode(summary.target, spec.locationMode, `${spec.id}-R${round}`);
    seenTargetNames.push(summary.target.name);

    if (spec.mode === 'spectator') {
      assert.equal(summary.endedReason, 'all_guessed', `${spec.id}: spectator should end with all_guessed`);
      assert.ok(
        summary.results.every((r) => !r.isHuman),
        `${spec.id}: spectator round summary should contain AI results only`
      );
    }

    if (spec.bettingEnabled) {
      for (const entry of summary.results) {
        const before = chipsByPlayer.get(entry.playerId);
        assert.ok(typeof before === 'number', `${spec.id}: unexpected participant ${entry.playerId} in summary`);
        assert.ok(
          typeof entry.wager === 'number' && entry.wager >= 0 && entry.wager <= before,
          `${spec.id}: R${round} invalid wager ${entry.wager} (before=${before}) for ${entry.playerId}`
        );
        assert.ok(
          typeof entry.chipDelta === 'number' && Number.isFinite(entry.chipDelta),
          `${spec.id}: R${round} invalid chipDelta for ${entry.playerId}`
        );
        assert.ok(
          typeof entry.chipsAfter === 'number' && entry.chipsAfter >= 0,
          `${spec.id}: R${round} invalid chipsAfter ${entry.chipsAfter} for ${entry.playerId}`
        );
        assert.equal(
          entry.chipsAfter,
          Math.max(0, before + entry.chipDelta),
          `${spec.id}: R${round} chipsAfter mismatch for ${entry.playerId}`
        );
        chipsByPlayer.set(entry.playerId, entry.chipsAfter);
      }
    } else {
      for (const entry of summary.results) {
        assert.ok(
          entry.chipDelta === undefined || entry.chipDelta === null || entry.chipDelta === 0,
          `${spec.id}: betting=off should not award chipDelta, got ${entry.chipDelta}`
        );
      }
    }

    if (round < spec.totalRounds) {
      const nextRes = await helpers.apiFetch('/api/match/next-round', {
        baseUrl: helpers.baseUrl,
        timeoutMs: apiTimeoutMs,
        body: { roomCode, playerId: p1Id },
      });
      assert.ok(nextRes.ok, `${spec.id}: next-round after R${round} failed (${nextRes.status}): ${nextRes.text}`);
      assert.equal(nextRes.data.currentRoundNumber, round + 1);
      assert.equal(nextRes.data.roundStatus, 'active');
    } else {
      const matchEndFromIdx = ws1.messages.length;
      const finRes = await helpers.apiFetch('/api/match/next-round', {
        baseUrl: helpers.baseUrl,
        timeoutMs: apiTimeoutMs,
        body: { roomCode, playerId: p1Id },
      });
      assert.ok(finRes.ok, `${spec.id}: final next-round failed (${finRes.status}): ${finRes.text}`);
      assert.equal(finRes.data.matchStatus, 'finished', `${spec.id}: matchStatus should be finished`);

      const matchEndedMsg = await ws1.waitForMessage(
        (m) => m.type === 'match_ended',
        5000,
        { fromIndex: matchEndFromIdx }
      );
      const leaderboard = matchEndedMsg.leaderboard;
      assert.ok(
        Array.isArray(leaderboard) &&
          leaderboard.length > 0 &&
          (!spec.bettingEnabled || leaderboard.length >= chipsByPlayer.size),
        `${spec.id}: invalid final leaderboard`
      );

      for (const lb of leaderboard) {
        assert.equal(
          lb.roundScores.length,
          spec.totalRounds,
          `${spec.id}: leaderboard entry ${lb.playerId} missing roundScores`
        );
        if (spec.bettingEnabled && chipsByPlayer.has(lb.playerId)) {
          const expectedChips = chipsByPlayer.get(lb.playerId);
          assert.equal(lb.chips, expectedChips, `${spec.id}: final leaderboard chips mismatch for ${lb.playerId}`);
          assert.equal(
            lb.netChips,
            expectedChips - startingChips,
            `${spec.id}: final leaderboard netChips mismatch for ${lb.playerId}`
          );
        }
      }

      helpers.assertNoSecretLeak(finRes.data, `${spec.id} final state`);
      helpers.assertNoSecretLeak(leaderboard, `${spec.id} leaderboard`);
    }
  }

  // Uniqueness assertion across rounds for mountain_regions & standard
  if (spec.locationMode === 'mountain_regions' || spec.locationMode === 'standard') {
    const uniqueCount = new Set(seenTargetNames).size;
    assert.equal(
      uniqueCount,
      spec.totalRounds,
      `${spec.id}: expected ${spec.totalRounds} unique targets for ${spec.locationMode}, got ${uniqueCount} (${seenTargetNames.join(', ')})`
    );
  }
}

export function getTier3Tests(_ctx) {
  return PAIRWISE_CASES.map((spec) => ({
    id: spec.id,
    tier: 3,
    featureIds: spec.featureIds,
    title: spec.title,
    kind: spec.mcpTransport === 'none' ? 'ws' : 'mcp',
    requiresMcp: spec.mcpTransport !== 'none',
    requiresBrowser: false,
    run: (helpers) => runPairwiseCase(spec, helpers),
  }));
}
