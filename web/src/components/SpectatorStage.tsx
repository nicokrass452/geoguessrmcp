import {
  Bot,
  CheckCircle2,
  Coins,
  Compass,
  Eye,
  FastForward,
  Play,
  Radio,
  Trophy,
} from 'lucide-react';
import {
  headingToCompass,
  type AgyRunnerStatus,
  type PlayerInfo,
  type RoundStatus,
} from '@geoguessr-mcp/shared';

export interface SpectatorStageProps {
  roundNumber: number;
  totalRounds: number;
  roundStatus: RoundStatus;
  agents: PlayerInfo[];
  bettingEnabled: boolean;
  agyRunner?: AgyRunnerStatus;
  onSummonAi: () => void;
  onForceEndRound: () => void;
}

export function SpectatorStage({
  roundNumber,
  totalRounds,
  roundStatus,
  agents,
  bettingEnabled,
  agyRunner,
  onSummonAi,
  onForceEndRound,
}: SpectatorStageProps) {
  return (
    <section
      data-testid="spectator-stage"
      aria-label="AI-Only Spectator Stage"
      className="flex h-full w-full flex-col bg-slate-950 pt-24 sm:pt-20 pb-8 px-4 sm:px-6 overflow-y-auto overflow-x-hidden page-scrollbar"
    >
      <div className="mx-auto w-full max-w-6xl space-y-5">
        {/* Spectator Header Banner */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-400/25 bg-slate-900/80 px-5 py-3.5 backdrop-blur-md shadow-xl">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-rose-400/30 bg-rose-500/15 text-rose-300">
              <Eye className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-extrabold text-white">
                  AI-Only Spectator Mode · Round {roundNumber} of {totalRounds}
                </h2>
                <span className="rounded-full border border-emerald-400/30 bg-emerald-500/15 px-2.5 py-0.5 text-[10px] font-bold text-emerald-300">
                  {agents.length} AI Live
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Watching autonomous MCP AI models explore, pan, zoom, and submit
                deductions in real time (no human guess required).
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {agyRunner?.available && roundStatus === 'active' && (
              <button
                type="button"
                onClick={onSummonAi}
                className="flex items-center gap-1.5 rounded-xl bg-sky-500 px-3.5 py-2 text-xs font-bold text-slate-950 hover:bg-sky-400 transition"
              >
                <Play className="h-3.5 w-3.5 fill-current" />
                <span>Summon Local AI</span>
              </button>
            )}
            {roundStatus === 'active' && (
              <button
                type="button"
                onClick={onForceEndRound}
                className="flex items-center gap-1.5 rounded-xl border border-amber-400/40 bg-amber-500/15 px-3.5 py-2 text-xs font-bold text-amber-300 hover:bg-amber-500/25 transition"
              >
                <FastForward className="h-3.5 w-3.5" />
                <span>End Round Now</span>
              </button>
            )}
          </div>
        </div>

        {/* Multi-POV Grid */}
        {agents.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-white/15 bg-slate-900/40 py-20 px-6 text-center space-y-3">
            <Radio className="h-10 w-10 text-sky-400 animate-pulse" />
            <h3 className="text-base font-bold text-slate-200">
              Waiting for AI Agents to Connect via MCP...
            </h3>
            <p className="max-w-md text-xs text-slate-400">
              Connect any external MCP model (`stdio`, `/mcp` Streamable HTTP,
              or `/sse`) or click <strong>Summon Local AI</strong> in the left
              HUD to watch their live street-view camera feeds here.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {agents.map((agent) => (
              <div
                key={agent.id}
                data-testid={`spectator-card-${agent.id}`}
                className="flex flex-col overflow-hidden rounded-2xl border border-white/15 bg-slate-900/85 shadow-2xl"
              >
                {/* Card Header */}
                <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="h-3 w-3 shrink-0 rounded-full ring-2 ring-white/20"
                      style={{ backgroundColor: agent.color }}
                    />
                    <Bot className="h-4 w-4 shrink-0 text-sky-400" />
                    <span className="truncate text-sm font-extrabold text-white">
                      {agent.name}
                    </span>
                  </div>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                      agent.hasGuessed
                        ? 'border-emerald-400/40 bg-emerald-500/20 text-emerald-300'
                        : 'border-sky-400/40 bg-sky-500/20 text-sky-300'
                    }`}
                  >
                    {agent.hasGuessed ? 'Guessed!' : 'Exploring...'}
                  </span>
                </div>

                {/* Live POV Viewport JPEG */}
                <div className="relative aspect-[4/3] w-full bg-slate-950">
                  <img
                    src={`/api/agents/${agent.id}/viewport.jpg?v=${agent.frameVersion}`}
                    alt={`${agent.name} live POV`}
                    className="h-full w-full object-cover"
                  />
                  <div className="pointer-events-none absolute bottom-2 left-2 right-2 flex items-center justify-between rounded-xl bg-slate-950/85 px-2.5 py-1 text-[10px] font-mono text-slate-200 backdrop-blur-sm">
                    <span className="flex items-center gap-1">
                      <Compass className="h-3 w-3 text-sky-400" />
                      {Math.round(agent.camera.heading)}°{' '}
                      {headingToCompass(agent.camera.heading)} · pitch{' '}
                      {Math.round(agent.camera.pitch)}° · z
                      {agent.camera.zoom.toFixed(1)}x
                    </span>
                    <span>{agent.currentNodeId}</span>
                  </div>
                </div>

                {/* Card Telemetry Footer */}
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-xs bg-slate-950/60">
                  <div className="flex items-center gap-2 text-slate-300 font-mono text-[11px]">
                    <span>
                      {agent.maxExplorationCalls
                        ? `${agent.explorationCalls ?? 0}/${agent.maxExplorationCalls} calls`
                        : `${agent.stepCount} steps`}
                    </span>
                    {agent.model && (
                      <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
                        {agent.model}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2.5">
                    {bettingEnabled && (
                      <span className="flex items-center gap-1 rounded-lg border border-amber-400/30 bg-amber-500/15 px-2 py-0.5 font-mono text-[11px] font-bold text-amber-300">
                        <Coins className="h-3 w-3 text-amber-400" />
                        <span>{agent.chips.toLocaleString()}</span>
                        {agent.currentWager !== null && (
                          <span className="text-amber-200">
                            (bet {agent.currentWager})
                          </span>
                        )}
                      </span>
                    )}
                    <span className="flex items-center gap-1 font-extrabold text-emerald-400">
                      <Trophy className="h-3.5 w-3.5 text-amber-400" />
                      {agent.totalScore.toLocaleString()} pts
                    </span>
                  </div>
                </div>

                {agent.hasGuessed && (
                  <div className="border-t border-white/5 bg-emerald-500/10 px-4 py-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-emerald-300">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>
                      Deduction locked in — waiting for remaining AI agents...
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
