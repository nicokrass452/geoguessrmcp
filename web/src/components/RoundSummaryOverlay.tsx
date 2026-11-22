import { useEffect, useRef } from 'react';
import L from 'leaflet';
import {
  ArrowRight,
  Bot,
  Clock,
  Coins,
  Eye,
  Flag,
  MapPin,
  MessageSquareQuote,
  Trophy,
  User,
} from 'lucide-react';
import type { RoundSummary } from '@geoguessr-mcp/shared';

export interface RoundSummaryOverlayProps {
  summary: RoundSummary;
  roundNumber: number;
  totalRounds: number;
  advancing: boolean;
  onNextRound: () => void;
  bettingEnabled?: boolean;
  isHost?: boolean;
  isSpectator?: boolean;
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
      badgeCls: 'border-white/10 bg-slate-900/80 text-slate-500',
    };
  }
  const normalized = chipDelta === 0 ? 0 : chipDelta;
  if (normalized > 0) {
    return {
      text: `+${normalized.toLocaleString()}`,
      badgeCls: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
    };
  }
  if (normalized < 0) {
    return {
      text: `-${Math.abs(normalized).toLocaleString()}`,
      badgeCls: 'border-rose-500/30 bg-rose-500/10 text-rose-400',
    };
  }
  return {
    text: '0',
    badgeCls: 'border-white/10 bg-slate-800/70 text-slate-400',
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
  fallback = '#38bdf8'
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
    iconSize: [34, 34],
    iconAnchor: [17, 32],
    html: `<div style="display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:9999px;background:#10b981;border:3px solid #022c22;box-shadow:0 4px 12px rgba(0,0,0,0.45);color:#022c22;font-weight:800;font-size:14px;">★</div>`,
  });
}

function createPlayerPinIcon(color: string, label: string): L.DivIcon {
  const safeInitial = escapeHtml(label.slice(0, 2).toUpperCase());
  const safeColor = sanitizeCssColor(color);
  return L.divIcon({
    className: '',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    html: `<div style="display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:9999px;background:${safeColor};border:2px solid #0f172a;box-shadow:0 2px 8px rgba(0,0,0,0.45);color:#ffffff;font-weight:700;font-size:10px;">${safeInitial}</div>`,
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
}: RoundSummaryOverlayProps) {
  const mapElRef = useRef<HTMLDivElement | null>(null);

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

      const safeName = escapeHtml(r.name);
      const hasBettingFields =
        isFiniteNum(r.wager) || isFiniteNum(r.chipDelta);
      const bettingTooltipSuffix =
        showBetting && hasBettingFields
          ? `<br/>Wager: ${formatWager(r.wager)} · Net: ${formatChipDelta(r.chipDelta).text} chips`
          : '';

      const safeColor = sanitizeCssColor(r.color);

      L.marker(gLatLng, { icon: createPlayerPinIcon(safeColor, r.name) })
        .bindTooltip(
          `<strong>${safeName}</strong><br/>${formatDistance(r.distanceKm)} · ${r.score} pts${bettingTooltipSuffix}`,
          { direction: 'top' }
        )
        .addTo(map);

      L.polyline([gLatLng, targetLatLng], {
        color: safeColor,
        weight: 3,
        opacity: 0.85,
        dashArray: '6 6',
      }).addTo(map);
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      map.invalidateSize({ animate: false });
      map.fitBounds(bounds, { padding: [45, 45], maxZoom: 12 });
    }, 80);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      map.remove();
    };
  }, [summary, showBetting]);

  const reasonings = summary.results.filter((r) => r.guess?.reasoning);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/80 p-3 sm:p-6 backdrop-blur-md">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-white/15 bg-slate-900 shadow-2xl">
        {/* Map Section */}
        <div className="relative h-64 sm:h-80 w-full shrink-0 border-b border-white/10">
          <div ref={mapElRef} className="h-full w-full" />
          <div className="pointer-events-none absolute top-3 left-3 z-[450] flex items-center gap-2 rounded-xl border border-emerald-400/30 bg-slate-950/90 px-3 py-1.5 backdrop-blur-md shadow-lg">
            <Flag className="h-4 w-4 text-emerald-400" />
            <div>
              <div className="text-xs font-bold text-slate-100">
                {summary.target.city}, {summary.target.country}
              </div>
              <div className="text-[10px] text-slate-400">
                {summary.target.name} ·{' '}
                {summary.target.latitude.toFixed(4)},{' '}
                {summary.target.longitude.toFixed(4)}
              </div>
            </div>
          </div>
        </div>

        {/* Standings & Agent Reasoning */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 sm:p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-extrabold text-slate-100">
                  Round {roundNumber} of {totalRounds} Summary
                </h2>
                {isSpectator && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-sky-400/30 bg-sky-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-sky-300">
                    <Eye className="h-3 w-3" />
                    <span>AI-Only Spectator</span>
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400">
                Scored on 0–5,000 exponential Haversine scale (
                {summary.target.region} · {summary.target.provider})
              </p>
            </div>
            {isHost ? (
              <button
                type="button"
                disabled={advancing}
                onClick={onNextRound}
                className="flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-bold text-slate-950 shadow-lg shadow-emerald-500/20 hover:bg-emerald-400 disabled:opacity-60 transition"
              >
                <span>
                  {advancing
                    ? 'Loading...'
                    : roundNumber >= totalRounds
                      ? 'View Final Standings'
                      : 'Next Round'}
                </span>
                <ArrowRight className="h-4 w-4" />
              </button>
            ) : (
              <div
                role="status"
                className="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-800/80 px-4 py-2.5 text-xs font-semibold text-slate-300"
              >
                <Clock className="h-4 w-4 shrink-0 text-amber-400" />
                <span>
                  {roundNumber >= totalRounds
                    ? 'Waiting for host to open final standings...'
                    : 'Waiting for host to start next round...'}
                </span>
              </div>
            )}
          </div>

          {/* Results List */}
          <div className="space-y-2.5">
            {summary.results.map((r, idx) => {
              const pct = Math.round((r.score / 5000) * 100);
              const delta = formatChipDelta(r.chipDelta);
              const hasChipsAfter = isFiniteNum(r.chipsAfter);
              const normalizedChipsAfter =
                hasChipsAfter && r.chipsAfter === 0 ? 0 : r.chipsAfter;
              return (
                <div
                  key={r.playerId}
                  className="rounded-2xl border border-white/10 bg-slate-950/60 p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-800 text-xs font-bold text-slate-300">
                        {idx + 1}
                      </span>
                      <span
                        className="h-3 w-3 shrink-0 rounded-full"
                        style={{ backgroundColor: r.color }}
                      />
                      <span className="flex items-center gap-1.5 truncate text-sm font-bold text-slate-100">
                        {r.isHuman ? (
                          <User className="h-3.5 w-3.5 shrink-0 text-sky-400" />
                        ) : (
                          <Bot className="h-3.5 w-3.5 shrink-0 text-rose-400" />
                        )}
                        <span className="truncate">{r.name}</span>
                      </span>
                      {r.model && (
                        <span className="hidden sm:inline rounded-md bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
                          {r.model}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-right shrink-0 ml-auto">
                      <span className="flex items-center gap-1 text-xs text-slate-400">
                        <MapPin className="h-3 w-3" />
                        {formatDistance(r.distanceKm)}
                      </span>
                      <span className="flex items-center gap-1 text-sm font-extrabold text-emerald-400 min-w-[78px] justify-end">
                        <Trophy className="h-3.5 w-3.5 text-amber-400" />
                        {r.score.toLocaleString()}
                      </span>
                    </div>
                  </div>
                  {showBetting && (
                    <div className="mt-2.5 grid grid-cols-3 gap-2 sm:flex sm:flex-wrap sm:items-center sm:justify-end sm:gap-2.5 text-xs">
                      <div className="flex items-center justify-between sm:justify-start gap-1.5 rounded-xl border border-white/10 bg-slate-900/80 px-2.5 py-1">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                          Wager
                        </span>
                        <span
                          className={`font-mono font-bold tabular-nums ${
                            isFiniteNum(r.wager)
                              ? r.wager === 0
                                ? 'text-slate-300'
                                : 'text-amber-300'
                              : 'text-slate-500'
                          }`}
                        >
                          {formatWager(r.wager)}
                        </span>
                      </div>
                      <div
                        className={`flex items-center justify-between sm:justify-start gap-1.5 rounded-xl border px-2.5 py-1 ${delta.badgeCls}`}
                      >
                        <span className="text-[10px] font-semibold uppercase tracking-wider opacity-80">
                          Net
                        </span>
                        <span className="font-mono font-bold tabular-nums">
                          {delta.text}
                        </span>
                      </div>
                      <div className="flex items-center justify-between sm:justify-start gap-1.5 rounded-xl border border-white/10 bg-slate-900/80 px-2.5 py-1">
                        <Coins className="h-3 w-3 text-amber-400 hidden sm:inline shrink-0" />
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                          Chips
                        </span>
                        <span
                          className={`font-mono font-bold tabular-nums ${
                            normalizedChipsAfter === 0
                              ? 'text-rose-300'
                              : hasChipsAfter
                                ? 'text-slate-100'
                                : 'text-slate-500'
                          }`}
                        >
                          {formatChipsAfter(r.chipsAfter)}
                        </span>
                      </div>
                    </div>
                  )}
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${pct}%`,
                        backgroundColor: r.color,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Agent Reasoning Cards */}
          {reasonings.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-400">
                <MessageSquareQuote className="h-3.5 w-3.5 text-sky-400" />
                <span>AI Agent Deductions</span>
              </div>
              <div className="grid gap-2.5 sm:grid-cols-2">
                {reasonings.map((r) => (
                  <div
                    key={r.playerId}
                    className="rounded-xl border border-white/10 bg-slate-950/70 p-3 text-xs"
                  >
                    <div className="mb-1 flex items-center gap-2 font-bold text-slate-200">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: r.color }}
                      />
                      <span>{r.name}</span>
                    </div>
                    <p className="text-slate-300 leading-relaxed">
                      {r.guess?.reasoning}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
