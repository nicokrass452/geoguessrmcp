import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  assertNoSecretLeak,
  BASE_URL,
  checkBuildArtifacts,
  defineSuite,
  LIVE_UI_URL,
  MCP_HTTP_URL,
  ROOT_DIR,
  runSuites,
  scrubSecrets,
  startIsolatedBackend,
  startIsolatedMcpServer,
  stopAllServers,
  validateUniqueCaseIds,
  waitForHttpOk,
  WS_URL,
} from './e2e/harness.mjs';

const TIER_SPECS = [
  {
    tier: 1,
    file: path.join(ROOT_DIR, 'scripts', 'e2e', 'tier1_features.mjs'),
    exportName: 'getTier1Tests',
    name: 'Tier 1 — Functional & Equivalence Classes',
  },
  {
    tier: 2,
    file: path.join(ROOT_DIR, 'scripts', 'e2e', 'tier2_boundaries.mjs'),
    exportName: 'getTier2Tests',
    name: 'Tier 2 — Boundaries & Negative Robustness',
  },
  {
    tier: 3,
    file: path.join(ROOT_DIR, 'scripts', 'e2e', 'tier3_pairwise.mjs'),
    exportName: 'getTier3Tests',
    name: 'Tier 3 — Pairwise Combinatorial',
  },
  {
    tier: 4,
    file: path.join(ROOT_DIR, 'scripts', 'e2e', 'tier4_scenarios.mjs'),
    exportName: 'getTier4Tests',
    name: 'Tier 4 — Real-World Scenarios',
  },
];

const ALL_FEATURES = Array.from({ length: 16 }, (_, i) => `F${i + 1}`);

function printHelp() {
  console.log(`GeoGuessr-MCP Opaque-Box E2E Test Runner

Usage:
  node scripts/verify-e2e.mjs [options]

Options:
  --help, -h             Show this help message and exit 0
  --tier <1|2|3|4|all>   Select tier(s) (comma-separated or repeated; default: all)
  --feature <F1..F16>    Filter cases by feature ID(s) (e.g. F1 or F1,F6)
  --filter <pattern>     Filter cases by substring or /regex/ on ID, title, features
  --list                 List matching test cases and feature counts (no servers started)
  --syntax-only          Validate E2E module syntax, exports, and case schemas (no servers)
  --dry-run              Validate modules + check build artifacts + print execution plan
  --with-browser         Enable headless Chrome/Edge CDP browser checks
  --no-browser           Skip browser cases cleanly
  --live-ui              Target live Vite UI (${LIVE_UI_URL}) with CDP (never kills 5173/3001)
  --live-ui-url <url>    Override live UI URL and enable CDP browser checks
  --skip-server          Reuse already-running backend/MCP servers at configured URLs
  --require-all-tiers    Fail (exit 1) if any of Tiers 1–4 is missing or empty
  --require-build        Fail (exit 1) in --dry-run if dist/ build artifacts are missing
  --json                 Emit machine-readable JSON summary at end of run

Exit Codes:
  0  Passed / validation succeeded
  1  Test failure, missing required tier/build artifact, or startup error
  2  Invalid CLI arguments`);
}

function parseArgs(argv) {
  const opts = {
    help: false,
    list: false,
    dryRun: false,
    syntaxOnly: false,
    tiers: 'all',
    explicitTiers: false,
    features: null,
    filter: null,
    withBrowser: null,
    liveUi: false,
    liveUiUrl: null,
    skipServer: false,
    requireAllTiers: false,
    requireBuild: false,
    json: false,
  };

  const selectedTiers = new Set();
  const selectedFeatures = new Set();

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else if (arg === '--list') {
      opts.list = true;
    } else if (arg === '--dry-run') {
      opts.dryRun = true;
    } else if (arg === '--syntax-only') {
      opts.syntaxOnly = true;
    } else if (arg === '--with-browser') {
      opts.withBrowser = true;
    } else if (arg === '--no-browser') {
      opts.withBrowser = false;
    } else if (arg === '--live-ui') {
      opts.liveUi = true;
      opts.withBrowser = true;
    } else if (arg === '--skip-server') {
      opts.skipServer = true;
    } else if (arg === '--require-all-tiers') {
      opts.requireAllTiers = true;
    } else if (arg === '--require-build') {
      opts.requireBuild = true;
    } else if (arg === '--json') {
      opts.json = true;
    } else if (arg === '--tier' || arg.startsWith('--tier=')) {
      const val = arg.includes('=') ? arg.slice('--tier='.length) : argv[++i];
      if (!val) {
        return { error: 'Missing value for --tier' };
      }
      for (const token of val.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)) {
        if (token === 'all') {
          opts.tiers = 'all';
          opts.explicitTiers = false;
          selectedTiers.clear();
        } else if (/^[1-4]$/.test(token)) {
          selectedTiers.add(Number(token));
          opts.explicitTiers = true;
        } else {
          return { error: `Invalid --tier value "${token}". Expected 1, 2, 3, 4, or all.` };
        }
      }
    } else if (arg === '--feature' || arg.startsWith('--feature=')) {
      const val = arg.includes('=') ? arg.slice('--feature='.length) : argv[++i];
      if (!val) {
        return { error: 'Missing value for --feature' };
      }
      for (const token of val.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)) {
        if (!/^F([1-9]|1[0-6])$/.test(token)) {
          return { error: `Invalid --feature value "${token}". Expected F1..F16.` };
        }
        selectedFeatures.add(token);
      }
    } else if (arg === '--filter' || arg.startsWith('--filter=')) {
      const val = arg.includes('=') ? arg.slice('--filter='.length) : argv[++i];
      if (val === undefined) {
        return { error: 'Missing value for --filter' };
      }
      const raw = String(val).trim();
      if (raw.startsWith('/') && raw.lastIndexOf('/') > 0) {
        const lastSlash = raw.lastIndexOf('/');
        const pattern = raw.slice(1, lastSlash);
        const flags = (raw.slice(lastSlash + 1) || 'i').replace(/g/g, '');
        try {
          new RegExp(pattern, flags);
        } catch (err) {
          return {
            error: `Invalid --filter regex "${raw}": ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      }
      opts.filter = val;
    } else if (arg === '--live-ui-url' || arg.startsWith('--live-ui-url=')) {
      const val = arg.includes('=') ? arg.slice('--live-ui-url='.length) : argv[++i];
      if (!val) {
        return { error: 'Missing value for --live-ui-url' };
      }
      try {
        new URL(val);
      } catch {
        return { error: `Invalid URL for --live-ui-url: "${val}"` };
      }
      opts.liveUi = true;
      opts.liveUiUrl = val;
      opts.withBrowser = true;
    } else {
      return { error: `Unknown flag: ${arg}` };
    }
  }

  if (selectedTiers.size > 0) {
    opts.tiers = [...selectedTiers].sort((a, b) => a - b);
  }
  if (selectedFeatures.size > 0) {
    opts.features = [...selectedFeatures];
  }

  return { opts };
}

async function loadBrowserDriverIfPresent() {
  const browserPath = path.join(ROOT_DIR, 'scripts', 'e2e', 'browser.mjs');
  if (!fs.existsSync(browserPath)) return null;
  return import(pathToFileURL(browserPath).href);
}

async function loadTierSuites(opts, ctx) {
  const targetTiers =
    opts.tiers === 'all' ? [1, 2, 3, 4] : opts.tiers;

  const suites = [];
  const missingTiers = [];

  for (const spec of TIER_SPECS) {
    if (!targetTiers.includes(spec.tier)) continue;

    if (!fs.existsSync(spec.file)) {
      missingTiers.push(spec);
      continue;
    }

    const mod = await import(pathToFileURL(spec.file).href);
    const factory = mod[spec.exportName];
    if (typeof factory !== 'function') {
      throw new Error(
        `Tier ${spec.tier} module (${path.relative(ROOT_DIR, spec.file)}) does not export ${spec.exportName}(ctx)`
      );
    }

    const rawCases = await factory(ctx);
    if (!Array.isArray(rawCases)) {
      throw new Error(
        `${spec.exportName}(ctx) in ${path.relative(ROOT_DIR, spec.file)} must return an array`
      );
    }

    const suite = defineSuite({ tier: spec.tier, name: spec.name, cases: rawCases });
    if (opts.requireAllTiers && suite.cases.length === 0) {
      throw new Error(`Tier ${spec.tier} module (${path.relative(ROOT_DIR, spec.file)}) returned 0 test cases`);
    }
    suites.push(suite);
  }

  if (missingTiers.length > 0) {
    const names = missingTiers.map((m) => `Tier ${m.tier} (${path.relative(ROOT_DIR, m.file)})`).join(', ');
    if (opts.requireAllTiers || opts.explicitTiers) {
      throw new Error(`Missing required tier module(s): ${names}`);
    }
    console.warn(`[WARN] Progressive mode: missing tier module(s) skipped: ${names}`);
  }

  validateUniqueCaseIds(suites);
  return { suites, missingTiers };
}

function verifyAllTierCoverageInvariants(suites) {
  const byTier = new Map(suites.map((s) => [s.tier, s.cases]));
  const t1 = byTier.get(1) || [];
  const t2 = byTier.get(2) || [];
  const t3 = byTier.get(3) || [];
  const t4 = byTier.get(4) || [];

  for (const fid of ALL_FEATURES) {
    const c1 = t1.filter((tc) => tc.featureIds.includes(fid)).length;
    const c2 = t2.filter((tc) => tc.featureIds.includes(fid)).length;
    if (c1 < 5) {
      throw new Error(`Coverage invariant failed: Tier 1 has only ${c1} cases for ${fid} (expected >= 5)`);
    }
    if (c2 < 5) {
      throw new Error(`Coverage invariant failed: Tier 2 has only ${c2} cases for ${fid} (expected >= 5)`);
    }
  }
  if (t3.length < 16) {
    throw new Error(`Coverage invariant failed: Tier 3 has only ${t3.length} cases (expected >= 16)`);
  }
  if (t4.length < 8) {
    throw new Error(`Coverage invariant failed: Tier 4 has only ${t4.length} cases (expected >= 8)`);
  }
}

function formatFeatureCoverage(suites) {
  const counts = {};
  for (const fid of ALL_FEATURES) {
    counts[fid] = { t1: 0, t2: 0, t3: 0, t4: 0 };
  }
  for (const s of suites) {
    for (const tc of s.cases) {
      for (const fid of tc.featureIds) {
        if (!counts[fid]) counts[fid] = { t1: 0, t2: 0, t3: 0, t4: 0 };
        counts[fid][`t${tc.tier}`] += 1;
      }
    }
  }
  return counts;
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.error) {
    console.error(`Error: ${parsed.error}\n`);
    printHelp();
    process.exit(2);
  }

  const { opts } = parsed;
  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  const browserMod = await loadBrowserDriverIfPresent();
  const detectedBrowserExe = browserMod?.findBrowserExecutable?.() || null;

  let withBrowser = opts.withBrowser;
  if (withBrowser === null) {
    withBrowser = Boolean(detectedBrowserExe);
  }

  const uiUrl = opts.liveUiUrl || (opts.liveUi ? LIVE_UI_URL : BASE_URL);
  const ctx = {
    baseUrl: BASE_URL,
    mcpHttpUrl: MCP_HTTP_URL,
    wsUrl: WS_URL,
    uiUrl,
    withBrowser,
    liveUi: opts.liveUi,
  };

  const { suites, missingTiers } = await loadTierSuites(opts, ctx);

  if (opts.requireAllTiers) {
    verifyAllTierCoverageInvariants(suites);
  }

  if (opts.syntaxOnly) {
    const browserExports = browserMod ? Object.keys(browserMod).sort() : [];
    console.log(
      `[syntax-only] OK — harness.mjs loaded, browser.mjs ${browserMod ? `loaded (${browserExports.length} exports)` : 'missing'}, ${suites.length} tier module(s) validated (${suites.reduce((a, s) => a + s.cases.length, 0)} cases).`
    );
    if (opts.json) {
      const payload = {
        mode: 'syntax-only',
        ok: true,
        tiersLoaded: suites.map((s) => s.tier),
        missingTiers: missingTiers.map((m) => m.tier),
        totalCases: suites.reduce((a, s) => a + s.cases.length, 0),
      };
      assertNoSecretLeak(payload, 'syntax-only json');
      console.log(JSON.stringify(payload, null, 2));
    }
    process.exit(0);
  }

  const planResult = await runSuites(suites, {
    tiers: opts.tiers,
    features: opts.features,
    filter: opts.filter,
    withBrowser,
    dryRun: true,
    list: opts.list,
    baseUrl: BASE_URL,
    mcpHttpUrl: MCP_HTTP_URL,
    wsUrl: WS_URL,
    uiUrl,
    liveUi: opts.liveUi,
  });

  if (opts.list) {
    console.log('=== GeoGuessr-MCP E2E Test Cases ===');
    for (const sr of planResult.suites) {
      console.log(`\n${sr.name} (${sr.total} selected)`);
      for (const r of sr.results) {
        console.log(`  [Tier ${r.tier}] ${r.id} (${r.kind}) [${r.featureIds.join(',')}] — ${r.title}`);
      }
    }
    const cov = formatFeatureCoverage(suites);
    console.log('\n=== Feature Coverage (Loaded Tiers) ===');
    for (const fid of ALL_FEATURES) {
      const c = cov[fid];
      console.log(`  ${fid.padEnd(3)} : T1=${c.t1} T2=${c.t2} T3=${c.t3} T4=${c.t4}`);
    }
    console.log(`\nTotal matching cases: ${planResult.summary.total}`);
    if (opts.json) {
      const payload = { mode: 'list', ok: true, summary: planResult.summary, coverage: cov };
      assertNoSecretLeak(payload, 'list json');
      console.log(JSON.stringify(payload, null, 2));
    }
    process.exit(0);
  }

  if (opts.dryRun) {
    let buildReady = true;
    let buildWarning = null;
    try {
      checkBuildArtifacts();
    } catch (err) {
      buildReady = false;
      buildWarning = err.message;
      if (opts.requireBuild) {
        throw err;
      }
    }

    console.log('=== GeoGuessr-MCP E2E Dry Run ===');
    console.log(`Backend target   : ${BASE_URL} (isolated port 3101)`);
    console.log(`MCP HTTP target  : ${MCP_HTTP_URL} (isolated port 3102)`);
    console.log(`Browser UI target: ${uiUrl} (withBrowser=${withBrowser}${detectedBrowserExe ? `, exe=${detectedBrowserExe}` : ''})`);
    console.log(`Skip server      : ${opts.skipServer}`);
    console.log(`Build artifacts  : ${buildReady ? 'READY' : `WARN — ${buildWarning}`}`);
    console.log(`Tiers loaded     : ${suites.map((s) => `T${s.tier}(${s.cases.length})`).join(', ') || 'none'}`);
    console.log(`Selected cases   : ${planResult.summary.total} (browser-skipped: ${planResult.summary.skipped})`);
    if (opts.json) {
      const payload = {
        mode: 'dry-run',
        ok: true,
        buildReady,
        withBrowser,
        uiUrl,
        summary: planResult.summary,
      };
      assertNoSecretLeak(payload, 'dry-run json');
      console.log(JSON.stringify(payload, null, 2));
    }
    process.exit(0);
  }

  // Live execution
  if (suites.length === 0 || planResult.summary.total === 0) {
    console.log('[WARN] No E2E test cases matched or loaded; nothing to execute.');
    process.exit(0);
  }

  const selectedCases = planResult.suites.flatMap((s) => s.results);
  const activeCases = selectedCases.filter((r) => r.status !== 'skipped');
  const needsBrowserLaunch =
    withBrowser && activeCases.some((r) => r.requiresBrowser ?? r.kind === 'browser');
  const needsApiOrWs = activeCases.some((r) => r.kind !== 'browser');
  const needsMcpServer = activeCases.some((r) => r.requiresMcp ?? r.kind === 'mcp');

  if (needsBrowserLaunch && !browserMod) {
    throw new Error('Browser tests requested (--with-browser), but scripts/e2e/browser.mjs is missing.');
  }

  let browserSession = null;

  try {
    if (opts.skipServer) {
      if (needsApiOrWs || (!opts.liveUi && activeCases.length > 0)) {
        await waitForHttpOk(`${BASE_URL}/api/health`, 5000);
      }
      if (needsMcpServer) {
        await waitForHttpOk(`${MCP_HTTP_URL}/health`, 5000);
      }
    } else {
      checkBuildArtifacts();
      console.log(`[E2E] Starting isolated backend at ${BASE_URL}...`);
      await startIsolatedBackend();
      console.log(`[E2E] Starting isolated MCP HTTP/SSE server at ${MCP_HTTP_URL}...`);
      await startIsolatedMcpServer({ backendUrl: BASE_URL });
    }

    if (needsBrowserLaunch) {
      console.log(`[E2E] Launching isolated headless browser targeting ${uiUrl}...`);
      browserSession = await browserMod.launchBrowser({ headless: true });
    }

    const result = await runSuites(suites, {
      tiers: opts.tiers,
      features: opts.features,
      filter: opts.filter,
      withBrowser,
      baseUrl: BASE_URL,
      mcpHttpUrl: MCP_HTTP_URL,
      wsUrl: WS_URL,
      uiUrl,
      liveUi: opts.liveUi,
      liveUiUrl: opts.liveUiUrl,
      skipServer: opts.skipServer,
      helpersFactory: () => ({
        browser: browserSession,
        browserDriver: browserMod,
        openBrowserTab: (targetUrl = uiUrl) => {
          if (!browserSession || !browserMod) {
            throw new Error('Browser session is not initialized (pass --with-browser)');
          }
          return browserMod.openTab(browserSession, targetUrl);
        },
      }),
    });

    console.log('\n=== E2E Execution Summary ===');
    for (const sr of result.suites) {
      console.log(
        `  ${sr.name}: total=${sr.total}, passed=${sr.passed}, failed=${sr.failed}, skipped=${sr.skipped} (${sr.durationMs}ms)`
      );
    }
    console.log(
      `OVERALL: total=${result.summary.total}, passed=${result.summary.passed}, failed=${result.summary.failed}, skipped=${result.summary.skipped} (${result.summary.durationMs}ms)`
    );

    const summaryText = JSON.stringify(result.summary);
    assertNoSecretLeak(summaryText, 'runner summary');

    if (opts.json) {
      const safeJson = scrubSecrets(JSON.stringify(result, null, 2));
      assertNoSecretLeak(safeJson, 'runner json output');
      console.log(safeJson);
    }

    process.exitCode = result.ok ? 0 : 1;
  } finally {
    if (browserSession && browserMod) {
      await browserMod.closeBrowser(browserSession).catch(() => {});
    }
    if (!opts.skipServer) {
      await stopAllServers().catch(() => {});
    }
  }
}

main().catch((err) => {
  console.error('E2E RUNNER ERROR:', scrubSecrets(err?.stack || err?.message || String(err)));
  process.exit(1);
});
