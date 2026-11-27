import { useState } from 'react';
import {
  Activity,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Loader2,
  Play,
  Plug,
  RotateCw,
  Square,
} from 'lucide-react';
import {
  headingToCompass,
  type ActivityEvent,
  type AgyRunnerStatus,
  type HumanPlayerView,
  type PlayerInfo,
  type RoundStatus,
} from '@geoguessr-mcp/shared';
import { api } from '../lib/api';
import { getModelUiMeta, getPlayerInitials } from '../lib/uiHelpers';

interface AgentHudProps {
  agents: PlayerInfo[];
  humans?: HumanPlayerView[];
  selfPlayerId?: string;
  isSpectator?: boolean;
  showAiControls?: boolean;
  activityFeed: ActivityEvent[];
  agyRunner?: AgyRunnerStatus;
  roundStatus: RoundStatus;
  onOpenDeveloper?: () => void;
  onError?: (msg: string) => void;
}

export function AgentHud({
  agents,
  humans = [],
  selfPlayerId,
  isSpectator = false,
  showAiControls = true,
  activityFeed,
  agyRunner,
  roundStatus,
  onOpenDeveloper,
  onError,
}: AgentHudProps) {
  const [debugOpen, setDebugOpen] = useState(false);
  const [agyBusy, setAgyBusy] = useState(false);
  const [watchedAgentId, setWatchedAgentId] = useState<string | null>(null);

  const watchedAgent = agents.find((a) => a.id === watchedAgentId) ?? null;
  const runningCount = agyRunner?.runs.filter((r) => r.running).length ?? 0;

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

  const handleSummonNow = async (models?: string[]) => {
    if (!agyRunner || agyBusy) return;
    setAgyBusy(true);
    try {
      await api.triggerAgyRound(models);
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

  const orderedHumans = isSpectator
    ? []
    : [...humans].sort((a, b) => {
        if (a.id === selfPlayerId) return -1;
        if (b.id === selfPlayerId) return 1;
        return 0;
      });

  return (
    <aside className="absolute top-[76px] left-4 z-30 flex w-[256px] max-w-[calc(100vw-32px)] max-h-[calc(100vh-210px)] flex-col overflow-hidden geo-glass shadow-2xl">
      {/* Simple "Who has guessed" list */}
      <div className="p-2.5 space-y-0.5 overflow-y-auto custom-scrollbar">
        {orderedHumans.map((h) => {
          const isSelf = h.id === selfPlayerId;
          return (
            <div
              key={h.id}
              className="flex items-center gap-2.5 rounded-[10px] px-2 py-2"
            >
              <div
                style={{ backgroundColor: isSelf ? '#60a5fa' : h.color }}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[12px] font-semibold text-[#0b0d14]"
              >
                {getPlayerInitials(h.name)}
              </div>
              <span className="flex-1 truncate text-[14px] font-semibold text-[#eef0f5]">
                {isSelf ? 'You' : h.name}
              </span>
              <span
                className={`text-[12px] font-semibold ${
                  h.hasGuessed ? 'text-[#ff7a2f]' : 'text-[#8a91a3]'
                }`}
              >
                {h.hasGuessed
                  ? 'Guessed'
                  : h.connected
                    ? 'exploring'
                    : 'offline'}
              </span>
            </div>
          );
        })}

        {agents.map((agent) => {
          const run = agyRunner?.runs.find((r) => r.agentId === agent.id);
          const meta = agent.model
            ? getModelUiMeta(agent.model, undefined, agent.name)
            : {
                badge: getPlayerInitials(agent.name),
                color: agent.color,
                shortName: agent.name,
                tierLabel: '',
              };
          const showRetry =
            Boolean(run) &&
            (run?.lastStatus === 'timeout' || run?.lastStatus === 'error') &&
            !agent.hasGuessed &&
            roundStatus === 'active' &&
            Boolean(agent.model);

          let statusText = 'Thinking…';
          let statusCls = 'text-[#8a91a3]';
          if (agent.hasGuessed) {
            statusText = 'Guessed';
            statusCls = 'text-[#ff7a2f]';
          } else if (run?.lastStatus === 'timeout') {
            statusText = 'timed out';
            statusCls = 'text-[#e3b65c]';
          } else if (run?.lastStatus === 'error') {
            statusText = 'stalled';
            statusCls = 'text-[#f2777b]';
          } else if (!agent.connected) {
            statusText = 'waiting';
            statusCls = 'text-[#8a91a3]';
          }

          return (
            <div
              key={agent.id}
              className="flex items-center gap-2.5 rounded-[10px] px-2 py-2"
            >
              <div
                style={{ backgroundColor: meta.color }}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[12px] font-semibold text-[#0b0d14]"
              >
                {meta.badge}
              </div>
              <span className="flex-1 truncate text-[14px] font-semibold text-[#eef0f5]">
                {meta.shortName}
              </span>
              {showRetry && agent.model ? (
                <button
                  type="button"
                  disabled={agyBusy}
                  onClick={() => handleSummonNow([agent.model!])}
                  title={run?.lastMessage || 'Retry AI turn'}
                  className="inline-flex items-center gap-1 rounded-lg border border-white/[0.08] bg-[#1a1e28] px-2 py-0.5 text-[11px] font-medium text-[#e3b65c] hover:bg-[#222734] transition"
                >
                  <RotateCw className="h-2.5 w-2.5" />
                  <span>Retry</span>
                </button>
              ) : (
                <span className={`text-[12px] font-semibold ${statusCls}`}>
                  {statusText}
                </span>
              )}
            </div>
          );
        })}

        {showAiControls && agents.length === 0 && (
          <div className="px-2 py-2 text-xs text-[#8a91a3]">
            No AI opponents active yet.
          </div>
        )}
      </div>

      {/* Expandable AI Debug & Controls */}
      {showAiControls && (
        <div className="border-t border-white/10">
          <button
            type="button"
            onClick={() => setDebugOpen((v) => !v)}
            className="flex w-full items-center justify-between px-3.5 py-2 text-xs font-semibold text-[#8a91a3] hover:bg-white/[0.04] hover:text-white transition"
          >
            <span className="flex items-center gap-1.5">
              <span>AI debug</span>
              {runningCount > 0 && (
                <Loader2 className="h-3 w-3 animate-spin text-[#ff7a2f]" />
              )}
            </span>
            {debugOpen ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </button>

          {debugOpen && (
            <div className="max-h-[340px] overflow-y-auto custom-scrollbar border-t border-white/10 bg-[#0b0d14]/70 p-3 space-y-3 text-xs">
              {agyRunner && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] text-[#8a91a3]">
                      Auto-AI Opponents
                    </span>
                    <button
                      type="button"
                      disabled={!agyRunner.available || agyBusy}
                      onClick={toggleAutoPlay}
                      className={`rounded-full border px-2 py-0.5 text-[11px] font-medium transition ${
                        agyRunner.autoPlayEnabled
                          ? 'border-[#ff7a2f]/50 bg-[#ff7a2f]/20 text-[#ff7a2f]'
                          : 'border-white/15 bg-[#1a1e28] text-[#8a91a3]'
                      }`}
                    >
                      {agyRunner.autoPlayEnabled ? 'Auto: ON' : 'Auto: OFF'}
                    </button>
                  </div>

                  {agyRunner.available && (
                    <>
                      <div className="flex flex-wrap gap-1">
                        {agyRunner.availableModels.map((m) => {
                          const selected = agyRunner.selectedModels.includes(m.id);
                          const meta = getModelUiMeta(m.id, m.family, m.label);
                          return (
                            <button
                              key={m.id}
                              type="button"
                              disabled={agyBusy}
                              onClick={() => toggleModel(m.id)}
                              className={`rounded-lg border px-2 py-1 text-[11px] font-semibold transition ${
                                selected
                                  ? 'border-[#ff7a2f]/60 bg-[#ff7a2f]/15 text-white'
                                  : 'border-white/10 bg-[#11141c] text-[#8a91a3] hover:text-white'
                              }`}
                            >
                              {meta.shortName}
                            </button>
                          );
                        })}
                      </div>

                      <div className="flex items-center justify-between gap-1.5">
                        <div className="flex items-center gap-1">
                          <select
                            aria-label="Max steps per round"
                            value={agyRunner.maxStepsPerRound}
                            disabled={agyBusy}
                            onChange={(e) =>
                              updateBudget({
                                maxStepsPerRound: Number(e.target.value),
                              })
                            }
                            className="rounded-lg border border-white/15 bg-[#11141c] px-1.5 py-1 text-[11px] text-white"
                          >
                            <option value={3}>3 moves</option>
                            <option value={5}>5 moves</option>
                            <option value={8}>8 moves</option>
                            <option value={12}>12 moves</option>
                          </select>
                          <select
                            aria-label="Timeout per round"
                            value={agyRunner.timeoutSec}
                            disabled={agyBusy}
                            onChange={(e) =>
                              updateBudget({
                                timeoutSec: Number(e.target.value),
                              })
                            }
                            className="rounded-lg border border-white/15 bg-[#11141c] px-1.5 py-1 text-[11px] text-white"
                          >
                            <option value={60}>60s</option>
                            <option value={120}>120s</option>
                            <option value={180}>180s</option>
                          </select>
                        </div>

                        <div className="flex items-center gap-1">
                          {runningCount > 0 && (
                            <button
                              type="button"
                              disabled={agyBusy}
                              onClick={handleStopRuns}
                              className="inline-flex items-center gap-1 rounded-lg border border-[#e5484d]/30 bg-[#e5484d]/10 px-2 py-1 text-[11px] font-medium text-[#f2777b] hover:bg-rose-500/30"
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
                            onClick={() => handleSummonNow()}
                            className="inline-flex items-center gap-1 rounded-lg bg-[#ff7a2f] px-2.5 py-1 text-[11px] font-medium text-[#1f0e03] hover:bg-[#ff8d4d] disabled:opacity-40"
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

              {/* Telemetry & POV toggles */}
              {agents.length > 0 && (
                <div className="space-y-1.5 border-t border-white/10 pt-2">
                  <div className="text-[12px] text-[#8a91a3]">
                    Camera &amp; Calls
                  </div>
                  {agents.map((agent) => {
                    const isWatching = watchedAgentId === agent.id;
                    return (
                      <div
                        key={agent.id}
                        className="flex items-center justify-between gap-2 rounded-lg bg-white/[0.03] px-2 py-1.5"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-semibold text-white text-[11px]">
                            {agent.name}
                          </div>
                          <div className="font-mono text-[10px] text-[#8a91a3]">
                            {Math.round(agent.camera.heading)}°{' '}
                            {headingToCompass(agent.camera.heading)} · z
                            {agent.camera.zoom.toFixed(1)} ·{' '}
                            {agent.maxExplorationCalls
                              ? `${agent.explorationCalls ?? 0}/${agent.maxExplorationCalls}`
                              : `${agent.stepCount} steps`}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setWatchedAgentId((cur) =>
                              cur === agent.id ? null : agent.id
                            )
                          }
                          title={isWatching ? 'Hide POV' : 'Watch POV'}
                          className={`rounded-lg border p-1 transition ${
                            isWatching
                              ? 'border-[#ff7a2f] bg-[#ff7a2f]/20 text-[#ff7a2f]'
                              : 'border-white/10 bg-[#11141c] text-[#8a91a3] hover:text-white'
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
                  })}
                </div>
              )}

              {watchedAgent && (
                <div className="rounded-lg border border-white/10 bg-[#11141c] p-1.5">
                  <div className="mb-1 flex items-center justify-between text-[10px] text-[#8a91a3]">
                    <span className="font-semibold text-white">
                      {watchedAgent.name} POV
                    </span>
                    <span className="font-mono">
                      {Math.round(watchedAgent.camera.heading)}°
                    </span>
                  </div>
                  <div className="aspect-[4/3] w-full overflow-hidden rounded bg-[#0b0d14]">
                    <img
                      src={`/api/agents/${watchedAgent.id}/viewport.jpg?v=${watchedAgent.frameVersion}`}
                      alt={`${watchedAgent.name} viewport`}
                      className="h-full w-full object-cover"
                    />
                  </div>
                </div>
              )}

              {/* Activity feed */}
              <div className="space-y-1.5 border-t border-white/10 pt-2">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1 text-[12px] text-[#8a91a3]">
                    <Activity className="h-3 w-3 text-[#ff7a2f]" />
                    <span>Activity</span>
                  </span>
                  {onOpenDeveloper && (
                    <button
                      type="button"
                      onClick={onOpenDeveloper}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#8a91a3] hover:text-white"
                    >
                      <Plug className="h-3 w-3" />
                      <span>Connect MCP</span>
                    </button>
                  )}
                </div>

                {activityFeed.length === 0 ? (
                  <div className="text-[11px] text-[#8a91a3] italic">
                    No activity yet.
                  </div>
                ) : (
                  <div className="space-y-1 max-h-28 overflow-y-auto custom-scrollbar">
                    {activityFeed.slice(0, 12).map((evt) => (
                      <div
                        key={evt.id}
                        className="rounded-lg bg-white/[0.03] px-2 py-1 text-[11px]"
                      >
                        <span className="font-semibold text-white">
                          {evt.playerName}:
                        </span>{' '}
                        <span className="text-[#8a91a3]">{evt.summary}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
