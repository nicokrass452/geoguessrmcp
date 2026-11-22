import {
  Bot,
  Coins,
  Crown,
  Home,
  RotateCcw,
  Settings2,
  Trophy,
  User,
} from 'lucide-react';
import type { LeaderboardEntry } from '@geoguessr-mcp/shared';

export interface FinalLeaderboardModalProps {
  entries: LeaderboardEntry[];
  totalRounds: number;
  bettingEnabled?: boolean;
  onPlayAgain: () => void;
  onOpenSetup: () => void;
  onReturnHome?: () => void;
}

function isFiniteNum(val: unknown): val is number {
  return typeof val === 'number' && Number.isFinite(val);
}

export function shouldShowLeaderboardBetting(
  entries: LeaderboardEntry[],
  bettingEnabled?: boolean
): boolean {
  return (
    bettingEnabled === true ||
    (bettingEnabled !== false &&
      entries.some(
        (e) =>
          (typeof e.chips === 'number' && Number.isFinite(e.chips)) ||
          (typeof e.netChips === 'number' && Number.isFinite(e.netChips))
      ))
  );
}

export function formatChipStack(chips?: number): string {
  if (!isFiniteNum(chips)) return '—';
  const normalized = chips === 0 ? 0 : chips;
  return normalized.toLocaleString();
}

export function formatNetChips(netChips?: number): {
  label: string;
  badgeCls: string;
} {
  if (!isFiniteNum(netChips)) {
    return {
      label: '—',
      badgeCls: 'border-white/10 bg-slate-900 text-slate-500',
    };
  }
  const normalized = netChips === 0 ? 0 : netChips;
  if (normalized > 0) {
    return {
      label: `+${normalized.toLocaleString()}`,
      badgeCls: 'border-emerald-400/30 bg-emerald-500/15 text-emerald-300',
    };
  }
  if (normalized < 0) {
    return {
      label: `-${Math.abs(normalized).toLocaleString()}`,
      badgeCls: 'border-rose-400/30 bg-rose-500/15 text-rose-300',
    };
  }
  return {
    label: '0',
    badgeCls: 'border-white/10 bg-slate-800/80 text-slate-300',
  };
}

export function FinalLeaderboardModal({
  entries,
  totalRounds,
  bettingEnabled,
  onPlayAgain,
  onOpenSetup,
  onReturnHome,
}: FinalLeaderboardModalProps) {
  const winner = entries[0];
  const showBetting = shouldShowLeaderboardBetting(entries, bettingEnabled);
  const winnerHasChips = winner && isFiniteNum(winner.chips);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-md">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-white/15 bg-slate-900 shadow-2xl">
        <div className="border-b border-white/10 bg-gradient-to-r from-sky-500/15 via-emerald-500/10 to-amber-500/15 p-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-400/20 border border-amber-400/40 text-amber-300 shadow-lg">
            <Crown className="h-7 w-7" />
          </div>
          <h2 className="text-2xl font-extrabold text-slate-100">
            Match Complete!
          </h2>
          {winner && (
            <p className="mt-1 text-sm text-slate-300">
              Winner:{' '}
              <span className="font-bold text-amber-300">{winner.name}</span>{' '}
              with{' '}
              <span className="font-bold text-emerald-400">
                {winner.totalScore.toLocaleString()} pts
              </span>{' '}
              across {totalRounds} rounds
              {showBetting && winnerHasChips && (
                <>
                  {' '}
                  ·{' '}
                  <span className="font-bold text-amber-300">
                    {formatChipStack(winner.chips)} chips
                  </span>
                </>
              )}
            </p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-3">
          {entries.map((entry) => {
            const net = formatNetChips(entry.netChips);
            return (
              <div
                key={entry.playerId}
                className="rounded-2xl border border-white/10 bg-slate-950/60 p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-sm font-extrabold ${
                        entry.rank === 1
                          ? 'bg-amber-400 text-slate-950'
                          : entry.rank === 2
                            ? 'bg-slate-300 text-slate-950'
                            : entry.rank === 3
                              ? 'bg-amber-700 text-white'
                              : 'bg-slate-800 text-slate-300'
                      }`}
                    >
                      #{entry.rank}
                    </div>
                    <span
                      className="h-3 w-3 shrink-0 rounded-full"
                      style={{ backgroundColor: entry.color }}
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 font-bold text-slate-100">
                        {entry.isHuman ? (
                          <User className="h-4 w-4 shrink-0 text-sky-400" />
                        ) : (
                          <Bot className="h-4 w-4 shrink-0 text-rose-400" />
                        )}
                        <span className="truncate">{entry.name}</span>
                      </div>
                      <div className="text-[11px] text-slate-400">
                        Avg: {entry.averageScore.toLocaleString()} pts · Best:{' '}
                        {entry.bestRoundScore.toLocaleString()} pts
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2.5 shrink-0 ml-auto">
                    {showBetting && (
                      <div className="flex items-center gap-1.5">
                        <span
                          aria-label="Final chip stack"
                          className="flex items-center gap-1.5 rounded-xl border border-amber-400/25 bg-amber-500/10 px-2.5 py-1 text-xs font-bold tabular-nums text-amber-200"
                        >
                          <Coins className="h-3.5 w-3.5 text-amber-400" />
                          <span>{formatChipStack(entry.chips)} chips</span>
                        </span>
                        <span
                          title="Net chips"
                          aria-label="Net chips"
                          className={`rounded-lg border px-2 py-1 text-xs font-bold tabular-nums ${net.badgeCls}`}
                        >
                          {net.label}
                        </span>
                      </div>
                    )}
                    <div className="flex items-center gap-1.5 text-lg font-extrabold text-emerald-400">
                      <Trophy className="h-4 w-4 text-amber-400" />
                      <span>{entry.totalScore.toLocaleString()}</span>
                    </div>
                  </div>
                </div>

                {entry.roundScores.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {entry.roundScores.map((rs) => (
                      <div
                        key={rs.roundNumber}
                        className="rounded-lg border border-white/5 bg-slate-900 px-2.5 py-1 text-[11px] text-slate-300"
                      >
                        <span className="text-slate-500">
                          R{rs.roundNumber}:
                        </span>{' '}
                        <span className="font-bold text-slate-100">
                          {rs.score}
                        </span>
                        {rs.distanceKm !== null && (
                          <span className="text-slate-400">
                            {' '}
                            ({Math.round(rs.distanceKm)} km)
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-white/10 bg-slate-950/60 p-4">
          {onReturnHome && (
            <button
              type="button"
              onClick={onReturnHome}
              className="sm:mr-auto flex items-center gap-2 rounded-xl border border-white/10 bg-slate-800/80 px-4 py-2.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 transition"
            >
              <Home className="h-4 w-4 text-sky-400" />
              <span>Return to Home</span>
            </button>
          )}
          <button
            type="button"
            onClick={onOpenSetup}
            className="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-800 px-4 py-2.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 transition"
          >
            <Settings2 className="h-4 w-4" />
            <span>Configure Match</span>
          </button>
          <button
            type="button"
            onClick={onPlayAgain}
            className="flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-2.5 text-xs font-bold text-slate-950 hover:bg-emerald-400 transition"
          >
            <RotateCcw className="h-4 w-4" />
            <span>Play Again</span>
          </button>
        </div>
      </div>
    </div>
  );
}
