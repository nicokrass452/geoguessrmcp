import assert from 'node:assert/strict';
import net from 'node:net';
import {
  assertSafePort,
  startIsolatedBackend,
  startIsolatedMcpServer,
} from './harness.mjs';

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

function serializePatterns(patterns) {
  const list = Array.isArray(patterns) ? patterns : [patterns];
  return list.map((p) => {
    if (p instanceof RegExp) {
      return { kind: 'regex', source: p.source, flags: p.flags.replace(/g/g, '') };
    }
    return { kind: 'text', value: String(p).toLowerCase() };
  });
}

async function findFreeSafePort(startPort = 3103) {
  for (let p = startPort; p < startPort + 100; p += 1) {
    assertSafePort(p);
    const free = await new Promise((resolve) => {
      const srv = net.createServer();
      srv.unref();
      srv.once('error', () => resolve(false));
      srv.listen(p, '127.0.0.1', () => {
        srv.close(() => resolve(true));
      });
    });
    if (free) return p;
  }
  throw new Error(`No free safe port found near ${startPort}`);
}

async function openCleanTab(helpers, url = helpers.uiUrl) {
  const tab = await helpers.openBrowserTab(url);
  helpers.onCleanup(() => helpers.browserDriver.closeTab(tab));
  return tab;
}

async function getBodyText(tab) {
  return (await tab.eval('document.body ? document.body.innerText : ""')) || '';
}

async function waitForBodyText(helpers, tab, patternOrText, timeoutMs = 10000) {
  const specs = serializePatterns(patternOrText);
  return helpers.browserDriver.waitForCondition(
    tab,
    `(() => {
      const txt = (document.body && document.body.innerText) || '';
      const specs = ${JSON.stringify(specs)};
      return specs.some((s) => {
        if (s.kind === 'regex') return new RegExp(s.source, s.flags).test(txt);
        return txt.toLowerCase().includes(s.value);
      });
    })()`,
    timeoutMs
  );
}

async function clickByButtonText(helpers, tab, patterns, opts = {}) {
  const rootSelector = opts.rootSelector ?? 'body';
  const timeoutMs = opts.timeoutMs ?? 8000;
  const specs = serializePatterns(patterns);
  const candidateSelector =
    opts.selector ??
    `${rootSelector} button, ${rootSelector} [role="button"], ${rootSelector} [role="radio"], ${rootSelector} [role="tab"]`;

  const clicked = await helpers.browserDriver.waitForCondition(
    tab,
    `(() => {
      const specs = ${JSON.stringify(specs)};
      const els = Array.from(document.querySelectorAll(${JSON.stringify(candidateSelector)}));
      const matchFn = (str) => {
        const clean = String(str || '').replace(/\\s+/g, ' ').trim();
        if (!clean) return false;
        return specs.some((s) =>
          s.kind === 'regex' ? new RegExp(s.source, s.flags).test(clean) : clean.toLowerCase().includes(s.value)
        );
      };
      for (const el of els) {
        const st = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        if (st.display === 'none' || st.visibility === 'hidden' || rect.width <= 0 || rect.height <= 0) continue;
        if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
        const text = el.innerText || el.textContent || '';
        const aria = el.getAttribute('aria-label') || '';
        const title = el.getAttribute('title') || '';
        if (matchFn(text) || matchFn(aria) || matchFn(title)) {
          el.scrollIntoView({ block: 'center', inline: 'center' });
          el.click();
          return (text || aria || title).trim();
        }
      }
      return false;
    })()`,
    timeoutMs
  );
  return clicked;
}

async function clickByTestIdOrText(helpers, tab, testIds, patterns, opts = {}) {
  const ids = Array.isArray(testIds) ? testIds : [testIds];
  const specs = serializePatterns(patterns);
  const timeoutMs = opts.timeoutMs ?? 8000;

  return helpers.browserDriver.waitForCondition(
    tab,
    `(() => {
      for (const id of ${JSON.stringify(ids)}) {
        const el = document.querySelector('[data-testid="' + id + '"]');
        if (el) {
          const st = window.getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          if (st.display !== 'none' && st.visibility !== 'hidden' && rect.width > 0 && rect.height > 0 && !el.disabled) {
            el.scrollIntoView({ block: 'center', inline: 'center' });
            el.click();
            return id;
          }
        }
      }
      const specs = ${JSON.stringify(specs)};
      const els = Array.from(document.querySelectorAll('button, [role="button"], [role="radio"], [role="tab"], label'));
      const matchFn = (str) => {
        const clean = String(str || '').replace(/\\s+/g, ' ').trim();
        if (!clean) return false;
        return specs.some((s) =>
          s.kind === 'regex' ? new RegExp(s.source, s.flags).test(clean) : clean.toLowerCase().includes(s.value)
        );
      };
      for (const el of els) {
        const st = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        if (st.display === 'none' || st.visibility === 'hidden' || rect.width <= 0 || rect.height <= 0) continue;
        if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
        const text = el.innerText || el.textContent || '';
        const aria = el.getAttribute('aria-label') || '';
        const title = el.getAttribute('title') || '';
        if (matchFn(text) || matchFn(aria) || matchFn(title)) {
          el.scrollIntoView({ block: 'center', inline: 'center' });
          el.click();
          return (text || aria || title).trim();
        }
      }
      return false;
    })()`,
    timeoutMs
  );
}

async function setFieldByLabel(helpers, tab, labelPatterns, value, opts = {}) {
  const specs = serializePatterns(labelPatterns);
  const timeoutMs = opts.timeoutMs ?? 6000;

  return helpers.browserDriver.waitForCondition(
    tab,
    `(() => {
      const specs = ${JSON.stringify(specs)};
      const nextVal = ${JSON.stringify(value)};
      const matchFn = (str) => {
        const clean = String(str || '').replace(/\\s+/g, ' ').trim();
        if (!clean) return false;
        return specs.some((s) =>
          s.kind === 'regex' ? new RegExp(s.source, s.flags).test(clean) : clean.toLowerCase().includes(s.value)
        );
      };
      const isVisible = (el) => {
        if (!el) return false;
        const st = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return st.display !== 'none' && st.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };

      let target = null;
      // 1. Direct aria-label / placeholder match on form controls or switches
      for (const el of document.querySelectorAll('input, select, textarea, button[role="switch"]')) {
        if (!isVisible(el) || el.disabled) continue;
        if (matchFn(el.getAttribute('aria-label')) || matchFn(el.getAttribute('placeholder')) || matchFn(el.innerText)) {
          target = el;
          break;
        }
      }
      // 2. <label> association
      if (!target) {
        for (const lbl of document.querySelectorAll('label')) {
          if (!isVisible(lbl)) continue;
          if (!matchFn(lbl.innerText || lbl.textContent)) continue;
          if (lbl.htmlFor) {
            const byFor = document.getElementById(lbl.htmlFor);
            if (byFor && isVisible(byFor)) { target = byFor; break; }
          }
          const inside = lbl.querySelector('input, select, textarea, button[role="switch"]');
          if (inside && isVisible(inside)) { target = inside; break; }
          const sibling = lbl.parentElement?.querySelector('input, select, textarea, button[role="switch"]');
          if (sibling && isVisible(sibling)) { target = sibling; break; }
        }
      }
      if (!target) return false;

      const tag = target.tagName.toLowerCase();
      if (tag === 'button' && (target.getAttribute('role') === 'switch' || target.hasAttribute('aria-checked') || target.hasAttribute('aria-pressed'))) {
        const want = Boolean(nextVal);
        const cur = target.getAttribute('aria-checked') === 'true' || target.getAttribute('aria-pressed') === 'true';
        if (cur !== want) target.click();
        return true;
      }
      if (tag === 'input' && (target.type === 'checkbox' || target.type === 'radio')) {
        const want = Boolean(nextVal);
        if (target.checked !== want) {
          const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked');
          if (desc && desc.set) desc.set.call(target, want);
          else target.checked = want;
          target.dispatchEvent(new Event('input', { bubbles: true }));
          target.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return true;
      }
      if (tag === 'select') {
        const wantStr = String(nextVal);
        const opts = Array.from(target.options);
        let chosen = opts.find((o) => o.value === wantStr);
        if (!chosen) chosen = opts.find((o) => (o.textContent || '').toLowerCase().includes(wantStr.toLowerCase()));
        if (!chosen) return false;
        const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
        if (desc && desc.set) desc.set.call(target, chosen.value);
        else target.value = chosen.value;
        target.dispatchEvent(new Event('input', { bubbles: true }));
        target.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      const proto = tag === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && desc.set) desc.set.call(target, String(nextVal));
      else target.value = String(nextVal);
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`,
    timeoutMs
  );
}

async function dropLeafletPin(helpers, tab, relX = 0.5, relY = 0.5) {
  const initialRect = await helpers.browserDriver.waitForCondition(
    tab,
    `(() => {
      const el = document.querySelector('[data-testid="guess-minimap"] .leaflet-container');
      if (!el) return false;
      const st = window.getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden') return false;
      const r = el.getBoundingClientRect();
      if (r.width <= 40 || r.height <= 40) return false;
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    })()`,
    10000
  );

  // Move pointer onto minimap to trigger hover-to-expand and wait for CSS/invalidateSize settle
  if (tab.engine === 'cdp' && tab.browser?.cdp) {
    const hoverX = Math.round(initialRect.left + initialRect.width * 0.5);
    const hoverY = Math.round(initialRect.top + initialRect.height * 0.5);
    await tab.browser.cdp.send(
      'Input.dispatchMouseEvent',
      { type: 'mouseMoved', x: hoverX, y: hoverY, button: 'none', clickCount: 0 },
      tab.sessionId
    );
  }
  await helpers.sleep(300);

  // Re-read rect after hover expansion settled
  const rect = await helpers.browserDriver.waitForCondition(
    tab,
    `(() => {
      const el = document.querySelector('[data-testid="guess-minimap"] .leaflet-container');
      if (!el) return false;
      const r = el.getBoundingClientRect();
      if (r.width <= 40 || r.height <= 40) return false;
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    })()`,
    5000
  );

  const x = Math.round(rect.left + rect.width * relX);
  const y = Math.round(rect.top + rect.height * relY);

  if (tab.engine === 'cdp' && tab.browser?.cdp) {
    await tab.browser.cdp.send(
      'Input.dispatchMouseEvent',
      { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 },
      tab.sessionId
    );
    await tab.browser.cdp.send(
      'Input.dispatchMouseEvent',
      { type: 'mousePressed', x, y, button: 'left', clickCount: 1 },
      tab.sessionId
    );
    await tab.browser.cdp.send(
      'Input.dispatchMouseEvent',
      { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 },
      tab.sessionId
    );
  } else {
    await tab.eval(`(() => {
      const target = document.elementFromPoint(${x}, ${y}) || document.querySelector('[data-testid="guess-minimap"] .leaflet-container');
      for (const type of ['mousedown', 'mouseup', 'click']) {
        target.dispatchEvent(new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: ${x},
          clientY: ${y},
        }));
      }
    })()`);
  }

  // Confirm pin drop enabled the Submit Guess button
  await helpers.browserDriver.waitForCondition(
    tab,
    `(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      return btns.some((b) => /^Submit Guess/i.test((b.innerText || b.textContent || '').trim()) && !b.disabled);
    })()`,
    6000
  );
}

async function setWagerInMiniMap(helpers, tab, wagerValue) {
  await helpers.browserDriver.waitForSelector(tab, 'input[aria-label="Confidence wager amount"]', 6000);
  await helpers.browserDriver.setInputValue(tab, 'input[aria-label="Confidence wager amount"]', String(wagerValue), 5000);
  const actual = await tab.eval(`(() => {
    const el = document.querySelector('input[aria-label="Confidence wager amount"]');
    return el ? el.value : null;
  })()`);
  assert.equal(Number(actual), Number(wagerValue), `Expected minimap wager input ${wagerValue}, got ${actual}`);
}

async function getSessionStorageEntries(tab) {
  return (await tab.eval('Object.fromEntries(Object.entries(window.sessionStorage))')) || {};
}

async function getLocalStorageEntries(tab) {
  return (await tab.eval('Object.fromEntries(Object.entries(window.localStorage))')) || {};
}

async function findSessionPlayerId(tab) {
  const entries = await getSessionStorageEntries(tab);
  for (const [key, rawVal] of Object.entries(entries)) {
    if (/player.?id/i.test(key) && rawVal) {
      return String(rawVal).replace(/^"|"$/g, '');
    }
    if (typeof rawVal === 'string' && rawVal.trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(rawVal);
        if (parsed && typeof parsed.playerId === 'string' && parsed.playerId.length > 0) {
          return parsed.playerId;
        }
      } catch {
        // ignore non-JSON
      }
    }
  }
  return null;
}

async function findSessionToken(tab) {
  const entries = await getSessionStorageEntries(tab);
  const raw = entries.geoguessr_session_token;
  return raw ? String(raw).replace(/^"|"$/g, '') : null;
}

async function assertPageClean(helpers, tab, label) {
  const { consoleErrors, pageErrors } = helpers.browserDriver.getErrors(tab);
  assert.deepEqual(pageErrors, [], `${label}: unexpected pageErrors: ${pageErrors.join(' | ')}`);
  assert.deepEqual(consoleErrors, [], `${label}: unexpected consoleErrors: ${consoleErrors.join(' | ')}`);
  const bodyText = await getBodyText(tab);
  helpers.assertNoSecretLeak(bodyText, `${label} DOM text`);
}

async function ensureWelcomeStep2(helpers, tab) {
  const alreadyStep2 = await tab.eval(`(() => {
    const txt = (document.body && document.body.innerText) || '';
    return /Big Cities Only/i.test(txt) && /Mountain Regions Only/i.test(txt);
  })()`);
  if (alreadyStep2) return;
  await clickByTestIdOrText(
    helpers,
    tab,
    ['welcome-next-step', 'step2-continue'],
    [/^(Next|Continue|Configure|Setup|Step 2)/i],
    { timeoutMs: 4000 }
  ).catch(() => {});
  await waitForBodyText(helpers, tab, /Big Cities Only/i, 6000);
}

async function selectWelcomeHubStep1Mode(helpers, tab, modeLabelPattern, subVariantPattern = null) {
  await clickByTestIdOrText(helpers, tab, [], [modeLabelPattern], { timeoutMs: 8000 });
  if (subVariantPattern) {
    await clickByButtonText(helpers, tab, [subVariantPattern], { timeoutMs: 3000 }).catch(() => {});
  }
}

async function configureWelcomeStep2(helpers, tab, cfg = {}) {
  await ensureWelcomeStep2(helpers, tab);

  if (cfg.locationMode === 'big_cities') {
    await clickByTestIdOrText(helpers, tab, ['location-big_cities'], [/Big Cities Only/i]);
  } else if (cfg.locationMode === 'mountain_regions') {
    await clickByTestIdOrText(helpers, tab, ['location-mountain_regions'], [/Mountain Regions Only/i]);
  } else if (cfg.locationMode === 'standard') {
    await clickByTestIdOrText(helpers, tab, ['location-standard'], [/Standard/i]);
  }

  if (typeof cfg.bettingEnabled === 'boolean') {
    const toggled = await setFieldByLabel(
      helpers,
      tab,
      [/Confidence Betting|Betting Mode/i],
      cfg.bettingEnabled
    ).catch(() => false);
    if (!toggled && cfg.bettingEnabled) {
      await clickByTestIdOrText(
        helpers,
        tab,
        ['betting-toggle'],
        [/Confidence Betting|Betting Mode/i],
        { timeoutMs: 4000 }
      );
    }
  }

  if (cfg.displayName) {
    await setFieldByLabel(helpers, tab, [/Display Name|Your Name|Player Name/i], cfg.displayName);
  }

  if (cfg.totalRounds) {
    await clickByButtonText(helpers, tab, [new RegExp(`^${cfg.totalRounds}(\\s*Rounds?)?$`, 'i')]);
  }

  if (cfg.roundDurationSec !== undefined) {
    const wantTimer = cfg.roundDurationSec === null ? 'none' : String(cfg.roundDurationSec);
    const setSelect = await setFieldByLabel(helpers, tab, [/Timer|Round Timer|Duration/i], wantTimer).catch(
      () => false
    );
    if (!setSelect && cfg.roundDurationSec !== null) {
      await clickByButtonText(helpers, tab, [new RegExp(`^${cfg.roundDurationSec}s?$`, 'i')]).catch(() => {});
    }
  }

  if (cfg.maxStepsPerRound !== undefined) {
    await setFieldByLabel(helpers, tab, [/Step Cap|Max Steps/i], String(cfg.maxStepsPerRound)).catch(
      async () => {
        await clickByButtonText(helpers, tab, [new RegExp(`^${cfg.maxStepsPerRound}(\\s*steps?)?$`, 'i')]).catch(
          () => {}
        );
      }
    );
  }

  if (cfg.provider) {
    const setProv = await setFieldByLabel(helpers, tab, [/Provider|Panorama/i], cfg.provider).catch(
      () => false
    );
    if (!setProv) {
      await clickByButtonText(helpers, tab, [new RegExp(cfg.provider, 'i')]).catch(() => {});
    }
  }
}

async function extractRoomCodeFromTab(helpers, tab) {
  return helpers.browserDriver.waitForCondition(
    tab,
    `(() => {
      const el = document.querySelector('[data-testid="room-code"], [aria-label*="Room code" i], [aria-label*="Room Code" i]');
      if (el) {
        const m = (el.textContent || '').match(/\\b([A-Z0-9]{4,12})\\b/);
        if (m) return m[1];
      }
      const txt = (document.body && document.body.innerText) || '';
      const m = txt.match(/Room\\s+Code\\s*[:#]\\s*([A-Z0-9]{4,12})\\b/i);
      return m ? m[1].toUpperCase() : false;
    })()`,
    8000
  );
}

function getApiBase(helpers) {
  return helpers.liveUi ? new URL(helpers.uiUrl).origin : helpers.baseUrl;
}

export function getTier4Tests(_ctx) {
  return [
    {
      id: 'T4-SCN-01',
      tier: 4,
      featureIds: ['F1', 'F7', 'F9', 'F12', 'F14', 'F16'],
      title: 'Welcome Hub -> Solo Play -> Multi-Round (3R) -> Final Settlement -> Return Home',
      kind: 'browser',
      requiresBrowser: true,
      requiresMcp: false,
      run: async (helpers) => {
        const tab = await openCleanTab(helpers);
        await waitForBodyText(helpers, tab, /Solo Practice/i, 10000);

        // Initial load must land on Welcome Hub, NOT active minimap
        const hasMiniMapInitially = await tab.eval("Boolean(document.querySelector('.leaflet-container'))");
        assert.equal(hasMiniMapInitially, false, 'Initial load must show Welcome Hub, not active 360 minimap');

        await selectWelcomeHubStep1Mode(helpers, tab, /Solo Practice/i);
        await configureWelcomeStep2(helpers, tab, {
          locationMode: 'standard',
          bettingEnabled: false,
          displayName: 'SoloTraveler',
          totalRounds: 3,
          provider: 'open',
        });

        await clickByTestIdOrText(helpers, tab, ['play-button', 'start-match'], [/^Play$|^Start Match$/i]);
        await helpers.browserDriver.waitForSelector(tab, '.leaflet-container', 10000);
        await waitForBodyText(helpers, tab, /SoloTraveler/, 8000);
        await waitForBodyText(helpers, tab, /1\s*\/\s*3/, 8000);

        // Solo mode hides AI summon / AgentHud controls
        const hasAgentSummon = await tab.eval(`(() => {
          const txt = (document.body && document.body.innerText) || '';
          return /Auto AI Opponents/i.test(txt) || /MCP Agents/i.test(txt);
        })()`);
        assert.equal(hasAgentSummon, false, 'Solo mode should hide AgentHud / AI summon controls');

        for (let r = 1; r <= 3; r += 1) {
          await dropLeafletPin(helpers, tab, 0.4 + r * 0.05, 0.5);
          await clickByButtonText(helpers, tab, [/^Submit Guess/i]);
          await waitForBodyText(helpers, tab, new RegExp(`Round\\s+${r}\\s+of\\s+3\\s+Summary`, 'i'), 10000);
          await clickByButtonText(helpers, tab, [r < 3 ? /^Next Round$/i : /^View Final Standings$/i]);
        }

        await waitForBodyText(helpers, tab, /Match Complete!/i, 10000);
        const lbText = await getBodyText(tab);
        assert.ok(lbText.includes('SoloTraveler'), 'FinalLeaderboardModal missing SoloTraveler');
        assert.ok(/R1:/i.test(lbText) && /R2:/i.test(lbText) && /R3:/i.test(lbText), 'Missing 3 round score badges');

        await clickByButtonText(helpers, tab, [/Return to Home|Return Home/i]);
        await waitForBodyText(helpers, tab, /Solo Practice/i, 8000);
        const hasMiniMapAfterReturn = await tab.eval("Boolean(document.querySelector('.leaflet-container'))");
        assert.equal(hasMiniMapAfterReturn, false, 'Returning home should leave Arena and restore Welcome Hub');

        await assertPageClean(helpers, tab, 'T4-SCN-01');
      },
    },
    {
      id: 'T4-SCN-02',
      tier: 4,
      featureIds: ['F6', 'F7', 'F11', 'F12', 'F14', 'F16'],
      title: 'Multi-Tab PvP Room-Code Sync over WebSocket (Lobby, Start, Live Status, Simultaneous Round End)',
      kind: 'browser',
      requiresBrowser: true,
      requiresMcp: false,
      run: async (helpers) => {
        const tab1 = await openCleanTab(helpers);
        const tab2 = await openCleanTab(helpers);

        await waitForBodyText(helpers, tab1, /Player vs Player/i, 10000);
        await waitForBodyText(helpers, tab2, /Player vs Player/i, 10000);

        const pid1 = await findSessionPlayerId(tab1);
        const pid2 = await findSessionPlayerId(tab2);
        assert.ok(pid1 && pid2 && pid1 !== pid2, `Tabs must have distinct sessionStorage playerIds (${pid1} vs ${pid2})`);

        // Tab 1 creates PvP room
        await selectWelcomeHubStep1Mode(helpers, tab1, /^Player vs Player$/i);
        await clickByButtonText(helpers, tab1, [/Create Room/i], { timeoutMs: 4000 }).catch(() => {});
        await configureWelcomeStep2(helpers, tab1, {
          locationMode: 'standard',
          bettingEnabled: false,
          displayName: 'HostAlice',
          totalRounds: 3,
          provider: 'open',
        });
        await clickByTestIdOrText(helpers, tab1, ['play-button', 'create-room'], [/Create Room|Play|Open Lobby/i]);

        const roomCode = await extractRoomCodeFromTab(helpers, tab1);
        const tok1 = await findSessionToken(tab1);
        helpers.onCleanup(() =>
          helpers
            .apiFetch(`/api/rooms/${encodeURIComponent(roomCode)}/leave`, {
              baseUrl: getApiBase(helpers),
              headers: tok1 ? { 'X-Session-Token': tok1 } : undefined,
              body: { playerId: pid1 },
            })
            .catch(() => {})
        );

        // Tab 2 joins via roomCode
        await selectWelcomeHubStep1Mode(helpers, tab2, /^Player vs Player$/i);
        await clickByButtonText(helpers, tab2, [/Join Room/i], { timeoutMs: 4000 }).catch(() => {});
        await setFieldByLabel(helpers, tab2, [/Room Code/i], roomCode);
        await setFieldByLabel(helpers, tab2, [/Display Name|Your Name|Player Name/i], 'PlayerTwo').catch(() => {});
        await clickByButtonText(helpers, tab2, [/^Join|Join Room/i]);

        // Both tabs show both players in waiting lobby
        await waitForBodyText(helpers, tab1, /PlayerTwo/i, 8000);
        await waitForBodyText(helpers, tab2, /HostAlice/i, 8000);
        const tok2 = await findSessionToken(tab2);
        helpers.onCleanup(() =>
          helpers
            .apiFetch(`/api/rooms/${encodeURIComponent(roomCode)}/leave`, {
              baseUrl: getApiBase(helpers),
              headers: tok2 ? { 'X-Session-Token': tok2 } : undefined,
              body: { playerId: pid2 },
            })
            .catch(() => {})
        );

        // Host starts match
        await clickByButtonText(helpers, tab1, [/Start Match|^Start$/i]);
        await helpers.browserDriver.waitForSelector(tab1, '.leaflet-container', 10000);
        await helpers.browserDriver.waitForSelector(tab2, '.leaflet-container', 10000);

        // Tab 1 guesses first -> Tab 1 locked, Tab 2 still active and sees live status
        await dropLeafletPin(helpers, tab1, 0.45, 0.45);
        await clickByButtonText(helpers, tab1, [/^Submit Guess/i]);
        await waitForBodyText(helpers, tab1, /Locked/i, 6000);

        const tab2SummaryEarly = await tab2.eval("Boolean(/Round\\s+1\\s+of\\s+3\\s+Summary/i.test(document.body.innerText))");
        assert.equal(tab2SummaryEarly, false, 'PvP round must not end until Tab 2 also guesses');

        // Tab 2 guesses -> both tabs simultaneously show RoundSummaryOverlay
        await dropLeafletPin(helpers, tab2, 0.55, 0.55);
        await clickByButtonText(helpers, tab2, [/^Submit Guess/i]);

        await Promise.all([
          waitForBodyText(helpers, tab1, /Round\s+1\s+of\s+3\s+Summary/i, 10000),
          waitForBodyText(helpers, tab2, /Round\s+1\s+of\s+3\s+Summary/i, 10000),
        ]);

        // Non-host waits while host has Next Round
        await waitForBodyText(helpers, tab2, /Waiting for host/i, 5000);
        await assertPageClean(helpers, tab1, 'T4-SCN-02 Tab1');
        await assertPageClean(helpers, tab2, 'T4-SCN-02 Tab2');
      },
    },
    {
      id: 'T4-SCN-03',
      tier: 4,
      featureIds: ['F2', 'F6', 'F7', 'F11', 'F12', 'F16'],
      title: 'Multi-Tab PvPvAI with Live Streamable HTTP MCP Client (Exploration + Reasoning + 3-Entry Summary)',
      kind: 'browser',
      requiresBrowser: true,
      requiresMcp: true,
      run: async (helpers) => {
        const tab1 = await openCleanTab(helpers);
        const tab2 = await openCleanTab(helpers);
        await waitForBodyText(helpers, tab1, /Player vs Player vs AI/i, 10000);
        await waitForBodyText(helpers, tab2, /Player vs Player vs AI/i, 10000);

        const pid1 = await findSessionPlayerId(tab1);
        const pid2 = await findSessionPlayerId(tab2);

        await selectWelcomeHubStep1Mode(helpers, tab1, /Player vs Player vs AI/i);
        await clickByButtonText(helpers, tab1, [/Create Room/i], { timeoutMs: 4000 }).catch(() => {});
        await configureWelcomeStep2(helpers, tab1, {
          locationMode: 'standard',
          bettingEnabled: false,
          displayName: 'PvPvAIHost',
          totalRounds: 3,
          provider: 'open',
        });
        await clickByTestIdOrText(helpers, tab1, ['play-button', 'create-room'], [/Create Room|Play|Open Lobby/i]);

        const roomCode = await extractRoomCodeFromTab(helpers, tab1);
        const tok1 = await findSessionToken(tab1);
        helpers.onCleanup(() =>
          helpers
            .apiFetch(`/api/rooms/${encodeURIComponent(roomCode)}/leave`, {
              baseUrl: getApiBase(helpers),
              headers: tok1 ? { 'X-Session-Token': tok1 } : undefined,
              body: { playerId: pid1 },
            })
            .catch(() => {})
        );

        await selectWelcomeHubStep1Mode(helpers, tab2, /Player vs Player vs AI/i);
        await clickByButtonText(helpers, tab2, [/Join Room/i], { timeoutMs: 4000 }).catch(() => {});
        await setFieldByLabel(helpers, tab2, [/Room Code/i], roomCode);
        await setFieldByLabel(helpers, tab2, [/Display Name|Your Name|Player Name/i], 'PvPvAIGuest').catch(() => {});
        await clickByButtonText(helpers, tab2, [/^Join|Join Room/i]);

        await waitForBodyText(helpers, tab1, /PvPvAIGuest/i, 8000);
        const tok2 = await findSessionToken(tab2);
        helpers.onCleanup(() =>
          helpers
            .apiFetch(`/api/rooms/${encodeURIComponent(roomCode)}/leave`, {
              baseUrl: getApiBase(helpers),
              headers: tok2 ? { 'X-Session-Token': tok2 } : undefined,
              body: { playerId: pid2 },
            })
            .catch(() => {})
        );
        await clickByButtonText(helpers, tab1, [/Start Match|^Start$/i]);
        await helpers.browserDriver.waitForSelector(tab1, '.leaflet-container', 10000);
        await helpers.browserDriver.waitForSelector(tab2, '.leaflet-container', 10000);

        const mcp = await helpers.connectHttpMcp({
          mcpHttpUrl: helpers.mcpHttpUrl,
          agentName: 'PvPvAI-MCP-Bot',
          model: 'claude-sonnet',
          roomCode,
        });
        helpers.onCleanup(() => mcp.close());
        assert.ok(mcp.sessionId, 'Missing Mcp-Session-Id on Streamable HTTP MCP');

        const agState = await mcp.callToolJson('get_game_state');
        assert.ok(agState.agentId);

        const lookRes = await mcp.callToolRaw('look_around', { agent_id: agState.agentId });
        helpers.assertJpeg(helpers.getImageContent(lookRes), 'look_around');
        const lookMeta = helpers.getTextContent(lookRes);

        const panRes = await mcp.callToolRaw('pan_and_zoom', {
          heading: 90,
          pitch: 5,
          zoom: 1.5,
          agent_id: agState.agentId,
        });
        helpers.assertJpeg(helpers.getImageContent(panRes), 'pan_and_zoom');

        const nextNodeId = lookMeta?.availableMoves?.[0]?.nodeId;
        const moveRes = await mcp.callToolRaw(
          'move',
          nextNodeId ? { node_id: nextNodeId, agent_id: agState.agentId } : { direction: 'forward', agent_id: agState.agentId }
        );
        helpers.assertJpeg(helpers.getImageContent(moveRes), 'move');

        const reasoning = 'European boulevard architecture and signage deduced via MCP';
        await mcp.callToolJson('submit_guess', {
          latitude: 48.8566,
          longitude: 2.3522,
          reasoning,
          agent_id: agState.agentId,
        });

        await dropLeafletPin(helpers, tab1, 0.5, 0.5);
        await clickByButtonText(helpers, tab1, [/^Submit Guess/i]);
        await dropLeafletPin(helpers, tab2, 0.4, 0.6);
        await clickByButtonText(helpers, tab2, [/^Submit Guess/i]);

        await Promise.all([
          waitForBodyText(helpers, tab1, /Round\s+1\s+of\s+3\s+Summary/i, 10000),
          waitForBodyText(helpers, tab2, /Round\s+1\s+of\s+3\s+Summary/i, 10000),
        ]);

        for (const [idx, t] of [tab1, tab2].entries()) {
          const txt = await getBodyText(t);
          assert.ok(txt.includes('PvPvAIHost'), `Tab ${idx + 1} summary missing PvPvAIHost`);
          assert.ok(txt.includes('PvPvAIGuest'), `Tab ${idx + 1} summary missing PvPvAIGuest`);
          assert.ok(txt.includes('PvPvAI-MCP-Bot'), `Tab ${idx + 1} summary missing PvPvAI-MCP-Bot`);
          assert.ok(txt.includes(reasoning), `Tab ${idx + 1} summary missing AI reasoning`);
        }

        await assertPageClean(helpers, tab1, 'T4-SCN-03 Tab1');
        await assertPageClean(helpers, tab2, 'T4-SCN-03 Tab2');
      },
    },
    {
      id: 'T4-SCN-04',
      tier: 4,
      featureIds: ['F3', 'F7', 'F15', 'F16'],
      title: 'AI-Only Spectator Mode with 3 Live MCP Clients (stdio + sse + streamable-http, POV feeds, auto round_over)',
      kind: 'browser',
      requiresBrowser: true,
      requiresMcp: true,
      run: async (helpers) => {
        const tab = await openCleanTab(helpers);
        await waitForBodyText(helpers, tab, /Spectator/i, 10000);

        await selectWelcomeHubStep1Mode(helpers, tab, /Spectator/i);
        await configureWelcomeStep2(helpers, tab, {
          locationMode: 'standard',
          bettingEnabled: false,
          totalRounds: 3,
          provider: 'open',
        });
        await clickByTestIdOrText(helpers, tab, ['play-button', 'start-match'], [/^Play$|^Start Match$/i]);

        // SpectatorStage must NOT render GuessingMiniMap
        await waitForBodyText(helpers, tab, /Spectator/i, 8000);
        const hasMiniMap = await tab.eval("Boolean(document.querySelector('.leaflet-container'))");
        assert.equal(hasMiniMap, false, 'Spectator mode must not render human GuessingMiniMap');

        const apiBase = getApiBase(helpers);
        const mcpStdio = await helpers.connectStdioMcp({
          backendUrl: apiBase,
          agentName: 'Gemini Spectator',
          model: 'gemini-2.5-pro',
        });
        helpers.onCleanup(() => mcpStdio.close());

        const mcpSse = await helpers.connectSseMcp({
          mcpHttpUrl: helpers.mcpHttpUrl,
          agentName: 'Claude Spectator',
          model: 'claude-3.7-sonnet',
        });
        helpers.onCleanup(() => mcpSse.close());

        const mcpHttp = await helpers.connectHttpMcp({
          mcpHttpUrl: helpers.mcpHttpUrl,
          agentName: 'GPT-OSS Spectator',
          model: 'gpt-oss-120b',
        });
        helpers.onCleanup(() => mcpHttp.close());

        // Wait for 3 loaded POV <img> feeds inside SpectatorStage
        const imgSrcs = await helpers.browserDriver.waitForCondition(
          tab,
          `(() => {
            const imgs = Array.from(document.querySelectorAll('img')).filter((img) =>
              (img.getAttribute('src') || '').includes('/api/agents/') &&
              (img.getAttribute('src') || '').includes('viewport.jpg')
            );
            if (imgs.length < 3) return false;
            const loaded = imgs.every((img) => img.complete && img.naturalWidth > 0);
            return loaded ? imgs.map((img) => img.getAttribute('src')) : false;
          })()`,
          12000
        );
        assert.ok(imgSrcs.length >= 3, `Expected 3 loaded POV images, got ${imgSrcs.length}`);

        // Verify raw JPEG validity for each POV feed
        for (const src of imgSrcs) {
          const fullUrl = src.startsWith('http') ? src : `${apiBase}${src.startsWith('/') ? '' : '/'}${src}`;
          const imgRes = await helpers.apiFetch(fullUrl, { raw: true });
          assert.ok(imgRes.ok, `Viewport JPEG fetch failed: ${fullUrl} -> ${imgRes.status}`);
          helpers.assertJpeg(imgRes.buffer, `spectator POV ${src}`);
        }

        const agents = [
          { client: mcpStdio, lat: 35.6595, lng: 139.7004, reason: 'Gemini alpine ridge deduction' },
          { client: mcpSse, lat: 48.8566, lng: 2.3522, reason: 'Claude coastal skyline deduction' },
          { client: mcpHttp, lat: 40.758, lng: -73.9855, reason: 'GPT-OSS urban grid deduction' },
        ];

        for (const a of agents) {
          await a.client.callToolRaw('look_around', {});
          await a.client.callToolRaw('pan_and_zoom', { heading: 120, pitch: 0, zoom: 1.5 });
          await a.client.callToolJson('submit_guess', {
            latitude: a.lat,
            longitude: a.lng,
            reasoning: a.reason,
          });
        }

        // Round auto-completes without any human input
        await waitForBodyText(helpers, tab, /Round\s+1\s+of\s+3\s+Summary/i, 10000);
        const sumText = await getBodyText(tab);
        assert.ok(/AI-Only Spectator/i.test(sumText), 'Missing AI-Only Spectator pill on summary');
        for (const a of agents) {
          assert.ok(sumText.includes(a.reason), `Missing spectator AI deduction: ${a.reason}`);
        }

        await assertPageClean(helpers, tab, 'T4-SCN-04');
      },
    },
    {
      id: 'T4-SCN-05',
      tier: 4,
      featureIds: ['F4', 'F5', 'F12', 'F16'],
      title: 'Mountain Regions Only 10-Round Endurance (10/10 non-city unique targets + Final Leaderboard)',
      kind: 'browser',
      requiresBrowser: true,
      requiresMcp: true,
      run: async (helpers) => {
        const tab = await openCleanTab(helpers);
        await waitForBodyText(helpers, tab, /Player vs AI/i, 10000);

        await selectWelcomeHubStep1Mode(helpers, tab, /Player vs AI/i, /1v1/i);
        await configureWelcomeStep2(helpers, tab, {
          locationMode: 'mountain_regions',
          bettingEnabled: false,
          displayName: 'SummitRunner',
          totalRounds: 10,
          provider: 'open',
        });
        await clickByTestIdOrText(helpers, tab, ['play-button', 'start-match'], [/^Play$|^Start Match$/i]);
        await helpers.browserDriver.waitForSelector(tab, '.leaflet-container', 10000);

        const mcp = await helpers.connectHttpMcp({
          mcpHttpUrl: helpers.mcpHttpUrl,
          agentName: 'AlpineBot',
          model: 'e2e-mountain-bot',
        });
        helpers.onCleanup(() => mcp.close());
        const agState = await mcp.callToolJson('get_game_state');
        assert.equal(agState.locationMode, 'mountain_regions');

        const apiBase = getApiBase(helpers);
        const pid = await findSessionPlayerId(tab);
        const tok = await findSessionToken(tab);
        const seenTargets = [];

        for (let r = 1; r <= 10; r += 1) {
          await dropLeafletPin(helpers, tab, 0.45, 0.5);
          await clickByButtonText(helpers, tab, [/^Submit Guess/i]);
          await mcp.callToolJson('submit_guess', {
            latitude: 46.5935,
            longitude: 7.9091,
            reasoning: `Mountain round ${r} guess`,
            agent_id: agState.agentId,
          });

          await waitForBodyText(helpers, tab, new RegExp(`Round\\s+${r}\\s+of\\s+10\\s+Summary`, 'i'), 10000);
          const matchRes = await helpers.apiFetch(
            `/api/match${pid ? `?playerId=${encodeURIComponent(pid)}` : ''}`,
            { baseUrl: apiBase, headers: tok ? { 'X-Session-Token': tok } : undefined }
          );
          assert.ok(matchRes.ok);
          const target = matchRes.data.roundSummary?.target;
          assert.ok(target && target.name && target.city, `R${r}: missing roundSummary target`);
          assert.ok(
            !BIG_CITY_NAMES.has(target.city),
            `R${r}: mountain_regions returned city target "${target.name}" (${target.city})`
          );
          seenTargets.push(target.name);

          await clickByButtonText(helpers, tab, [r < 10 ? /^Next Round$/i : /^View Final Standings$/i]);
        }

        assert.equal(seenTargets.length, 10);
        assert.equal(
          new Set(seenTargets).size,
          10,
          `Expected 10 unique mountain locations, got duplicates: ${seenTargets.join(', ')}`
        );

        await waitForBodyText(helpers, tab, /Match Complete!/i, 10000);
        const finalTxt = await getBodyText(tab);
        for (let r = 1; r <= 10; r += 1) {
          assert.ok(new RegExp(`R${r}:`, 'i').test(finalTxt), `FinalLeaderboardModal missing R${r} badge`);
        }

        await assertPageClean(helpers, tab, 'T4-SCN-05');
      },
    },
    {
      id: 'T4-SCN-06',
      tier: 4,
      featureIds: ['F4', 'F5', 'F12', 'F16'],
      title: 'Big Cities Only (5R) vs Standard (10R) Region Filtering',
      kind: 'browser',
      requiresBrowser: true,
      requiresMcp: false,
      run: async (helpers) => {
        const tab = await openCleanTab(helpers);
        const apiBase = getApiBase(helpers);
        await waitForBodyText(helpers, tab, /Solo Practice/i, 10000);

        // Part A: Big Cities Only (5 rounds)
        await selectWelcomeHubStep1Mode(helpers, tab, /Solo Practice/i);
        await configureWelcomeStep2(helpers, tab, {
          locationMode: 'big_cities',
          bettingEnabled: false,
          displayName: 'CityScout',
          totalRounds: 5,
          provider: 'open',
        });
        await clickByTestIdOrText(helpers, tab, ['play-button', 'start-match'], [/^Play$|^Start Match$/i]);
        await helpers.browserDriver.waitForSelector(tab, '.leaflet-container', 10000);

        const pid = await findSessionPlayerId(tab);
        const tok = await findSessionToken(tab);
        const cityTargets = [];
        for (let r = 1; r <= 5; r += 1) {
          await dropLeafletPin(helpers, tab, 0.5, 0.5);
          await clickByButtonText(helpers, tab, [/^Submit Guess/i]);
          await waitForBodyText(helpers, tab, new RegExp(`Round\\s+${r}\\s+of\\s+5\\s+Summary`, 'i'), 10000);
          const mRes = await helpers.apiFetch(
            `/api/match${pid ? `?playerId=${encodeURIComponent(pid)}` : ''}`,
            { baseUrl: apiBase, headers: tok ? { 'X-Session-Token': tok } : undefined }
          );
          assert.ok(mRes.ok);
          const target = mRes.data.roundSummary?.target;
          assert.ok(target && BIG_CITY_NAMES.has(target.city), `Big Cities R${r} got non-city ${target?.city}`);
          assert.notEqual(target.city, 'Lauterbrunnen', 'Big Cities must exclude Lauterbrunnen');
          cityTargets.push(target.name);
          await clickByButtonText(helpers, tab, [r < 5 ? /^Next Round$/i : /^View Final Standings$/i]);
        }

        await waitForBodyText(helpers, tab, /Match Complete!/i, 8000);
        await clickByButtonText(helpers, tab, [/Return to Home|Return Home/i]);
        await waitForBodyText(helpers, tab, /Solo Practice/i, 8000);

        // Part B: Standard (10 rounds, full-catalog availability)
        await selectWelcomeHubStep1Mode(helpers, tab, /Solo Practice/i);
        await configureWelcomeStep2(helpers, tab, {
          locationMode: 'standard',
          bettingEnabled: false,
          displayName: 'WorldScout',
          totalRounds: 10,
          provider: 'open',
        });
        await clickByTestIdOrText(helpers, tab, ['play-button', 'start-match'], [/^Play$|^Start Match$/i]);
        await helpers.browserDriver.waitForSelector(tab, '.leaflet-container', 10000);

        const stdTargets = [];
        for (let r = 1; r <= 10; r += 1) {
          await dropLeafletPin(helpers, tab, 0.5, 0.5);
          await clickByButtonText(helpers, tab, [/^Submit Guess/i]);
          await waitForBodyText(helpers, tab, new RegExp(`Round\\s+${r}\\s+of\\s+10\\s+Summary`, 'i'), 10000);
          const mRes = await helpers.apiFetch(
            `/api/match${pid ? `?playerId=${encodeURIComponent(pid)}` : ''}`,
            { baseUrl: apiBase, headers: tok ? { 'X-Session-Token': tok } : undefined }
          );
          assert.ok(mRes.ok);
          const target = mRes.data.roundSummary?.target;
          assert.ok(target && target.name, `Standard R${r} missing target`);
          stdTargets.push(target.name);
          await clickByButtonText(helpers, tab, [r < 10 ? /^Next Round$/i : /^View Final Standings$/i]);
        }

        assert.equal(new Set(stdTargets).size, 10, 'Standard 10-round match should draw 10 distinct locations');
        await waitForBodyText(helpers, tab, /Match Complete!/i, 8000);
        await assertPageClean(helpers, tab, 'T4-SCN-06');
      },
    },
    {
      id: 'T4-SCN-07',
      tier: 4,
      featureIds: ['F2', 'F8', 'F13', 'F14', 'F16'],
      title: 'Confidence Betting Mode Full Match (Human UI Wager + Explicit AI Wager + Auto-Betting + Settlement)',
      kind: 'browser',
      requiresBrowser: true,
      requiresMcp: true,
      run: async (helpers) => {
        const tab = await openCleanTab(helpers);
        const apiBase = getApiBase(helpers);
        await waitForBodyText(helpers, tab, /Player vs AI/i, 10000);

        await selectWelcomeHubStep1Mode(helpers, tab, /Player vs AI/i, /Free-For-All|FFA/i);
        await configureWelcomeStep2(helpers, tab, {
          locationMode: 'standard',
          bettingEnabled: true,
          displayName: 'HighRoller',
          totalRounds: 3,
          provider: 'open',
        });
        await clickByTestIdOrText(helpers, tab, ['play-button', 'start-match'], [/^Play$|^Start Match$/i]);
        await helpers.browserDriver.waitForSelector(tab, '.leaflet-container', 10000);
        await waitForBodyText(helpers, tab, /Confidence Bet/i, 8000);
        await waitForBodyText(helpers, tab, /1,000 chips/i, 6000);

        const ai1 = await helpers.connectHttpMcp({
          mcpHttpUrl: helpers.mcpHttpUrl,
          agentName: 'ExplicitBetBot',
          model: 'bet-explicit',
        });
        helpers.onCleanup(() => ai1.close());
        const ai1State = await ai1.callToolJson('get_game_state');

        const ai2 = await helpers.connectHttpMcp({
          mcpHttpUrl: helpers.mcpHttpUrl,
          agentName: 'AutoBetBot',
          model: 'bet-auto',
        });
        helpers.onCleanup(() => ai2.close());
        const ai2State = await ai2.callToolJson('get_game_state');

        const pid = await findSessionPlayerId(tab);
        const tok = await findSessionToken(tab);

        // Round 1: Human wagers 300, AI-1 explicit wager 400, AI-2 omitted wager (auto-betting)
        await dropLeafletPin(helpers, tab, 0.5, 0.5);
        await setWagerInMiniMap(helpers, tab, 300);
        await waitForBodyText(helpers, tab, /Submit Guess\s*·\s*Wager\s*300/i, 4000);
        await clickByButtonText(helpers, tab, [/^Submit Guess/i]);

        await ai1.callToolJson('submit_guess', {
          latitude: 35.6595,
          longitude: 139.7004,
          wager: 400,
          reasoning: 'Explicit 400 wager',
          agent_id: ai1State.agentId,
        });
        await ai2.callToolJson('submit_guess', {
          latitude: -33.8568,
          longitude: 151.2153,
          reasoning: 'Auto-bet confidence wager',
          agent_id: ai2State.agentId,
        });

        await waitForBodyText(helpers, tab, /Round\s+1\s+of\s+3\s+Summary/i, 10000);
        const r1Txt = await getBodyText(tab);
        assert.ok(/Wager/i.test(r1Txt) && /Net/i.test(r1Txt) && /Chips/i.test(r1Txt), 'Summary missing betting columns');
        assert.ok(r1Txt.includes('300'), 'Summary missing human wager 300');
        assert.ok(r1Txt.includes('400'), 'Summary missing AI-1 wager 400');

        const r1Match = await helpers.apiFetch(
          `/api/match${pid ? `?playerId=${encodeURIComponent(pid)}` : ''}`,
          { baseUrl: apiBase, headers: tok ? { 'X-Session-Token': tok } : undefined }
        );
        assert.ok(r1Match.ok);
        const r1HumanRes = r1Match.data.roundSummary?.results?.find((r) => r.isHuman);
        const r1AutoRes = r1Match.data.roundSummary?.results?.find((r) => r.playerId === ai2State.agentId);
        assert.equal(r1HumanRes?.wager, 300);
        assert.ok(typeof r1AutoRes?.wager === 'number' && r1AutoRes.wager >= 0, 'AI-2 auto-bet wager missing');
        const expectedR2Chips = r1HumanRes.chipsAfter;

        await clickByButtonText(helpers, tab, [/^Next Round$/i]);
        await waitForBodyText(helpers, tab, new RegExp(`${expectedR2Chips.toLocaleString()}\\s*chips`, 'i'), 8000);

        // Complete R2 and R3
        for (let r = 2; r <= 3; r += 1) {
          await dropLeafletPin(helpers, tab, 0.45, 0.55);
          await setWagerInMiniMap(helpers, tab, 0);
          await clickByButtonText(helpers, tab, [/^Submit Guess/i]);
          await ai1.callToolJson('submit_guess', {
            latitude: 48.8566,
            longitude: 2.3522,
            wager: 0,
            agent_id: ai1State.agentId,
          });
          await ai2.callToolJson('submit_guess', {
            latitude: 51.5007,
            longitude: -0.1246,
            agent_id: ai2State.agentId,
          });
          await waitForBodyText(helpers, tab, new RegExp(`Round\\s+${r}\\s+of\\s+3\\s+Summary`, 'i'), 10000);
          await clickByButtonText(helpers, tab, [r < 3 ? /^Next Round$/i : /^View Final Standings$/i]);
        }

        await waitForBodyText(helpers, tab, /Match Complete!/i, 10000);
        const hasChipStandings = await tab.eval(`(() => {
          const stacks = document.querySelectorAll('span[aria-label="Final chip stack"]');
          const nets = document.querySelectorAll('span[aria-label="Net chips"]');
          return stacks.length >= 3 && nets.length >= 3;
        })()`);
        assert.equal(hasChipStandings, true, 'FinalLeaderboardModal missing final chip stack & net chips badges');

        await assertPageClean(helpers, tab, 'T4-SCN-07');
      },
    },
    {
      id: 'T4-SCN-08',
      tier: 4,
      featureIds: ['F3', 'F10', 'F14', 'F16'],
      title: 'Top HUD Quick Return Home & Live MCP Status Badge Lifecycle (offline -> bridge_ready -> connected -> bridge_ready)',
      kind: 'browser',
      requiresBrowser: true,
      requiresMcp: true,
      run: async (helpers) => {
        const isoBackendPort = await findFreeSafePort(3103);
        const isoMcpPort = await findFreeSafePort(isoBackendPort + 1);

        const isoBackend = await startIsolatedBackend({
          port: isoBackendPort,
          env: {
            MCP_HTTP_URL: `http://127.0.0.1:${isoMcpPort}`,
            MCP_HTTP_PORT: String(isoMcpPort),
          },
        });
        helpers.onCleanup(() => isoBackend.stop());

        const tab = await openCleanTab(helpers, isoBackend.baseUrl);
        await waitForBodyText(helpers, tab, /Player vs AI|Solo Practice/i, 10000);

        await selectWelcomeHubStep1Mode(helpers, tab, /Player vs AI/i, /1v1/i);
        await configureWelcomeStep2(helpers, tab, {
          locationMode: 'standard',
          bettingEnabled: false,
          displayName: 'BadgeWatcher',
          totalRounds: 3,
          provider: 'open',
        });
        await clickByTestIdOrText(helpers, tab, ['play-button', 'start-match'], [/^Play$|^Start Match$/i]);
        await helpers.browserDriver.waitForSelector(tab, '.leaflet-container', 10000);

        // 1. offline
        const offRes = await helpers.apiFetch('/api/mcp/status', { baseUrl: isoBackend.baseUrl });
        assert.ok(offRes.ok);
        assert.equal(offRes.data.status, 'offline', `Expected initial offline status, got ${offRes.data.status}`);
        await helpers.browserDriver.waitForCondition(
          tab,
          `(() => {
            const header = document.querySelector('header');
            const txt = (header ? header.innerText : document.body.innerText) || '';
            return /MCP.*Offline|Offline/i.test(txt);
          })()`,
          8000
        );

        // 2. bridge_ready
        const isoMcp = await startIsolatedMcpServer({
          port: isoMcpPort,
          backendUrl: isoBackend.baseUrl,
        });
        helpers.onCleanup(() => isoMcp.stop());

        await helpers.browserDriver.waitForCondition(
          tab,
          `(() => {
            const header = document.querySelector('header');
            const txt = (header ? header.innerText : document.body.innerText) || '';
            return /Bridge\\s*Ready|MCP\\s*Ready|Ready/i.test(txt);
          })()`,
          10000
        );
        const readyRes = await helpers.apiFetch('/api/mcp/status', { baseUrl: isoBackend.baseUrl });
        assert.ok(
          readyRes.data.status === 'bridge_ready' || readyRes.data.httpBridgeReachable === true,
          `Expected bridge_ready after starting isolated MCP server, got ${JSON.stringify(readyRes.data)}`
        );

        // 3. connected
        const mcpClient = await helpers.connectHttpMcp({
          mcpHttpUrl: isoMcp.mcpHttpUrl,
          agentName: 'LifecycleBot',
          model: 'lifecycle-model',
        });
        helpers.onCleanup(() => mcpClient.close());

        await helpers.browserDriver.waitForCondition(
          tab,
          `(() => {
            const header = document.querySelector('header');
            const txt = (header ? header.innerText : document.body.innerText) || '';
            return /MCP.*Connected|Connected/i.test(txt);
          })()`,
          10000
        );
        const connRes = await helpers.apiFetch('/api/mcp/status', { baseUrl: isoBackend.baseUrl });
        assert.equal(connRes.data.status, 'connected');
        assert.ok(connRes.data.activeMcpAgents >= 1);

        // 4. disconnect agent -> drops back to bridge_ready
        await mcpClient.close();
        await helpers.browserDriver.waitForCondition(
          tab,
          `(() => {
            const header = document.querySelector('header');
            const txt = (header ? header.innerText : document.body.innerText) || '';
            return /Bridge\\s*Ready|MCP\\s*Ready|Ready/i.test(txt) && !/MCP\\s*Connected/i.test(txt);
          })()`,
          10000
        );

        // 5. Quick Return to Home in Top HUD
        await clickByTestIdOrText(
          helpers,
          tab,
          ['quick-return-home', 'return-home-btn'],
          [/Quick Return|Return to Home|Return Home|^Home$/i],
          { rootSelector: 'header', timeoutMs: 6000 }
        );
        await waitForBodyText(helpers, tab, /Solo Practice/i, 8000);
        const hasMiniMapAfter = await tab.eval("Boolean(document.querySelector('.leaflet-container'))");
        assert.equal(hasMiniMapAfter, false, 'Quick Return to Home must exit Arena to Welcome Hub');

        await assertPageClean(helpers, tab, 'T4-SCN-08');
      },
    },
    {
      id: 'T4-SCN-09',
      tier: 4,
      featureIds: ['F9', 'F12', 'F14', 'F16'],
      title: 'Pre-Match Setup Propagation (Display Name, Rounds, Timer 10s Timeout, Step Cap 3, Provider)',
      kind: 'browser',
      requiresBrowser: true,
      requiresMcp: true,
      run: async (helpers) => {
        const tab = await openCleanTab(helpers);
        const apiBase = getApiBase(helpers);
        await waitForBodyText(helpers, tab, /Player vs AI/i, 10000);

        await selectWelcomeHubStep1Mode(helpers, tab, /Player vs AI/i, /1v1/i);
        await configureWelcomeStep2(helpers, tab, {
          locationMode: 'standard',
          bettingEnabled: false,
          displayName: 'AlpineAce',
          totalRounds: 3,
          roundDurationSec: 10,
          maxStepsPerRound: 3,
          provider: 'open',
        });
        await clickByTestIdOrText(helpers, tab, ['play-button', 'start-match'], [/^Play$|^Start Match$/i]);
        await helpers.browserDriver.waitForSelector(tab, '.leaflet-container', 10000);

        await waitForBodyText(helpers, tab, /AlpineAce/, 6000);
        await waitForBodyText(helpers, tab, /1\s*\/\s*3/, 6000);

        const mcp = await helpers.connectHttpMcp({
          mcpHttpUrl: helpers.mcpHttpUrl,
          agentName: 'StepCapBot',
          model: 'step-cap-model',
        });
        helpers.onCleanup(() => mcp.close());
        const agState = await mcp.callToolJson('get_game_state');

        // 3 valid exploration calls (step cap = 3)
        await mcp.callToolRaw('look_around', { agent_id: agState.agentId });
        await mcp.callToolRaw('pan_and_zoom', { heading: 45, pitch: 0, zoom: 1.5, agent_id: agState.agentId });
        await mcp.callToolRaw('look_around', { agent_id: agState.agentId });

        // 4th exploration call must hit step cap
        let stepLimitErr = null;
        try {
          await mcp.callToolJson('pan_and_zoom', { heading: 90, pitch: 0, zoom: 2, agent_id: agState.agentId });
        } catch (err) {
          stepLimitErr = err;
        }
        assert.ok(stepLimitErr, '4th exploration call must fail when maxStepsPerRound=3');
        assert.match(
          stepLimitErr.message,
          /step|limit|cap|submit_guess/i,
          `Unexpected step-limit error message: ${stepLimitErr.message}`
        );

        // Wait for 10s timed round to auto-expire with endedReason === 'timeout'
        await waitForBodyText(helpers, tab, /Round\s+1\s+of\s+3\s+Summary/i, 16000);
        const pid = await findSessionPlayerId(tab);
        const tok = await findSessionToken(tab);
        const matchRes = await helpers.apiFetch(
          `/api/match${pid ? `?playerId=${encodeURIComponent(pid)}` : ''}`,
          { baseUrl: apiBase, headers: tok ? { 'X-Session-Token': tok } : undefined }
        );
        assert.ok(matchRes.ok);
        assert.equal(
          matchRes.data.roundSummary?.endedReason,
          'timeout',
          `Expected endedReason=timeout, got ${matchRes.data.roundSummary?.endedReason}`
        );

        await assertPageClean(helpers, tab, 'T4-SCN-09');
      },
    },
    {
      id: 'T4-SCN-10',
      tier: 4,
      featureIds: ['F1', 'F6', 'F11', 'F16'],
      title: 'Mid-Match Reconnect (sessionStorage Persistence), Non-Host Rejection & Zero Secret Leak Audit',
      kind: 'browser',
      requiresBrowser: true,
      requiresMcp: false,
      run: async (helpers) => {
        const tab1 = await openCleanTab(helpers);
        const tab2 = await openCleanTab(helpers);
        const apiBase = getApiBase(helpers);
        await waitForBodyText(helpers, tab1, /Player vs Player/i, 10000);
        await waitForBodyText(helpers, tab2, /Player vs Player/i, 10000);

        const pid1 = await findSessionPlayerId(tab1);
        const pid2Before = await findSessionPlayerId(tab2);
        assert.ok(pid1 && pid2Before && pid1 !== pid2Before, 'Distinct tab-scoped playerIds required');

        await selectWelcomeHubStep1Mode(helpers, tab1, /^Player vs Player$/i);
        await clickByButtonText(helpers, tab1, [/Create Room/i], { timeoutMs: 4000 }).catch(() => {});
        await configureWelcomeStep2(helpers, tab1, {
          locationMode: 'standard',
          bettingEnabled: false,
          displayName: 'HostOne',
          totalRounds: 3,
          provider: 'open',
        });
        await clickByTestIdOrText(helpers, tab1, ['play-button', 'create-room'], [/Create Room|Play|Open Lobby/i]);

        const roomCode = await extractRoomCodeFromTab(helpers, tab1);
        const tok1 = await findSessionToken(tab1);
        helpers.onCleanup(() =>
          helpers
            .apiFetch(`/api/rooms/${encodeURIComponent(roomCode)}/leave`, {
              baseUrl: apiBase,
              headers: tok1 ? { 'X-Session-Token': tok1 } : undefined,
              body: { playerId: pid1 },
            })
            .catch(() => {})
        );

        await selectWelcomeHubStep1Mode(helpers, tab2, /^Player vs Player$/i);
        await clickByButtonText(helpers, tab2, [/Join Room/i], { timeoutMs: 4000 }).catch(() => {});
        await setFieldByLabel(helpers, tab2, [/Room Code/i], roomCode);
        await setFieldByLabel(helpers, tab2, [/Display Name|Your Name|Player Name/i], 'ReconnectBob').catch(() => {});
        await clickByButtonText(helpers, tab2, [/^Join|Join Room/i]);

        await waitForBodyText(helpers, tab1, /ReconnectBob/i, 8000);
        const tok2 = await findSessionToken(tab2);
        helpers.onCleanup(() =>
          helpers
            .apiFetch(`/api/rooms/${encodeURIComponent(roomCode)}/leave`, {
              baseUrl: apiBase,
              headers: tok2 ? { 'X-Session-Token': tok2 } : undefined,
              body: { playerId: pid2Before },
            })
            .catch(() => {})
        );
        await clickByButtonText(helpers, tab1, [/Start Match|^Start$/i]);
        await helpers.browserDriver.waitForSelector(tab1, '.leaflet-container', 10000);
        await helpers.browserDriver.waitForSelector(tab2, '.leaflet-container', 10000);

        // Reload Tab 2 mid-match and verify sessionStorage playerId + clean rejoin
        await tab2.reload();
        await helpers.browserDriver.waitForSelector(tab2, '.leaflet-container', 12000);
        await waitForBodyText(helpers, tab2, /1\s*\/\s*3/, 8000);

        const pid2After = await findSessionPlayerId(tab2);
        assert.equal(pid2After, pid2Before, 'Tab 2 reload must preserve sessionStorage playerId');

        // Non-host attempting host-only start/advance gets graceful error (no 500)
        const nonHostStart = await helpers.apiFetch(`/api/rooms/${encodeURIComponent(roomCode)}/start`, {
          baseUrl: apiBase,
          headers: tok2 ? { 'X-Session-Token': tok2 } : undefined,
          body: { playerId: pid2After },
        });
        assert.ok(
          !nonHostStart.ok && [400, 403, 409].includes(nonHostStart.status),
          `Expected non-host start rejection (400/403/409), got ${nonHostStart.status}`
        );

        // Unauthenticated WS probe for token-bound player must be closed with 4003
        const unauthProbe = await helpers.connectUiWs({ wsUrl: helpers.wsUrl, roomCode, playerId: pid1 });
        helpers.onCleanup(() => unauthProbe.close());
        const unauthCode = await new Promise((resolve) => {
          if (unauthProbe.ws.readyState === 3) {
            resolve(4003);
            return;
          }
          const t = setTimeout(() => resolve(null), 3000);
          unauthProbe.ws.once('close', (code) => {
            clearTimeout(t);
            resolve(code);
          });
        });
        assert.equal(unauthCode, 4003, `Expected WS close code 4003 for unauthenticated probe, got ${unauthCode}`);

        // WS frame audit + REST + DOM + Web Storage zero-secret-leak audit
        const wsProbe = await helpers.connectUiWs({
          wsUrl: helpers.wsUrl,
          roomCode,
          playerId: pid1,
          sessionToken: tok1,
        });
        helpers.onCleanup(() => wsProbe.close());
        await wsProbe.waitForMessage((m) => m.type === 'state_sync', 5000, { fromIndex: 0 });

        const healthRes = await helpers.apiFetch('/api/health', { baseUrl: apiBase });
        const matchRes = await helpers.apiFetch(
          `/api/match?roomCode=${encodeURIComponent(roomCode)}&playerId=${encodeURIComponent(pid1)}`,
          { baseUrl: apiBase, headers: tok1 ? { 'X-Session-Token': tok1 } : undefined }
        );
        helpers.assertNoSecretLeak(healthRes.text, 'GET /api/health');
        helpers.assertNoSecretLeak(matchRes.text, 'GET /api/match');
        helpers.assertNoSecretLeak(wsProbe.messages, 'WS frames');

        for (const [idx, t] of [tab1, tab2].entries()) {
          helpers.assertNoSecretLeak(await getSessionStorageEntries(t), `Tab ${idx + 1} sessionStorage`);
          helpers.assertNoSecretLeak(await getLocalStorageEntries(t), `Tab ${idx + 1} localStorage`);
          await assertPageClean(helpers, t, `T4-SCN-10 Tab ${idx + 1}`);
        }
      },
    },
  ];
}
