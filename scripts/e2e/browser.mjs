import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseCheckboxBoolean(val) {
  if (typeof val === 'string') {
    return !['', '0', 'false', 'off', 'no'].includes(val.trim().toLowerCase());
  }
  return Boolean(val);
}

const SECRET_ENV_KEYS = ['MAPILLARY_ACCESS_TOKEN', 'GOOGLE_MAPS_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'];
const SECRET_PATTERNS = [
  /MLY\|[A-Za-z0-9_|-]{8,}/g,
  /AIza[0-9A-Za-z_-]{16,}/g,
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /Bearer\s+[A-Za-z0-9._-]{16,}/gi,
];

function scrubBrowserText(input) {
  let text = typeof input === 'string' ? input : String(input ?? '');
  for (const key of SECRET_ENV_KEYS) {
    const val = process.env[key];
    if (typeof val === 'string' && val.trim().length >= 8 && text.includes(val.trim())) {
      text = text.split(val.trim()).join('[REDACTED]');
    }
  }
  for (const regex of SECRET_PATTERNS) {
    regex.lastIndex = 0;
    text = text.replace(regex, '[REDACTED]');
  }
  return text;
}

let defaultSession = null;
const activeSessions = new Set();
let browserExitHookRegistered = false;

function registerBrowserExitHook() {
  if (browserExitHookRegistered) return;
  browserExitHookRegistered = true;
  process.once('exit', () => {
    for (const session of activeSessions) {
      try {
        if (session.proc && session.proc.exitCode === null) {
          if (process.platform === 'win32' && session.pid) {
            execFile('taskkill', ['/PID', String(session.pid), '/T', '/F'], () => {});
          } else {
            session.proc.kill('SIGKILL');
          }
        }
      } catch {
        // ignore
      }
    }
  });
}

function getCandidateExecutablePaths(preferredPath) {
  const candidates = [];
  if (preferredPath) candidates.push(preferredPath);
  if (process.env.E2E_BROWSER_PATH) candidates.push(process.env.E2E_BROWSER_PATH);

  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || '';
    candidates.push(
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      ...(localAppData ? [path.join(localAppData, 'Microsoft', 'Edge', 'Application', 'msedge.exe')] : []),
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      ...(localAppData ? [path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe')] : [])
    );
  } else if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium'
    );
  } else {
    candidates.push(
      '/usr/bin/microsoft-edge',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser'
    );
  }

  return candidates.filter(Boolean);
}

export function findBrowserExecutable(preferredPath) {
  const candidates = getCandidateExecutablePaths(preferredPath);
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      // ignore
    }
  }
  return null;
}

async function getWebSocketImpl() {
  if (typeof globalThis.WebSocket === 'function') {
    return globalThis.WebSocket;
  }
  const mod = await import('ws');
  return mod.WebSocket || mod.default;
}

async function waitForCdpEndpoint(proc, userDataDir, timeoutMs) {
  const activePortFile = path.join(userDataDir, 'DevToolsActivePort');
  let stderrTail = '';

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err, result) => {
      if (settled) return;
      settled = true;
      clearInterval(pollTimer);
      clearTimeout(timeoutTimer);
      proc.stderr?.off('data', onStderr);
      proc.off('exit', onExit);
      if (err) reject(err);
      else resolve(result);
    };

    const onStderr = (chunk) => {
      const text = scrubBrowserText(String(chunk));
      stderrTail = (stderrTail + text).slice(-4000);
      const match = stderrTail.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        const wsUrl = match[1];
        try {
          const parsed = new URL(wsUrl);
          finish(null, { port: Number(parsed.port), wsUrl });
        } catch {
          // keep waiting
        }
      }
    };

    const onExit = (code, signal) => {
      finish(
        new Error(
          `Headless browser exited prematurely (code=${code}, signal=${signal}). stderr:\n${stderrTail}`
        )
      );
    };

    const pollTimer = setInterval(() => {
      try {
        if (!fs.existsSync(activePortFile)) return;
        const raw = fs.readFileSync(activePortFile, 'utf8').trim();
        const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        if (lines.length >= 2) {
          const port = Number(lines[0]);
          const wsPath = lines[1];
          if (Number.isInteger(port) && port > 0 && wsPath.startsWith('/')) {
            finish(null, { port, wsUrl: `ws://127.0.0.1:${port}${wsPath}` });
          }
        }
      } catch {
        // file may still be flushing
      }
    }, 40);

    const timeoutTimer = setTimeout(() => {
      finish(
        new Error(
          `Timed out after ${timeoutMs}ms waiting for browser DevTools endpoint. stderr:\n${stderrTail}`
        )
      );
    }, timeoutMs);

    proc.stderr?.on('data', onStderr);
    proc.once('exit', onExit);
  });
}

async function connectCdpSocket(wsUrl, timeoutMs = 10000) {
  const WS = await getWebSocketImpl();
  const ws = new WS(wsUrl);

  let nextId = 0;
  const pending = new Map();
  const sessionListeners = new Map();

  const rejectAllPending = (err) => {
    for (const [, entry] of pending) {
      clearTimeout(entry.timer);
      entry.reject(err);
    }
    pending.clear();
  };

  const handleMessage = async (rawData) => {
    let text;
    if (typeof rawData === 'string') {
      text = rawData;
    } else if (rawData instanceof ArrayBuffer) {
      text = Buffer.from(rawData).toString('utf8');
    } else if (ArrayBuffer.isView(rawData)) {
      text = Buffer.from(rawData.buffer, rawData.byteOffset, rawData.byteLength).toString('utf8');
    } else if (typeof Blob !== 'undefined' && rawData instanceof Blob) {
      text = await rawData.text();
    } else {
      text = String(rawData);
    }

    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }

    if (typeof msg.id === 'number' && pending.has(msg.id)) {
      const entry = pending.get(msg.id);
      pending.delete(msg.id);
      clearTimeout(entry.timer);
      if (msg.error) {
        entry.reject(
          new Error(`CDP ${entry.method} failed (${msg.error.code}): ${msg.error.message}`)
        );
      } else {
        entry.resolve(msg.result || {});
      }
      return;
    }

    if (msg.method) {
      const listeners = sessionListeners.get(msg.sessionId || '__browser__');
      if (listeners) {
        for (const fn of listeners) {
          try {
            fn(msg.method, msg.params || {});
          } catch {
            // ignore listener errors
          }
        }
      }
    }
  };

  if (typeof ws.addEventListener === 'function') {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out connecting CDP WebSocket: ${wsUrl}`)), timeoutMs);
      ws.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      });
      ws.addEventListener('error', (ev) => {
        clearTimeout(timer);
        reject(new Error(`CDP WebSocket error: ${ev?.message || 'connection failed'}`));
      });
      ws.addEventListener('message', (ev) => {
        void handleMessage(ev.data);
      });
      ws.addEventListener('close', () => {
        rejectAllPending(new Error('CDP WebSocket closed'));
      });
    });
  } else {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out connecting CDP WebSocket: ${wsUrl}`)), timeoutMs);
      ws.once('open', () => {
        clearTimeout(timer);
        resolve();
      });
      ws.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      ws.on('message', (data) => {
        void handleMessage(data);
      });
      ws.once('close', () => {
        rejectAllPending(new Error('CDP WebSocket closed'));
      });
    });
  }

  const send = (method, params = {}, sessionId = undefined, cmdTimeoutMs = 15000) => {
    const openState = typeof WS.OPEN === 'number' ? WS.OPEN : 1;
    if (ws.readyState !== openState) {
      return Promise.reject(
        new Error(`CDP WebSocket is not open (readyState=${ws.readyState}) for ${method}`)
      );
    }

    const id = ++nextId;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP command timed out (${cmdTimeoutMs}ms): ${method}`));
      }, cmdTimeoutMs);

      pending.set(id, { method, resolve, reject, timer });
      try {
        ws.send(JSON.stringify(payload));
      } catch (err) {
        clearTimeout(timer);
        pending.delete(id);
        reject(err);
      }
    });
  };

  const subscribeSession = (sessionId, listener) => {
    const key = sessionId || '__browser__';
    if (!sessionListeners.has(key)) sessionListeners.set(key, new Set());
    sessionListeners.get(key).add(listener);
    return () => {
      sessionListeners.get(key)?.delete(listener);
    };
  };

  const closeSocket = async () => {
    try {
      ws.close();
    } catch {
      // ignore
    }
  };

  return { ws, send, subscribeSession, closeSocket };
}

async function removeDirWithRetry(dirPath, attempts = 8) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      if (!fs.existsSync(dirPath)) return;
      fs.rmSync(dirPath, { recursive: true, force: true });
      if (!fs.existsSync(dirPath)) return;
    } catch {
      // Windows file handles can take a moment to release after process exit
    }
    await sleep(120 * (i + 1));
  }
}

async function launchPlaywrightFallback(options) {
  let pw;
  try {
    pw = await import('playwright');
  } catch {
    try {
      pw = await import('playwright-core');
    } catch {
      return null;
    }
  }

  const browser = await pw.chromium.launch({ headless: options.headless !== false });
  const context = await browser.newContext({
    viewport: options.viewport || { width: 1440, height: 900 },
  });

  const session = {
    engine: 'playwright',
    pid: null,
    port: null,
    wsUrl: null,
    userDataDir: null,
    tabs: new Set(),
    async openTab(url) {
      const page = await context.newPage();
      const consoleErrors = [];
      const pageErrors = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(scrubBrowserText(msg.text()));
      });
      page.on('pageerror', (err) => {
        pageErrors.push(scrubBrowserText(err?.message || String(err)));
      });
      if (url && url !== 'about:blank') {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
      }
      const tab = {
        engine: 'playwright',
        targetId: null,
        sessionId: null,
        browser: session,
        consoleErrors,
        pageErrors,
        clearErrors() {
          consoleErrors.length = 0;
          pageErrors.length = 0;
        },
        async navigate(nextUrl) {
          await page.goto(nextUrl, { waitUntil: 'domcontentloaded' });
        },
        async reload() {
          await page.reload({ waitUntil: 'domcontentloaded' });
        },
        async setViewport(width, height) {
          await page.setViewportSize({ width, height });
        },
        async eval(expr) {
          return typeof expr === 'function' ? page.evaluate(expr) : page.evaluate(expr);
        },
        async waitForSelector(selector, timeoutMs = 10000, opts = {}) {
          await page.waitForSelector(selector, {
            timeout: timeoutMs,
            state: opts?.allowHidden ? 'attached' : 'visible',
          });
          return true;
        },
        async clickSelector(selector, timeoutMs = 5000) {
          await page.click(selector, { timeout: timeoutMs });
        },
        async setInputValue(selector, value, timeoutMs = 5000) {
          const safeVal = value === undefined ? '' : value;
          await page.waitForSelector(selector, { timeout: timeoutMs });
          const meta = await page.$eval(selector, (el) => ({
            tag: el.tagName.toLowerCase(),
            type: (el.getAttribute('type') || '').toLowerCase(),
            disabled: Boolean('disabled' in el && el.disabled),
          }));
          if (meta.disabled) {
            throw new Error(`setInputValue(${selector}) failed: disabled`);
          }
          if (meta.tag === 'select') {
            await page.selectOption(selector, String(safeVal), { timeout: timeoutMs });
            return;
          }
          if (meta.tag === 'input' && meta.type === 'checkbox') {
            await page.setChecked(selector, parseCheckboxBoolean(safeVal), { timeout: timeoutMs });
            return;
          }
          if (meta.tag === 'input' && meta.type === 'radio') {
            const want = parseCheckboxBoolean(safeVal);
            if (want) {
              await page.check(selector, { timeout: timeoutMs });
            } else {
              await page.$eval(selector, (el) => {
                if (el.checked) {
                  const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked');
                  if (desc && desc.set) desc.set.call(el, false);
                  else el.checked = false;
                  el.dispatchEvent(new Event('input', { bubbles: true }));
                  el.dispatchEvent(new Event('change', { bubbles: true }));
                }
              });
            }
            return;
          }
          if (meta.tag === 'input' && meta.type === 'range') {
            await page.$eval(
              selector,
              (el, next) => {
                const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
                if (desc && desc.set) desc.set.call(el, String(next));
                else el.value = String(next);
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
              },
              safeVal
            );
            return;
          }
          await page.fill(selector, String(safeVal), { timeout: timeoutMs });
        },
        async close() {
          session.tabs.delete(tab);
          await page.close();
        },
      };
      session.tabs.add(tab);
      return tab;
    },
    async close() {
      activeSessions.delete(session);
      if (defaultSession === session) defaultSession = null;
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    },
  };

  activeSessions.add(session);
  defaultSession = session;
  return session;
}

export async function launchBrowser(options = {}) {
  const headless = options.headless !== false;
  const timeoutMs = options.timeoutMs ?? 15000;
  const viewport = options.viewport || { width: 1440, height: 900 };
  const usePlaywrightIfNoBinary = options.usePlaywrightIfNoBinary !== false;

  if (options.engine === 'playwright') {
    const pwSession = await launchPlaywrightFallback(options);
    if (!pwSession) {
      throw new Error('Playwright engine requested, but neither playwright nor playwright-core is installed.');
    }
    return pwSession;
  }

  const executablePath = findBrowserExecutable(options.executablePath);
  if (!executablePath) {
    if (usePlaywrightIfNoBinary) {
      const pwSession = await launchPlaywrightFallback(options);
      if (pwSession) return pwSession;
    }
    const checked = getCandidateExecutablePaths(options.executablePath).join(', ');
    throw new Error(`No Edge/Chrome executable found for headless CDP. Checked: ${checked}`);
  }

  registerBrowserExitHook();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geoguessr-e2e-cdp-'));

  const args = [
    headless ? '--headless=new' : null,
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-popup-blocking',
    'about:blank',
  ].filter(Boolean);

  const proc = spawn(executablePath, args, {
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  });

  const exitPromise = new Promise((resolve) => {
    proc.once('exit', (code, signal) => resolve({ code, signal }));
  });

  let cdp = null;
  let session = null;

  try {
    const { port, wsUrl } = await waitForCdpEndpoint(proc, userDataDir, timeoutMs);
    cdp = await connectCdpSocket(wsUrl, timeoutMs);

    session = {
      engine: 'cdp',
      executablePath,
      pid: proc.pid,
      port,
      wsUrl,
      userDataDir,
      proc,
      exitPromise,
      cdp,
      viewport,
      tabs: new Set(),
      closed: false,
      openTab: (url) => openTab(session, url),
      close: () => closeBrowser(session),
    };

    activeSessions.add(session);
    defaultSession = session;
    return session;
  } catch (err) {
    try {
      await cdp?.closeSocket();
    } catch {
      // ignore
    }
    if (proc.exitCode === null) {
      if (process.platform === 'win32' && proc.pid) {
        await new Promise((resolve) => {
          execFile('taskkill', ['/PID', String(proc.pid), '/T', '/F'], () => resolve());
        });
      } else {
        proc.kill('SIGKILL');
      }
      await Promise.race([exitPromise, sleep(2000)]);
    }
    await removeDirWithRetry(userDataDir);
    throw err;
  }
}

function resolveBrowserAndUrl(browserOrUrl, maybeUrl) {
  if (typeof browserOrUrl === 'string') {
    if (!defaultSession) {
      throw new Error('No active browser session. Call launchBrowser() before openTab(url).');
    }
    return { browser: defaultSession, url: browserOrUrl };
  }
  return { browser: browserOrUrl || defaultSession, url: maybeUrl || 'about:blank' };
}

function formatRemoteArg(arg) {
  if (!arg) return '';
  if (arg.description) return String(arg.description);
  if (arg.value !== undefined) {
    try {
      return typeof arg.value === 'string' ? arg.value : JSON.stringify(arg.value);
    } catch {
      return String(arg.value);
    }
  }
  return arg.type || '';
}

async function waitForReadyState(tab, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const state = await evalInTab(tab, 'document.readyState');
      if (state === 'interactive' || state === 'complete') {
        return state;
      }
    } catch {
      // page context may be mid-navigation
    }
    await sleep(40);
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for document.readyState`);
}

export async function openTab(browserOrUrl, maybeUrl) {
  const { browser, url } = resolveBrowserAndUrl(browserOrUrl, maybeUrl);
  if (!browser) {
    throw new Error('No active browser session. Call launchBrowser() first.');
  }
  if (browser.engine === 'playwright') {
    return browser.openTab(url);
  }

  const { targetId } = await browser.cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await browser.cdp.send('Target.attachToTarget', {
    targetId,
    flatten: true,
  });

  const consoleErrors = [];
  const pageErrors = [];

  const unsubscribe = browser.cdp.subscribeSession(sessionId, (method, params) => {
    if (method === 'Runtime.consoleAPICalled' && params.type === 'error') {
      const text = (params.args || []).map(formatRemoteArg).join(' ').trim() || 'console.error';
      consoleErrors.push(scrubBrowserText(text));
    } else if (method === 'Runtime.exceptionThrown') {
      const details = params.exceptionDetails || {};
      const msg =
        details.exception?.description ||
        details.exception?.value ||
        details.text ||
        'Uncaught page exception';
      pageErrors.push(scrubBrowserText(String(msg)));
    }
  });

  await browser.cdp.send('Page.enable', {}, sessionId);
  await browser.cdp.send('Runtime.enable', {}, sessionId);
  const vp = browser.viewport || { width: 1440, height: 900 };
  await browser.cdp.send(
    'Emulation.setDeviceMetricsOverride',
    { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: false },
    sessionId
  );

  const tab = {
    engine: 'cdp',
    targetId,
    sessionId,
    browser,
    consoleErrors,
    pageErrors,
    unsubscribe,
    closed: false,
    clearErrors() {
      consoleErrors.length = 0;
      pageErrors.length = 0;
    },
    async navigate(nextUrl) {
      const nav = await browser.cdp.send('Page.navigate', { url: nextUrl }, sessionId);
      if (nav.errorText) {
        throw new Error(`Navigation to ${nextUrl} failed: ${nav.errorText}`);
      }
      await waitForReadyState(tab, 15000);
    },
    async reload(ignoreCache = false) {
      await browser.cdp.send('Page.reload', { ignoreCache }, sessionId);
      await sleep(50);
      await waitForReadyState(tab, 15000);
    },
    async setViewport(width, height) {
      await browser.cdp.send(
        'Emulation.setDeviceMetricsOverride',
        { width, height, deviceScaleFactor: 1, mobile: false },
        sessionId
      );
    },
    eval: (expr) => evalInTab(tab, expr),
    waitForSelector: (selector, timeoutMs, opts) => waitForSelector(tab, selector, timeoutMs, opts),
    clickSelector: (selector, timeoutMs) => clickSelector(tab, selector, timeoutMs),
    setInputValue: (selector, value, timeoutMs) => setInputValue(tab, selector, value, timeoutMs),
    close: () => closeTab(tab),
  };

  browser.tabs.add(tab);

  if (url && url !== 'about:blank') {
    await tab.navigate(url);
  }

  return tab;
}

export async function closeTab(tab) {
  if (!tab || tab.closed) return;
  tab.closed = true;
  if (tab.engine === 'playwright') {
    await tab.close();
    return;
  }
  tab.browser?.tabs?.delete(tab);
  tab.unsubscribe?.();
  try {
    await tab.browser.cdp.send('Target.closeTarget', { targetId: tab.targetId }, undefined, 3000);
  } catch {
    // target may already be closed
  }
}

export async function evalInTab(tab, expr) {
  if (!tab) throw new Error('evalInTab requires a valid tab handle');
  if (tab.engine === 'playwright') {
    return tab.eval(expr);
  }

  const expression = typeof expr === 'function' ? `(${expr.toString()})()` : String(expr);
  const res = await tab.browser.cdp.send(
    'Runtime.evaluate',
    {
      expression,
      awaitPromise: true,
      returnByValue: true,
    },
    tab.sessionId
  );

  if (res.exceptionDetails) {
    const details = res.exceptionDetails;
    const msg =
      details.exception?.description ||
      details.exception?.value ||
      details.text ||
      'Runtime.evaluate exception';
    throw new Error(`evalInTab error: ${scrubBrowserText(String(msg))}`);
  }

  return res.result?.value;
}

const TRANSIENT_EVAL_ERROR_RE =
  /Execution context was destroyed|Cannot find context with specified id|Cannot find execution context/i;

function isTransientEvalError(tab, err) {
  if (!tab || tab.closed) return false;
  const msg = err?.message || String(err || '');
  return TRANSIENT_EVAL_ERROR_RE.test(msg);
}

export async function waitForSelector(tab, selector, timeoutMs = 10000, opts = {}) {
  if (tab.engine === 'playwright') {
    return tab.waitForSelector(selector, timeoutMs, opts);
  }

  const allowHidden = Boolean(opts.allowHidden);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const found = await evalInTab(
        tab,
        `(() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return false;
          if (${allowHidden}) return true;
          const st = window.getComputedStyle(el);
          return st.display !== 'none' && st.visibility !== 'hidden';
        })()`
      );
      if (found) return true;
    } catch (err) {
      if (!isTransientEvalError(tab, err)) throw err;
    }
    await sleep(50);
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for selector: ${selector}`);
}

export async function clickSelector(tab, selector, timeoutMs = 5000) {
  if (tab.engine === 'playwright') {
    return tab.clickSelector(selector, timeoutMs);
  }

  await waitForSelector(tab, selector, timeoutMs);
  const res = await evalInTab(
    tab,
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return { ok: false, reason: 'not_found' };
      if ('disabled' in el && el.disabled) return { ok: false, reason: 'disabled' };
      el.scrollIntoView({ block: 'center', inline: 'center' });
      el.click();
      return { ok: true };
    })()`
  );
  if (!res?.ok) {
    throw new Error(`clickSelector(${selector}) failed: ${res?.reason || 'unknown'}`);
  }
}

export async function setInputValue(tab, selector, value, timeoutMs = 5000) {
  if (tab.engine === 'playwright') {
    return tab.setInputValue(selector, value, timeoutMs);
  }

  await waitForSelector(tab, selector, timeoutMs);
  const res = await evalInTab(
    tab,
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return { ok: false, reason: 'not_found' };
      if ('disabled' in el && el.disabled) return { ok: false, reason: 'disabled' };
      const nextVal = ${JSON.stringify(value === undefined ? '' : value)};
      const tag = el.tagName.toLowerCase();
      if (tag === 'input' && (el.type === 'checkbox' || el.type === 'radio')) {
        const want =
          typeof nextVal === 'string'
            ? !['', '0', 'false', 'off', 'no'].includes(nextVal.trim().toLowerCase())
            : Boolean(nextVal);
        if (el.checked !== want) {
          const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked');
          if (desc && desc.set) desc.set.call(el, want);
          else el.checked = want;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return { ok: true };
      }
      const proto =
        tag === 'select'
          ? HTMLSelectElement.prototype
          : tag === 'textarea'
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && desc.set) desc.set.call(el, String(nextVal));
      else el.value = String(nextVal);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true };
    })()`
  );
  if (!res?.ok) {
    throw new Error(`setInputValue(${selector}) failed: ${res?.reason || 'unknown'}`);
  }
}

export async function waitForText(tab, selector, substring, timeoutMs = 10000) {
  const needle = String(substring);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const matched = await evalInTab(
        tab,
        `(() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return false;
          return (el.textContent || '').includes(${JSON.stringify(needle)});
        })()`
      );
      if (matched) return true;
    } catch (err) {
      if (!isTransientEvalError(tab, err)) throw err;
    }
    await sleep(50);
  }
  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for text ${JSON.stringify(needle)} inside ${selector}`
  );
}

export async function waitForCondition(tab, fnOrExpr, timeoutMs = 10000, pollMs = 50) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const val = await evalInTab(tab, fnOrExpr);
      if (val) return val;
    } catch (err) {
      if (!isTransientEvalError(tab, err)) throw err;
    }
    await sleep(pollMs);
  }
  const snippet = String(fnOrExpr).replace(/\s+/g, ' ').slice(0, 220);
  throw new Error(`Timed out after ${timeoutMs}ms waiting for browser condition: ${snippet}`);
}

export function getErrors(tab) {
  return {
    consoleErrors: [...(tab?.consoleErrors || [])],
    pageErrors: [...(tab?.pageErrors || [])],
  };
}

export async function closeBrowser(browser) {
  const target = browser || defaultSession;
  if (!target) return;
  if (target.engine === 'playwright') {
    await target.close();
    return;
  }
  if (target.closed) return;
  target.closed = true;

  activeSessions.delete(target);
  if (defaultSession === target) defaultSession = null;

  for (const tab of [...target.tabs]) {
    await closeTab(tab).catch(() => {});
  }

  try {
    await Promise.race([target.cdp.send('Browser.close', {}, undefined, 2500), sleep(2500)]);
  } catch {
    // ignore
  }

  await target.cdp.closeSocket().catch(() => {});

  const exited = await Promise.race([
    target.exitPromise.then(() => true),
    sleep(2500).then(() => false),
  ]);

  if (!exited && target.proc && target.proc.exitCode === null) {
    try {
      target.proc.kill();
    } catch {
      // ignore
    }
    const afterKill = await Promise.race([
      target.exitPromise.then(() => true),
      sleep(1000).then(() => false),
    ]);
    if (!afterKill && process.platform === 'win32' && target.pid) {
      await new Promise((resolve) => {
        execFile('taskkill', ['/PID', String(target.pid), '/T', '/F'], () => resolve());
      });
      await Promise.race([target.exitPromise, sleep(1500)]);
    }
  }

  if (target.userDataDir) {
    await removeDirWithRetry(target.userDataDir);
  }
}
