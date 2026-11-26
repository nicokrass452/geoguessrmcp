import { useState } from 'react';
import {
  Activity,
  Bot,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Copy,
  Eye,
  EyeOff,
  Loader2,
  Play,
  Plug,
  Sparkles,
  Square,
  Terminal,
  X,
} from 'lucide-react';
import {
  headingToCompass,
  type ActivityEvent,
  type AgentStatus,
  type AgyRunnerStatus,
  type PlayerInfo,
  type RoundStatus,
} from '@geoguessr-mcp/shared';
import { api } from '../lib/api';

interface AgentHudProps {
  agents: PlayerInfo[];
  activityFeed: ActivityEvent[];
  agyRunner?: AgyRunnerStatus;
  roundStatus: RoundStatus;
  onError?: (msg: string) => void;
}

function statusBadge(status: AgentStatus): { label: string; cls: string } {
  switch (status) {
    case 'guessed':
      return {
        label: 'Guessed!',
        cls: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
      };
    case 'moving':
      return {
        label: 'Moving...',
        cls: 'bg-violet-500/20 text-violet-300 border-violet-500/30',
      };
    case 'thinking':
      return {
        label: 'Thinking...',
        cls: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
      };
    case 'disconnected':
      return {
        label: 'Offline',
        cls: 'bg-slate-700/40 text-slate-400 border-slate-600/40',
      };
    default:
      return {
        label: 'Exploring...',
        cls: 'bg-sky-500/20 text-sky-300 border-sky-500/30',
      };
  }
}

const SNIPPET_STDIO = `{
  "mcpServers": {
    "geoguessr-arena": {
      "command": "node",
      "args": [
        "C:/Users/CP/.gemini/antigravity/scratch/geoguessr-mcp/mcp-server/dist/index.js",
        "--transport", "stdio",
        "--backend-url", "http://localhost:3001",
        "--agent-name", "Antigravity"
      ]
    }
  }
}`;

const SNIPPET_HTTP = `# 1. Start Streamable HTTP + SSE bridge (port 3002):
npm run mcp:http

# 2a. Antigravity remote Streamable HTTP mcp_config.json:
{ "mcpServers": { "geoguessr": { "url": "http://localhost:3002/mcp?agentName=Antigravity" } } }

# 2b. ChatGPT / ChatGPT Work (expose via HTTPS tunnel):
cloudflared tunnel --url http://localhost:3002
# Then add Developer Mode connector URL:
https://<tunnel-url>.trycloudflare.com/mcp?agentName=ChatGPT`;

export function AgentHud({
  agents,
  activityFeed,
  agyRunner,
  roundStatus,
  onError,
}: AgentHudProps) {
  const [open, setOpen] = useState(true);
  const [autoPanelOpen, setAutoPanelOpen] = useState(true);
  const [agyBusy, setAgyBusy] = useState(false);
  const [watchedAgentId, setWatchedAgentId] = useState<string | null>(null);
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [copied, setCopied] = useState(false);

  const watchedAgent = agents.find((a) => a.id === watchedAgentId) ?? null;

  const runningCount =
    agyRunner?.runs.filter((r) => r.running).length ?? 0;

  const toggleModel = async (modelId: string) => {
    if (!agyRunner || agyBusy) return;
    setAgyBusy(true);
    try {
      const exists = agyRunner.selectedModels.includes(modelId);
      const next = exists
        ? agyRunner.selectedModels.filter((id) => id !== modelId)
        : [...agyRunner.selectedModels, modelId];
      await api.updateAgyConfig({ selectedModels: next });
    } catch (err) {
      onError?.(err instanceof Error ? err.message : String(err));
    } finally {
      setAgyBusy(false);
    }
  };

  const toggleAutoPlay = async () => {
    if (!agyRunner || agyBusy) return;
    setAgyBusy(true);
    try {
      await api.updateAgyConfig({
        autoPlayEnabled: !agyRunner.autoPlayEnabled,
      });
    } catch (err) {
      onError?.(err instanceof Error ? err.message : String(err));
    } finally {
      setAgyBusy(false);
    }
  };

  const updateBudget = async (patch: {
    maxStepsPerRound?: number;
    timeoutSec?: number;
  }) => {
    if (!agyRunner || agyBusy) return;
    setAgyBusy(true);
    try {
      await api.updateAgyConfig(patch);
    } catch (err) {
      onError?.(err instanceof Error ? err.message : String(err));
    } finally {
      setAgyBusy(false);
    }
  };

  const handleSummonNow = async () => {
    if (!agyRunner || agyBusy) return;
    setAgyBusy(true);
    try {
      await api.triggerAgyRound();
    } catch (err) {
      onError?.(err instanceof Error ? err.message : String(err));
    } finally {
      setAgyBusy(false);
    }
  };

  const handleStopRuns = async () => {
    if (!agyRunner || agyBusy) return;
    setAgyBusy(true);
    try {
      await api.stopAgyRuns();
    } catch (err) {
      onError?.(err instanceof Error ? err.message : String(err));
    } finally {
      setAgyBusy(false);
    }
  };

  const copySnippet = async () => {
    try {
      await navigator.clipboard.writeText(SNIPPET_STDIO);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="absolute top-20 left-3 z-30 flex items-center gap-2 rounded-2xl border border-white/15 bg-slate-950/85 px-3 py-2 text-xs font-semibold text-slate-100 backdrop-blur-md shadow-xl hover:bg-slate-900 transition"
      >
        <Bot className="h-4 w-4 text-sky-400" />
        <span>AI Agents ({agents.filter((a) => a.connected).length})</span>
        <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
      </button>
    );
  }

  return (
    <>
      <aside className="absolute top-20 left-3 z-30 flex w-80 max-w-[calc(100vw-24px)] max-h-[calc(100vh-220px)] flex-col overflow-hidden rounded-2xl border border-white/15 bg-slate-950/85 backdrop-blur-md shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-sky-400" />
            <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
              MCP Agents ({agents.filter((a) => a.connected).length})
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setShowConnectModal(true)}
              className="flex items-center gap-1 rounded-lg bg-sky-500/20 border border-sky-400/30 px-2 py-1 text-[11px] font-semibold text-sky-300 hover:bg-sky-500/30 transition"
            >
              <Plug className="h-3 w-3" />
              <span>Connect</span>
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              title="Minimize HUD"
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Auto-AI Opponents (agy CLI) */}
        {agyRunner && (
          <div className="border-b border-white/10 bg-slate-900/60">
            <div className="flex items-center justify-between px-3 py-2">
              <button
                type="button"
                onClick={() => setAutoPanelOpen((v) => !v)}
                className="flex items-center gap-1.5 text-[11px] font-bold text-slate-200 hover:text-white"
              >
                <Sparkles className="h-3.5 w-3.5 text-amber-400" />
                <span>Auto AI Opponents</span>
                {runningCount > 0 && (
                  <span className="flex items-center gap-1 rounded-full bg-sky-500/20 px-1.5 py-0.5 text-[9px] text-sky-300">
                    <Loader2 className="h-2.5 w-2.5 animate-spin" />
                    {runningCount} live
                  </span>
                )}
                {autoPanelOpen ? (
                  <ChevronUp className="h-3.5 w-3.5 text-slate-400" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                )}
              </button>

              <button
                type="button"
                disabled={!agyRunner.available || agyBusy}
                onClick={toggleAutoPlay}
                title="Automatically summon selected models at the start of every round"
                className={`rounded-full px-2 py-0.5 text-[10px] font-bold border transition ${
                  agyRunner.autoPlayEnabled
                    ? 'border-emerald-400/50 bg-emerald-500/20 text-emerald-300'
                    : 'border-white/10 bg-slate-800/80 text-slate-400 hover:text-slate-200'
                } disabled:opacity-40`}
              >
                {agyRunner.autoPlayEnabled ? 'Auto: ON' : 'Auto: OFF'}
              </button>
            </div>

            {autoPanelOpen && (
              <div className="px-3 pb-2.5 space-y-2">
                {!agyRunner.available ? (
                  <p className="text-[10px] text-amber-300/90">
                    <code>agy</code> CLI binary not detected. Configure{' '}
                    <code>AGY_BIN</code> or use <strong>Connect</strong> above.
                  </p>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-1">
                      {agyRunner.availableModels.map((m) => {
                        const selected = agyRunner.selectedModels.includes(m.id);
                        const run = agyRunner.runs.find(
                          (r) => r.modelId === m.id
                        );
                        const activeCls =
                          m.family === 'claude'
                            ? 'border-amber-400/60 bg-amber-500/20 text-amber-200'
                            : m.family === 'gpt'
                              ? 'border-emerald-400/60 bg-emerald-500/20 text-emerald-200'
                              : 'border-sky-400/60 bg-sky-500/20 text-sky-200';
                        return (
                          <button
                            key={m.id}
                            type="button"
                            disabled={agyBusy}
                            onClick={() => toggleModel(m.id)}
                            className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-semibold transition ${
                              selected
                                ? activeCls
                                : 'border-white/10 bg-slate-950/60 text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            {run?.running ? (
                              <Loader2 className="h-2.5 w-2.5 animate-spin" />
                            ) : selected ? (
                              <Check className="h-2.5 w-2.5" />
                            ) : null}
                            <span>{m.label}</span>
                          </button>
                        );
                      })}
                    </div>

                    <div className="flex items-center justify-between gap-1.5 text-[10px]">
                      <div className="flex items-center gap-1.5">
                        <select
                          aria-label="Max steps per round"
                          value={agyRunner.maxStepsPerRound}
                          disabled={agyBusy}
                          onChange={(e) =>
                            updateBudget({
                              maxStepsPerRound: Number(e.target.value),
                            })
                          }
                          className="rounded-lg border border-white/10 bg-slate-950 px-1.5 py-1 text-[10px] text-slate-200"
                        >
                          <option value={3}>3 steps</option>
                          <option value={5}>5 steps</option>
                          <option value={8}>8 steps</option>
                          <option value={12}>12 steps</option>
                        </select>
                        <select
                          aria-label="Timeout per round"
                          value={agyRunner.timeoutSec}
                          disabled={agyBusy}
                          onChange={(e) =>
                            updateBudget({ timeoutSec: Number(e.target.value) })
                          }
                          className="rounded-lg border border-white/10 bg-slate-950 px-1.5 py-1 text-[10px] text-slate-200"
                        >
                          <option value={60}>60s cap</option>
                          <option value={120}>120s cap</option>
                          <option value={180}>180s cap</option>
                        </select>
                      </div>

                      <div className="flex items-center gap-1">
                        {runningCount > 0 && (
                          <button
                            type="button"
                            disabled={agyBusy}
                            onClick={handleStopRuns}
                            className="flex items-center gap-1 rounded-lg border border-rose-400/40 bg-rose-500/20 px-2 py-1 font-bold text-rose-200 hover:bg-rose-500/30 transition"
                          >
                            <Square className="h-2.5 w-2.5 fill-current" />
                            <span>Stop</span>
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={
                            agyBusy ||
                            roundStatus !== 'active' ||
                            agyRunner.selectedModels.length === 0
                          }
                          onClick={handleSummonNow}
                          className="flex items-center gap-1 rounded-lg bg-sky-500 px-2.5 py-1 font-bold text-slate-950 hover:bg-sky-400 disabled:opacity-40 transition"
                        >
                          <Play className="h-2.5 w-2.5 fill-current" />
                          <span>Summon</span>
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* Agent Roster */}
        <div className="divide-y divide-white/5 overflow-y-auto custom-scrollbar max-h-56">
          {agents.length === 0 ? (
            <div className="px-3 py-4 text-center">
              <p className="text-xs text-slate-400">
                No MCP AI agents connected yet.
              </p>
              <p className="mt-1 text-[11px] text-slate-500">
                Run <code className="text-sky-300">npm run demo-agent</code> or
                click <strong>Connect</strong> above.
              </p>
            </div>
          ) : (
            agents.map((agent) => {
              const badge = statusBadge(agent.status);
              const isWatching = watchedAgentId === agent.id;
              const run = agyRunner?.runs.find((r) => r.agentId === agent.id);
              const showRunWarning =
                run &&
                (run.lastStatus === 'timeout' || run.lastStatus === 'error') &&
                run.lastMessage &&
                !agent.hasGuessed;
              return (
                <div
                  key={agent.id}
                  className="flex items-center justify-between gap-2 px-3 py-2.5 hover:bg-white/5 transition"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-white/20"
                        style={{ backgroundColor: agent.color }}
                      />
                      <span className="truncate text-xs font-bold text-slate-100">
                        {agent.name}
                      </span>
                      <span
                        className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${badge.cls}`}
                      >
                        {badge.label}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-slate-400 font-mono">
                      <span>
                        {Math.round(agent.camera.heading)}°{' '}
                        {headingToCompass(agent.camera.heading)}
                      </span>
                      <span>•</span>
                      <span>z{agent.camera.zoom.toFixed(1)}</span>
                      <span>•</span>
                      <span>
                        {agent.maxExplorationCalls
                          ? `${agent.explorationCalls ?? 0}/${agent.maxExplorationCalls} calls`
                          : `${agent.stepCount} steps`}
                      </span>
                      <span>•</span>
                      <span className="text-emerald-400 font-semibold">
                        {agent.totalScore} pts
                      </span>
                    </div>
                    {showRunWarning && (
                      <p
                        className={`mt-1 truncate text-[10px] ${
                          run.lastStatus === 'timeout'
                            ? 'text-amber-300'
                            : 'text-rose-300'
                        }`}
                        title={run.lastMessage}
                      >
                        {run.lastMessage}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setWatchedAgentId((cur) =>
                        cur === agent.id ? null : agent.id
                      )
                    }
                    title={isWatching ? 'Hide Agent POV' : 'Watch Agent POV'}
                    className={`shrink-0 rounded-lg border p-1.5 transition ${
                      isWatching
                        ? 'border-sky-400/50 bg-sky-500/25 text-sky-300'
                        : 'border-white/10 bg-slate-800/70 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {isWatching ? (
                      <EyeOff className="h-3.5 w-3.5" />
                    ) : (
                      <Eye className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* Live Agent Camera Spectator PiP */}
        {watchedAgent && (
          <div className="border-t border-white/10 bg-slate-900/90 p-2">
            <div className="mb-1 flex items-center justify-between text-[10px] text-slate-300">
              <span className="font-semibold flex items-center gap-1.5">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: watchedAgent.color }}
                />
                {watchedAgent.name} Live POV
              </span>
              <span className="font-mono text-slate-400">
                {watchedAgent.currentNodeId} ·{' '}
                {Math.round(watchedAgent.camera.heading)}°
              </span>
            </div>
            <div className="relative aspect-[4/3] w-full overflow-hidden rounded-lg border border-white/10 bg-slate-950">
              <img
                src={`/api/agents/${watchedAgent.id}/viewport.jpg?v=${watchedAgent.frameVersion}`}
                alt={`${watchedAgent.name} viewport`}
                className="h-full w-full object-cover"
              />
            </div>
          </div>
        )}

        {/* Live MCP Activity Feed */}
        <div className="border-t border-white/10 px-3 py-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
          <Activity className="h-3 w-3 text-emerald-400" />
          <span>Live MCP Activity Feed</span>
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar px-3 pb-2.5 space-y-1.5 min-h-[96px]">
          {activityFeed.length === 0 ? (
            <div className="text-[11px] text-slate-500 italic">
              Waiting for MCP tool calls...
            </div>
          ) : (
            activityFeed.map((evt) => (
              <div
                key={evt.id}
                className="flex items-start gap-2 rounded-lg bg-white/[0.03] px-2 py-1.5 text-[11px]"
              >
                <span
                  className="mt-1 h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: evt.playerColor }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className="truncate font-semibold text-slate-200">
                      {evt.playerName}
                    </span>
                    <span className="shrink-0 rounded bg-slate-800 px-1 py-0.5 font-mono text-[9px] text-sky-300">
                      {evt.tool}
                    </span>
                  </div>
                  <p className="text-slate-400 leading-snug">{evt.summary}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </aside>

      {/* Connect MCP Modal */}
      {showConnectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm">
          <div className="flex max-h-[90dvh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-white/15 bg-slate-900 p-5 shadow-2xl">
            <div className="flex shrink-0 items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <Terminal className="h-4 w-4 text-sky-400" />
                <h2 className="text-sm font-bold text-slate-100">
                  Connect External AI Models via MCP
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setShowConnectModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 flex-1 overflow-y-auto custom-scrollbar pr-1 space-y-3 text-xs text-slate-300">
              <p>
                Add this server to <strong>Antigravity</strong> (
                <code className="text-sky-300">~/.gemini/config/mcp_config.json</code>),
                Claude Desktop, or Cursor — or run <code className="text-sky-300">npm run mcp:http</code>{' '}
                for <strong>Streamable HTTP (/mcp)</strong> &amp; <strong>ChatGPT Developer Mode</strong>:
              </p>
              <div className="relative">
                <pre className="overflow-x-auto rounded-xl border border-white/10 bg-slate-950 p-3 font-mono text-[11px] text-emerald-300">
                  {SNIPPET_STDIO}
                </pre>
                <button
                  type="button"
                  onClick={copySnippet}
                  className="absolute top-2 right-2 flex items-center gap-1 rounded-lg bg-slate-800 px-2 py-1 text-[10px] font-semibold text-slate-200 hover:bg-slate-700"
                >
                  {copied ? (
                    <>
                      <Check className="h-3 w-3 text-emerald-400" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>
              <pre className="overflow-x-auto rounded-xl border border-white/10 bg-slate-950 p-3 font-mono text-[11px] text-sky-300">
                {SNIPPET_HTTP}
              </pre>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
