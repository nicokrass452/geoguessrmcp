import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Clock,
  MessageSquare,
} from 'lucide-react';
import type { RoundSummary } from '@geoguessr-mcp/shared';
import { getModelUiMeta, getPlayerInitials } from '../lib/uiHelpers';

export interface RoundSummaryOverlayProps {
  summary: RoundSummary;
  roundNumber: number;
  totalRounds: number;
  advancing: boolean;
  onNextRound: () => void;
  bettingEnabled?: boolean;
  isHost?: boolean;
  isSpectator?: boolean;
  selfPlayerId?: string;
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isFiniteNum(val: unknown): val is number {
  return typeof val === 'number' && Number.isFinite(val);
}

export function formatWager(wager?: number): string {
  if (!isFiniteNum(wager)) return '—';
  const normalized = wager === 0 ? 0 : wager;
  return normalized.toLocaleString();
}

export function formatChipDelta(chipDelta?: number): {
  text: string;
  badgeCls: string;
} {
  if (!isFiniteNum(chipDelta)) {
    return {
      text: '—',
      badgeCls: 'border-white/10 bg-[#0b0d14] text-[#8a91a3]',
    };
  }
  const normalized = chipDelta === 0 ? 0 : chipDelta;
  if (normalized > 0) {
    return {
      text: `+${normalized.toLocaleString()}`,
      badgeCls: 'border-[#ff7a2f]/30 bg-[#ff7a2f]/15 text-[#ff7a2f]',
    };
  }
  if (normalized < 0) {
    return {
      text: `-${Math.abs(normalized).toLocaleString()}`,
      badgeCls: 'border-[#e5484d]/30 bg-[#e5484d]/10 text-[#f2777b]',
    };
  }
  return {
    text: '0',
    badgeCls: 'border-white/10 bg-[#1a1e28] text-[#8a91a3]',
  };
}

export function formatChipsAfter(chipsAfter?: number): string {
  if (!isFiniteNum(chipsAfter)) return '—';
  const normalized = chipsAfter === 0 ? 0 : chipsAfter;
  return normalized.toLocaleString();
}

const SAFE_HEX_COLOR_RE =
  /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const SAFE_NAMED_COLOR_RE = /^[a-zA-Z]{3,20}$/;
const SAFE_FUNC_COLOR_RE = /^(?:rgb|hsl)a?\(\s*[\d.,%\s/]+\s*\)$/i;

export function sanitizeCssColor(
  color: string,
  fallback = '#60a5fa'
): string {
  const trimmed = typeof color === 'string' ? color.trim() : '';
  if (
    SAFE_HEX_COLOR_RE.test(trimmed) ||
    SAFE_NAMED_COLOR_RE.test(trimmed) ||
    SAFE_FUNC_COLOR_RE.test(trimmed)
  ) {
    return trimmed;
  }
  return fallback;
}

function createTargetIcon(): L.DivIcon {
  return L.divIcon({
    className: '',
    iconSize: [38, 38],
    iconAnchor: [19, 19],
    html: `<div style="display:flex;align-items:center;justify-content:center;width:38px;height:38px;"><svg width="30" height="30" viewBox="0 0 20 20" style="filter:drop-shadow(0 2px 4px rgba(0,0,0,.5))"><rect x="1" y="1" width="18" height="18" rx="3" fill="#eef0f5" stroke="#0b0d14" stroke-width="1.5"/><path d="M19 1v15a3 3 0 0 1-3 3H1z" fill="#ff7a2f"/></svg></div>`,
  });
}

function createPlayerPinIcon(color: string, badge: string): L.DivIcon {
  const safeInitial = escapeHtml(badge.slice(0, 2).toUpperCase());
  const safeColor = sanitizeCssColor(color);
  return L.divIcon({
    className: '',
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    html: `<div style="display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:9999px;background:${safeColor};border:3px solid #ffffff;box-shadow:0 4px 12px rgba(0,0,0,0.45);color:#0b0d14;font-weight:800;font-size:11px;">${safeInitial}</div>`,
  });
}

function formatDistance(km: number | null): string {
  if (km === null) return 'No guess';
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toLocaleString(undefined, { maximumFractionDigits: 1 })} km`;
}

export function RoundSummaryOverlay({
  summary,
  roundNumber,
  totalRounds,
  advancing,
  onNextRound,
  bettingEnabled,
  isHost = true,
  isSpectator = false,
  selfPlayerId,
}: RoundSummaryOverlayProps) {
  const mapElRef = useRef<HTMLDivElement | null>(null);
  const [showReasonings, setShowReasonings] = useState(false);

  const showBetting =
    bettingEnabled ??
    summary.results.some(
      (r) => r.wager !== undefined || r.chipDelta !== undefined
    );

  useEffect(() => {
    const el = mapElRef.current;
    if (!el) return;

    const map = L.map(el, {
      center: [summary.target.latitude, summary.target.longitude],
      zoom: 4,
      attributionControl: false,
      zoomControl: false,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
    }).addTo(map);

    const targetLatLng: [number, number] = [
      summary.target.latitude,
      summary.target.longitude,
    ];
    const bounds = L.latLngBounds([targetLatLng]);

    L.marker(targetLatLng, { icon: createTargetIcon() })
      .bindTooltip(
        `<strong>Actual Location:</strong> ${escapeHtml(summary.target.city)}, ${escapeHtml(summary.target.country)}`,
        { direction: 'top' }
      )
      .addTo(map);

    for (const r of summary.results) {
      if (!r.guess) continue;
      const gLatLng: [number, number] = [r.guess.latitude, r.guess.longitude];
      bounds.extend(gLatLng);

      const isSelf =
        (selfPlayerId && r.playerId === selfPlayerId) ||
        (!selfPlayerId && r.isHuman);
      const avatarMeta = !r.isHuman && r.model
        ? getModelUiMeta(r.model, undefined, r.name)
        : {
            badge: getPlayerInitials(r.name),
            color: isSelf ? '#60a5fa' : sanitizeCssColor(r.color),
            shortName: r.name,
          };

      const safeName = escapeHtml(avatarMeta.shortName);
      const hasBettingFields =
        isFiniteNum(r.wager) || isFiniteNum(r.chipDelta);
      const bettingTooltipSuffix =
        showBetting && hasBettingFields
          ? `<br/>Wager: ${formatWager(r.wager)} · Net: ${formatChipDelta(r.chipDelta).text} chips`
          : '';

      L.marker(gLatLng, {
        icon: createPlayerPinIcon(avatarMeta.color, avatarMeta.badge),
      })
        .bindTooltip(
          `<strong>${safeName}</strong><br/>${formatDistance(r.distanceKm)} · ${r.score} pts${bettingTooltipSuffix}`,
          { direction: 'top' }
        )
        .addTo(map);

      L.polyline([gLatLng, targetLatLng], {
        color: avatarMeta.color,
        weight: 3,
        opacity: 0.9,
        dashArray: '7 6',
      }).addTo(map);
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      map.invalidateSize({ animate: false });
      map.fitBounds(bounds, {
        paddingTopLeft: [60, 80],
        paddingBottomRight: [60, 320],
        maxZoom: 11,
      });
    }, 80);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      map.remove();
    };
  }, [summary, showBetting, selfPlayerId]);

  const reasonings = summary.results.filter((r) => r.guess?.reasoning);

  const selfResult = !isSpectator
    ? summary.results.find((r) =>
        selfPlayerId ? r.playerId === selfPlayerId : r.isHuman
      ) ?? summary.results[0]
    : summary.results[0];

  const headlinePct = selfResult
    ? Math.max(4, Math.min(100, Math.round((selfResult.score / 5000) * 100)))
    : 0;

  return (
    <div className="fixed inset-0 z-40 overflow-hidden bg-[#0b0d14]">
      {/* Full-Screen Result Map */}
      <div ref={mapElRef} className="fixed inset-0 h-full w-full" />

      {/* Top-Center Round Pill */}
      <div className="pointer-events-none fixed top-4 left-1/2 z-[450] -translate-x-1/2 rounded-full border border-white/15 bg-[#0b0d14]/85 px-5 py-2 text-sm font-medium text-white backdrop-blur-md shadow-xl">
        Round {roundNumber} of {totalRounds}
      </div>

      {/* Bottom Floating Summary Panel */}
      <div className="fixed bottom-5 left-1/2 z-[450] -translate-x-1/2 w-[min(900px,calc(100vw-2rem))] rounded-2xl border border-white/15 bg-[#11141c]/95 p-5 sm:p-6 backdrop-blur-md shadow-2xl">
        {/* Headline Row */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <small className="text-[12px] font-medium text-[#8a91a3]">
              The location was
            </small>
            <h1 className="mt-0.5 text-2xl sm:text-[30px] font-medium tracking-[-0.01em] text-white">
              {summary.target.city}, {summary.target.country}
            </h1>
          </div>

          {selfResult && (
            <div className="text-right ml-auto">
              <div className="flex items-baseline justify-end gap-2">
                <span className="text-3xl sm:text-[40px] font-semibold leading-none text-[#ff7a2f]">
                  +{selfResult.score.toLocaleString()}
                </span>
                {showBetting && isFiniteNum(selfResult.chipDelta) && (
                  <span
                    className={`rounded-lg border px-2 py-0.5 font-mono text-xs font-medium ${
                      formatChipDelta(selfResult.chipDelta).badgeCls
                    }`}
                  >
                    {formatChipDelta(selfResult.chipDelta).text} chips
                  </span>
                )}
              </div>
              <div className="mt-1 text-[15px] text-[#8a91a3]">
                {isSpectator
                  ? `${selfResult.name} was ${formatDistance(selfResult.distanceKm)} away`
                  : selfResult.distanceKm !== null
                    ? `You were ${formatDistance(selfResult.distanceKm)} away`
                    : 'No guess submitted'}
              </div>
            </div>
          )}
        </div>

        {/* Progress Bar */}
        <div className="my-4 h-2 w-full overflow-hidden rounded-full bg-[#1a1e28]">
          <div
            className="h-full w-full origin-left rounded-full bg-[#ff7a2f] transition-transform duration-500 ease-[cubic-bezier(0.23,1,0.32,1)]"
            style={{ transform: `scaleX(${headlinePct / 100})` }}
          />
        </div>

        {/* Compact Players Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          {summary.results.map((r, idx) => {
            const isSelf =
              !isSpectator &&
              ((selfPlayerId && r.playerId === selfPlayerId) ||
                (!selfPlayerId && r.isHuman));
            const meta =
              !r.isHuman && r.model
                ? getModelUiMeta(r.model, undefined, r.name)
                : {
                    badge: getPlayerInitials(r.name),
                    color: isSelf ? '#60a5fa' : sanitizeCssColor(r.color),
                    shortName: r.name,
                  };
            return (
              <div
                key={r.playerId}
                className={`flex items-center gap-2.5 rounded-xl border bg-[#0b0d14] px-3 py-2.5 ${
                  isSelf
                    ? 'border-[#60a5fa]/60'
                    : 'border-white/[0.08]'
                }`}
              >
                <div
                  style={{ backgroundColor: meta.color }}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-[#0b0d14]"
                >
                  {meta.badge}
                </div>
                <div className="min-w-0 flex-1">
                  <b className="block truncate text-[14px] font-medium text-white">
                    {idx + 1}. {isSelf ? 'You' : meta.shortName}
                  </b>
                  <span className="block truncate text-[12px] text-[#8a91a3]">
                    {formatDistance(r.distanceKm)} · {r.score.toLocaleString()}
                    {showBetting && isFiniteNum(r.chipDelta)
                      ? ` · ${formatChipDelta(r.chipDelta).text}c`
                      : ''}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Collapsible AI Reasoning */}
        {showReasonings && reasonings.length > 0 && (
          <div className="mt-4 max-h-44 overflow-y-auto custom-scrollbar grid gap-2.5 sm:grid-cols-2 border-t border-white/10 pt-3.5">
            {reasonings.map((r) => {
              const meta = r.model
                ? getModelUiMeta(r.model, undefined, r.name)
                : {
                    badge: getPlayerInitials(r.name),
                    color: sanitizeCssColor(r.color),
                    shortName: r.name,
                  };
              return (
                <div
                  key={r.playerId}
                  className="rounded-xl border border-white/10 bg-[#0b0d14] p-3 text-xs"
                >
                  <div className="mb-1 flex items-center gap-2 font-medium text-white">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: meta.color }}
                    />
                    <span>{meta.shortName}</span>
                  </div>
                  <p className="text-[#8a91a3] leading-relaxed">
                    {r.guess?.reasoning}
                  </p>
                </div>
              );
            })}
          </div>
        )}

        {/* Actions Footer */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            {reasonings.length > 0 && (
              <button
                type="button"
                onClick={() => setShowReasonings((v) => !v)}
                className="inline-flex items-center gap-1.5 text-[14px] font-medium text-[#8a91a3] hover:text-white transition"
              >
                <MessageSquare className="h-4 w-4" />
                <span>See how the AIs reasoned</span>
                {showReasonings ? (
                  <ChevronUp className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
              </button>
            )}
          </div>

          {isHost ? (
            <button
              type="button"
              disabled={advancing}
              onClick={onNextRound}
              className="inline-flex items-center gap-2 rounded-[14px] bg-[#ff7a2f] px-7 py-3.5 text-[16px] font-medium text-[#1f0e03] hover:bg-[#ff8d4d] disabled:opacity-60 transition"
            >
              <span>
                {advancing
                  ? 'Loading…'
                  : roundNumber >= totalRounds
                    ? 'See final results'
                    : 'Next round'}
              </span>
              <ArrowRight className="h-4 w-4" />
            </button>
          ) : (
            <div
              role="status"
              className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-[#1a1e28] px-4 py-2.5 text-sm font-semibold text-[#8a91a3]"
            >
              <Clock className="h-4 w-4 text-[#a3a9b8]" />
              <span>
                {roundNumber >= totalRounds
                  ? 'Waiting for host to open final results…'
                  : 'Waiting for host to start next round…'}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
