import { CheckCircle2, Coins, FastForward, Play, Radio } from 'lucide-react';
import type {
  AgyRunnerStatus,
  PlayerInfo,
  RoundStatus,
} from '@geoguessr-mcp/shared';
import { getModelUiMeta, getPlayerInitials } from '../lib/uiHelpers';

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
      className="geo-bg flex h-full w-full flex-col pt-24 pb-10 px-4 sm:px-8 overflow-y-auto overflow-x-hidden page-scrollbar text-[#eef1f8]"
    >
      <div className="mx-auto w-full max-w-[1120px] space-y-5">
        {/* Clean Spectator Header */}
        <div className="geo-card flex flex-wrap items-center justify-between gap-4 px-5 py-4">
          <div className="flex items-center gap-3.5">
            <div className="grid h-11 w-11 place-items-center rounded-xl bg-[#18223a] border border-white/15 text-xl">
              🍿
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2.5">
                <h2 className="text-[18px] font-extrabold text-white">
                  Watch the AIs · Round {roundNumber} of {totalRounds}
                </h2>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[#22c55e]/35 bg-[#22c55e]/15 px-2.5 py-0.5 text-xs font-bold text-[#22c55e]">
                  <span className="h-2 w-2 rounded-full bg-[#22c55e]" />
                  <span>{agents.length} live</span>
                </span>
              </div>
              <p className="text-sm text-[#8d97ae]">
                Follow how each model explores the street view before locking in
                its guess.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {agyRunner?.available && roundStatus === 'active' && (
              <button
                type="button"
                onClick={onSummonAi}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#22c55e] px-4 py-2 text-sm font-bold text-[#052e14] shadow-[0_8px_24px_rgba(34,197,94,0.25)] hover:bg-[#34d369] transition"
              >
                <Play className="h-3.5 w-3.5 fill-current" />
                <span>Re-summon AI</span>
              </button>
            )}
            {roundStatus === 'active' && (
              <button
                type="button"
                onClick={onForceEndRound}
                className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-[#18223a] px-4 py-2 text-sm font-semibold text-[#eef1f8] hover:bg-[#223050] transition"
              >
                <FastForward className="h-3.5 w-3.5 text-[#fbbf24]" />
                <span>End round now</span>
              </button>
            )}
          </div>
        </div>

        {/* Multi-POV Grid */}
        {agents.length === 0 ? (
          <div className="geo-card border-dashed py-20 px-6 text-center flex flex-col items-center justify-center gap-3">
            <Radio className="h-10 w-10 text-[#22c55e] animate-pulse" />
            <h3 className="text-lg font-bold text-white">
              Waiting for AI players…
            </h3>
            <p className="max-w-md text-sm text-[#8d97ae]">
              Click <strong>Re-summon AI</strong> above or connect an external
              MCP agent in Settings to watch their live street views here.
            </p>
          </div>
        ) : (
          <div className="grid gap-[18px] sm:grid-cols-2 lg:grid-cols-3">
            {agents.map((agent) => {
              const meta = agent.model
                ? getModelUiMeta(agent.model, undefined, agent.name)
                : {
                    badge: getPlayerInitials(agent.name),
                    color: agent.color,
                    shortName: agent.name,
                    tierLabel: '',
                  };
              return (
                <div
                  key={agent.id}
                  data-testid={`spectator-card-${agent.id}`}
                  className="geo-card flex flex-col overflow-hidden shadow-xl"
                >
                  <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div
                        style={{ backgroundColor: meta.color }}
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-extrabold text-[#0b1020]"
                      >
                        {meta.badge}
                      </div>
                      <span className="truncate text-[15px] font-bold text-white">
                        {meta.shortName}
                      </span>
                    </div>
                    <span
                      className={`text-xs font-bold ${
                        agent.hasGuessed
                          ? 'text-[#22c55e]'
                          : 'text-[#8d97ae]'
                      }`}
                    >
                      {agent.hasGuessed ? '✓ guessed' : 'thinking…'}
                    </span>
                  </div>

                  <div className="relative aspect-[4/3] w-full bg-[#0b1020]">
                    <img
                      src={`/api/agents/${agent.id}/viewport.jpg?v=${agent.frameVersion}`}
                      alt={`${agent.name} live POV`}
                      className="h-full w-full object-cover"
                    />
                  </div>

                  <div className="flex items-center justify-between gap-2 px-4 py-3 text-sm bg-[#0b1020]/50">
                    <span className="text-[#8d97ae] text-xs font-medium">
                      {agent.stepCount} {agent.stepCount === 1 ? 'move' : 'moves'}
                    </span>

                    <div className="flex items-center gap-3">
                      {bettingEnabled && (
                        <span className="inline-flex items-center gap-1 text-xs font-bold text-[#fbbf24]">
                          <Coins className="h-3.5 w-3.5" />
                          <span>{agent.chips.toLocaleString()}</span>
                          {agent.currentWager !== null && (
                            <span className="text-[#8d97ae]">
                              (bet {agent.currentWager})
                            </span>
                          )}
                        </span>
                      )}
                      <span className="font-extrabold text-white">
                        {agent.totalScore.toLocaleString()} pts
                      </span>
                    </div>
                  </div>

                  {agent.hasGuessed && (
                    <div className="border-t border-white/5 bg-[#22c55e]/10 px-4 py-2 flex items-center gap-1.5 text-xs font-semibold text-[#22c55e]">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span>Guess locked — waiting for others</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
