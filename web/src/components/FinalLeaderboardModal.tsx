import { Logo } from './Logo';
import { useState } from 'react';
import { ChevronDown, ChevronUp, RotateCcw } from 'lucide-react';
import type { LeaderboardEntry } from '@geoguessr-mcp/shared';
import {
  formatOrdinalRank,
  getModelUiMeta,
  getPlayerInitials,
} from '../lib/uiHelpers';

export interface FinalLeaderboardModalProps {
  entries: LeaderboardEntry[];
  totalRounds: number;
  bettingEnabled?: boolean;
  selfPlayerId?: string;
  isSpectator?: boolean;
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
      badgeCls: 'border-white/10 bg-[#0b0d14] text-[#8a91a3]',
    };
  }
  const normalized = netChips === 0 ? 0 : netChips;
  if (normalized > 0) {
    return {
      label: `+${normalized.toLocaleString()}`,
      badgeCls: 'border-[#ff7a2f]/30 bg-[#ff7a2f]/15 text-[#ff7a2f]',
    };
  }
  if (normalized < 0) {
    return {
      label: `-${Math.abs(normalized).toLocaleString()}`,
      badgeCls: 'border-[#e5484d]/30 bg-[#e5484d]/10 text-[#f2777b]',
    };
  }
  return {
    label: '0',
    badgeCls: 'border-white/10 bg-[#1a1e28] text-[#8a91a3]',
  };
}

function getEntryAvatar(
  entry: LeaderboardEntry,
  isSelf: boolean
): { badge: string; color: string; displayName: string } {
  if (!entry.isHuman && entry.model) {
    const meta = getModelUiMeta(entry.model, undefined, entry.name);
    return {
      badge: meta.badge,
      color: meta.color,
      displayName: meta.shortName,
    };
  }
  return {
    badge: getPlayerInitials(entry.name),
    color: isSelf ? '#60a5fa' : entry.color,
    displayName: isSelf ? 'You' : entry.name,
  };
}

export function FinalLeaderboardModal({
  entries,
  totalRounds,
  bettingEnabled,
  selfPlayerId,
  isSpectator = false,
  onPlayAgain,
  onOpenSetup,
  onReturnHome,
}: FinalLeaderboardModalProps) {
  const [showBreakdown, setShowBreakdown] = useState(false);

  const winner = entries[0];
  const second = entries[1];
  const showBetting = shouldShowLeaderboardBetting(entries, bettingEnabled);

  const selfEntry = !isSpectator
    ? entries.find((e) =>
        selfPlayerId ? e.playerId === selfPlayerId : e.isHuman
      )
    : undefined;

  let headline = 'Match complete';
  let subtitle = `${totalRounds} rounds played`;

  if (selfEntry && winner) {
    if (entries.length === 1) {
      headline = `You scored ${selfEntry.totalScore.toLocaleString()} pts`;
      subtitle = `Across ${totalRounds} rounds.`;
    } else if (selfEntry.rank === 1) {
      headline = 'You won';
      const lead = second ? selfEntry.totalScore - second.totalScore : 0;
      subtitle =
        second && lead > 0
          ? `Ahead of ${getEntryAvatar(second, false).displayName} by ${lead.toLocaleString()} points.`
          : `Finished 1st across ${totalRounds} rounds.`;
    } else {
      headline = `You finished ${formatOrdinalRank(selfEntry.rank)}`;
      const gap = winner.totalScore - selfEntry.totalScore;
      subtitle = `Just ${gap.toLocaleString()} points behind ${getEntryAvatar(winner, false).displayName}.`;
    }
  } else if (winner) {
    headline = `${getEntryAvatar(winner, false).displayName} wins`;
    const lead = second ? winner.totalScore - second.totalScore : 0;
    subtitle =
      second && lead > 0
        ? `Ahead of ${getEntryAvatar(second, false).displayName} by ${lead.toLocaleString()} points.`
        : `${winner.totalScore.toLocaleString()} points across ${totalRounds} rounds.`;
  }

  // Podium order: [2nd, 1st, 3rd] (or just available top 3)
  const top3 = entries.slice(0, 3);
  const podiumOrder =
    top3.length === 3
      ? [top3[1], top3[0], top3[2]]
      : top3.length === 2
        ? [top3[1], top3[0]]
        : top3;
  const rest = entries.slice(3);

  return (
    <div className="geo-bg fixed inset-0 z-50 overflow-y-auto overflow-x-hidden page-scrollbar text-[#eef0f5]">
      {/* Top-Left Brand */}
      <nav className="mx-auto flex max-w-[1200px] items-center px-5 py-5 sm:px-10">
        <Logo />
      </nav>

      <div className="mx-auto max-w-[900px] px-5 pt-2 pb-14 sm:px-12 text-center">
                <h1 className="mt-2.5 text-3xl sm:text-[44px] font-medium tracking-[-0.02em] text-white">
          {headline}
        </h1>
        <p className="mt-1 mb-9 text-[17px] text-[#8a91a3]">{subtitle}</p>

        {/* Podium */}
        {podiumOrder.length > 0 && (
          <div className="mb-7 flex items-end justify-center gap-3 sm:gap-4">
            {podiumOrder.map((entry) => {
              const isSelf =
                !isSpectator &&
                ((selfPlayerId && entry.playerId === selfPlayerId) ||
                  (!selfPlayerId && entry.isHuman));
              const av = getEntryAvatar(entry, isSelf);
              const stepHeight =
                entry.rank === 1 ? 170 : entry.rank === 2 ? 120 : 85;
              const stepBg =
                entry.rank === 1
                  ? '#3a2a1c'
                  : entry.rank === 2
                    ? '#2a2f3b'
                    : '#1a1e28';

              return (
                <div
                  key={entry.playerId}
                  className="flex w-[112px] sm:w-[200px] flex-col items-center gap-2.5"
                >
                  <div
                    style={{ backgroundColor: av.color }}
                    className="grid h-16 w-16 place-items-center rounded-full border-4 border-[#0b0d14] text-[22px] font-semibold text-[#0b0d14] shadow-lg"
                  >
                    {av.badge}
                  </div>
                  <b className="truncate max-w-full text-[16px] sm:text-[17px] font-medium text-white">
                    {av.displayName}
                  </b>
                  <span className="text-[14px] text-[#8a91a3]">
                    {entry.totalScore.toLocaleString()} pts
                    {showBetting && isFiniteNum(entry.chips)
                      ? ` · ${formatChipStack(entry.chips)}c`
                      : ''}
                  </span>
                  <div
                    style={{ height: `${stepHeight}px`, background: stepBg }}
                    className="grid w-full place-items-center rounded-t-[14px] text-[34px] font-semibold text-white shadow-xl"
                  >
                    {entry.rank}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* 4th+ Place List */}
        {rest.length > 0 && (
          <div className="geo-card mx-auto mb-6 max-w-[560px] divide-y divide-white/[0.08] px-5 py-2 text-left">
            {rest.map((entry) => {
              const isSelf =
                !isSpectator &&
                ((selfPlayerId && entry.playerId === selfPlayerId) ||
                  (!selfPlayerId && entry.isHuman));
              const av = getEntryAvatar(entry, isSelf);
              return (
                <div
                  key={entry.playerId}
                  className="flex items-center gap-3 py-2.5"
                >
                  <span className="w-5 text-sm font-semibold text-[#8a91a3]">
                    {entry.rank}
                  </span>
                  <div
                    style={{ backgroundColor: av.color }}
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-[#0b0d14]"
                  >
                    {av.badge}
                  </div>
                  <b className="flex-1 truncate text-[15px] text-white">
                    {av.displayName}
                  </b>
                  <span className="text-sm text-[#8a91a3]">
                    {entry.totalScore.toLocaleString()} pts
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={onPlayAgain}
            className="inline-flex items-center gap-2 rounded-[14px] bg-[#ff7a2f] px-7 py-4 text-[17px] font-medium text-[#1f0e03] hover:bg-[#ff8d4d] transition"
          >
            <RotateCcw className="h-4 w-4" />
            <span>Play again</span>
          </button>

          <button
            type="button"
            onClick={onOpenSetup}
            className="inline-flex items-center gap-2 rounded-[14px] border border-white/15 bg-[#1a1e28] px-6 py-4 text-[16px] font-medium text-[#eef0f5] hover:bg-[#223050] transition"
          >
            <span>Change settings</span>
          </button>

          {onReturnHome && (
            <button
              type="button"
              onClick={onReturnHome}
              className="inline-flex items-center gap-2 rounded-[14px] border border-white/15 bg-transparent px-6 py-4 text-[16px] font-medium text-[#8a91a3] hover:text-white transition"
            >
              <span>Home</span>
            </button>
          )}
        </div>

        {/* Optional Collapsible Round-by-Round Breakdown */}
        {entries.some((e) => e.roundScores.length > 0) && (
          <div className="mt-8">
            <button
              type="button"
              onClick={() => setShowBreakdown((v) => !v)}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-[#8a91a3] hover:text-white transition"
            >
              <span>Round-by-round breakdown</span>
              {showBreakdown ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </button>

            {showBreakdown && (
              <div className="geo-card mx-auto mt-3 max-w-[720px] divide-y divide-white/[0.08] p-4 text-left">
                {entries.map((entry) => {
                  const isSelf =
                    !isSpectator &&
                    ((selfPlayerId && entry.playerId === selfPlayerId) ||
                      (!selfPlayerId && entry.isHuman));
                  const av = getEntryAvatar(entry, isSelf);
                  const net = formatNetChips(entry.netChips);
                  return (
                    <div key={entry.playerId} className="py-3 first:pt-0 last:pb-0">
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-[#8a91a3]">
                            #{entry.rank}
                          </span>
                          <span className="font-medium text-white">
                            {av.displayName}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-[#8a91a3]">
                          {showBetting && (
                            <span
                              className={`rounded-md border px-1.5 py-0.5 font-mono font-medium ${net.badgeCls}`}
                            >
                              {net.label} chips
                            </span>
                          )}
                          <span>
                            Avg {entry.averageScore.toLocaleString()} · Best{' '}
                            {entry.bestRoundScore.toLocaleString()}
                          </span>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {entry.roundScores.map((rs) => (
                          <span
                            key={rs.roundNumber}
                            className="rounded-lg border border-white/10 bg-[#0b0d14] px-2.5 py-1 text-xs text-[#eef0f5]"
                          >
                            <span className="text-[#8a91a3]">
                              R{rs.roundNumber}:
                            </span>{' '}
                            <b>{rs.score.toLocaleString()}</b>
                            {rs.distanceKm !== null && (
                              <span className="text-[#8a91a3]">
                                {' '}
                                ({Math.round(rs.distanceKm)} km)
                              </span>
                            )}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
