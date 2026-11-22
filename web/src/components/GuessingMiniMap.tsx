import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Coins,
  Flag,
  MapPin,
  Maximize2,
  Minimize2,
  Pin,
} from 'lucide-react';
import type {
  HumanPlayerView,
  PlayerGuess,
  PlayerInfo,
} from '@geoguessr-mcp/shared';

export interface GuessingMiniMapProps {
  roundNumber: number;
  hasGuessed: boolean;
  myGuess: PlayerGuess | null;
  agents: PlayerInfo[];
  submitting: boolean;
  onSubmitGuess: (lat: number, lng: number, wager?: number) => void;
  onForceEndRound: () => void;
  bettingEnabled?: boolean;
  chips?: number;
  currentWager?: number | null;
  humans?: HumanPlayerView[];
  selfPlayerId?: string;
}

export function normalizeChips(chips: number): number {
  if (!Number.isFinite(chips)) return 0;
  const normalized = Math.max(0, Math.floor(chips));
  return normalized === 0 ? 0 : normalized;
}

export function clampWager(val: number, maxChips: number): number {
  if (!Number.isFinite(val)) return 0;
  const safeMax = normalizeChips(maxChips);
  const clamped = Math.max(0, Math.min(safeMax, Math.floor(val)));
  return clamped === 0 ? 0 : clamped;
}

function createPinIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: '',
    iconSize: [28, 36],
    iconAnchor: [14, 34],
    html: `<svg width="28" height="36" viewBox="0 0 28 36" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M14 0C6.268 0 0 6.268 0 14c0 10.5 14 22 14 22s14-11.5 14-22C28 6.268 21.732 0 14 0z" fill="${color}" stroke="#0f172a" stroke-width="2"/>
      <circle cx="14" cy="14" r="5" fill="#ffffff"/>
    </svg>`,
  });
}

export function GuessingMiniMap({
  roundNumber,
  hasGuessed,
  myGuess,
  agents,
  submitting,
  onSubmitGuess,
  onForceEndRound,
  bettingEnabled = false,
  chips = 0,
  currentWager = null,
  humans = [],
  selfPlayerId,
}: GuessingMiniMapProps) {
  const mapDivRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);

  const [collapsed, setCollapsed] = useState(false);
  const [pinnedOpen, setPinnedOpen] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const hovered = false;
  const [selectedCoords, setSelectedCoords] = useState<{
    lat: number;
    lng: number;
  } | null>(null);

  const safeChips = normalizeChips(chips);
  const [wager, setWager] = useState<number>(0);
  const [submittedWager, setSubmittedWager] = useState<number | null>(null);
  const clampedWager = clampWager(wager, safeChips);

  const hasGuessedRef = useRef(hasGuessed);
  hasGuessedRef.current = hasGuessed;
  const prevRoundRef = useRef(roundNumber);
  const prevHasGuessedRef = useRef(hasGuessed);

  // Reset selected pin and wager on new round or when hasGuessed resets (true -> false)
  useEffect(() => {
    const roundChanged = prevRoundRef.current !== roundNumber;
    const guessReset = prevHasGuessedRef.current && !hasGuessed;
    prevRoundRef.current = roundNumber;
    prevHasGuessedRef.current = hasGuessed;

    if (roundChanged || guessReset) {
      setSelectedCoords(null);
      setWager(0);
      setSubmittedWager(null);
      if (markerRef.current && mapRef.current) {
        mapRef.current.removeLayer(markerRef.current);
        markerRef.current = null;
      }
      if (mapRef.current) {
        mapRef.current.setView([20, 0], 2);
      }
    }
  }, [roundNumber, hasGuessed]);

  // Re-clamp wager whenever safeChips decreases
  useEffect(() => {
    setWager((prev) => clampWager(prev, safeChips));
  }, [safeChips]);

  // Initialize Leaflet map once
  const placePinAtLatLng = (latRaw: number, lngRaw: number) => {
    if (hasGuessedRef.current) return;
    const lat = Math.max(-85, Math.min(85, Number(latRaw.toFixed(5))));
    const wrappedLng = ((((lngRaw + 180) % 360) + 360) % 360) - 180;
    const lng = Number(wrappedLng.toFixed(5));
    setSelectedCoords({ lat, lng });

    const map = mapRef.current;
    if (!map) return;
    if (markerRef.current) {
      markerRef.current.setLatLng([lat, lng]);
    } else {
      markerRef.current = L.marker([lat, lng], {
        icon: createPinIcon('#38bdf8'),
      }).addTo(map);
    }
  };

  const handleMapPointerEvent = (e: React.MouseEvent<HTMLDivElement>) => {
    if (hasGuessedRef.current) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('.leaflet-control')) return;
    const map = mapRef.current;
    const el = mapDivRef.current;
    if (!map || !el) return;
    try {
      const latlng = map.mouseEventToLatLng(e.nativeEvent);
      if (latlng && Number.isFinite(latlng.lat) && Number.isFinite(latlng.lng)) {
        placePinAtLatLng(latlng.lat, latlng.lng);
        return;
      }
    } catch {
      // Fall back to bounding box interpolation
    }
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      const relX = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      const relY = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
      const lat = 70 - relY * 140;
      const lng = -160 + relX * 320;
      placePinAtLatLng(lat, lng);
    }
  };

  useEffect(() => {
    const el = mapDivRef.current;
    if (!el || mapRef.current) return;

    const map = L.map(el, {
      center: [20, 0],
      zoom: 2,
      minZoom: 1,
      worldCopyJump: true,
      attributionControl: false,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
    }).addTo(map);

    map.on('click', (evt: L.LeafletMouseEvent) => {
      placePinAtLatLng(evt.latlng.lat, evt.latlng.lng);
    });

    const onDomPointerCapture = (evt: MouseEvent) => {
      if (hasGuessedRef.current) return;
      const target = evt.target as HTMLElement | null;
      if (target?.closest('.leaflet-control')) return;
      try {
        const latlng = map.mouseEventToLatLng(evt);
        if (latlng && Number.isFinite(latlng.lat) && Number.isFinite(latlng.lng)) {
          placePinAtLatLng(latlng.lat, latlng.lng);
          return;
        }
      } catch {
        // Fall back to bounding box interpolation
      }
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        const relX = Math.max(0, Math.min(1, (evt.clientX - r.left) / r.width));
        const relY = Math.max(0, Math.min(1, (evt.clientY - r.top) / r.height));
        placePinAtLatLng(70 - relY * 140, -160 + relX * 320);
      }
    };

    el.addEventListener('mouseup', onDomPointerCapture, { capture: true });
    el.addEventListener('click', onDomPointerCapture, { capture: true });

    mapRef.current = map;

    let active = true;
    const ro = new ResizeObserver(() => {
      if (!active || mapRef.current !== map) return;
      map.invalidateSize({ animate: false });
    });
    ro.observe(el);

    return () => {
      active = false;
      el.removeEventListener('mouseup', onDomPointerCapture, { capture: true });
      el.removeEventListener('click', onDomPointerCapture, { capture: true });
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, []);

  const expanded = !collapsed && (hovered || pinnedOpen || maximized);

  useEffect(() => {
    const timer = setTimeout(() => {
      mapRef.current?.invalidateSize({ animate: false });
    }, 240);
    return () => clearTimeout(timer);
  }, [expanded, collapsed, maximized, bettingEnabled, hasGuessed]);

  const waitingAgents = agents.filter((a) => a.connected && !a.hasGuessed);
  const isMultiHuman = humans.length > 1;
  const waitingHumans = isMultiHuman
    ? humans.filter(
        (h) =>
          h.connected &&
          !h.hasGuessed &&
          (!selfPlayerId || h.id !== selfPlayerId)
      )
    : [];
  const waitingCount = waitingHumans.length + waitingAgents.length;

  const waitingSummaryText = isMultiHuman
    ? waitingCount > 0
      ? `Waiting for ${waitingCount} player${waitingCount === 1 ? '' : 's'}${
          waitingHumans.length > 0 && waitingAgents.length > 0
            ? ` (${waitingHumans.length} human, ${waitingAgents.length} AI)`
            : ''
        }`
      : ''
    : waitingAgents.length > 0
      ? `Waiting for ${waitingAgents.length} AI`
      : '';

  const rawLockedWager =
    currentWager ?? myGuess?.wager ?? submittedWager ?? 0;
  const lockedWager = Number.isFinite(rawLockedWager)
    ? Math.max(0, Math.floor(rawLockedWager))
    : 0;

  const showBettingControls = bettingEnabled && !hasGuessed;

  const boxSizeClass = collapsed
    ? 'w-72 h-11'
    : maximized
      ? 'w-[min(640px,90vw)] h-[min(460px,68vh)]'
      : expanded
        ? showBettingControls
          ? 'w-[min(440px,calc(100vw-2.5rem))] h-[376px]'
          : 'w-[min(430px,calc(100vw-2.5rem))] h-[310px]'
        : showBettingControls
          ? 'w-80 h-80'
          : 'w-72 h-48';

  const presets = [
    { label: '0', value: 0, optionDisabled: false },
    { label: '100', value: 100, optionDisabled: safeChips < 100 },
    { label: '250', value: 250, optionDisabled: safeChips < 250 },
    {
      label: '50%',
      value: Math.floor(safeChips * 0.5),
      optionDisabled: safeChips === 0,
    },
    { label: 'All-In', value: safeChips, optionDisabled: safeChips === 0 },
  ];

  const handleSubmit = () => {
    if (!selectedCoords || submitting) return;
    if (bettingEnabled) {
      setSubmittedWager(clampedWager);
      onSubmitGuess(selectedCoords.lat, selectedCoords.lng, clampedWager);
    } else {
      onSubmitGuess(selectedCoords.lat, selectedCoords.lng);
    }
  };

  return (
    <div
      className={`absolute bottom-5 right-5 z-30 flex max-h-[calc(100vh-6rem)] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-2xl border border-white/15 bg-slate-950/90 backdrop-blur-md shadow-2xl ${boxSizeClass}`}
    >
      {/* Header Bar */}
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2 text-xs">
        <div className="flex items-center gap-2 font-semibold text-slate-100">
          <MapPin className="h-3.5 w-3.5 text-sky-400" />
          <span>Guess Map</span>
          {selectedCoords && !hasGuessed && (
            <span className="font-mono text-[10px] text-slate-400">
              {selectedCoords.lat.toFixed(2)}, {selectedCoords.lng.toFixed(2)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {!collapsed && (
            <>
              <button
                type="button"
                onClick={() => setPinnedOpen((p) => !p)}
                title={pinnedOpen ? 'Unpin map size' : 'Pin map expanded'}
                className={`rounded-md p-1 transition ${
                  pinnedOpen
                    ? 'bg-sky-500/25 text-sky-300'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                }`}
              >
                <Pin className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setMaximized((m) => !m)}
                title={maximized ? 'Restore size' : 'Maximize map'}
                className="rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition"
              >
                {maximized ? (
                  <Minimize2 className="h-3.5 w-3.5" />
                ) : (
                  <Maximize2 className="h-3.5 w-3.5" />
                )}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? 'Expand map' : 'Collapse map'}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition"
          >
            {collapsed ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      {/* Leaflet Canvas */}
      <div
        onMouseUp={handleMapPointerEvent}
        onClick={handleMapPointerEvent}
        className={`relative min-h-0 flex-1 ${collapsed ? 'hidden' : 'block'}`}
      >
        <div ref={mapDivRef} className="h-full w-full" />
      </div>

      {/* Action Footer */}
      {!collapsed && (
        <div className="border-t border-white/10 bg-slate-950/95 p-2 flex flex-col gap-2">
          {hasGuessed ? (
            <div className="flex w-full items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1.5 text-xs text-emerald-400 font-medium">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span className="truncate">
                  Locked
                  {myGuess
                    ? ` (${myGuess.latitude.toFixed(2)}, ${myGuess.longitude.toFixed(2)})`
                    : ''}
                  {bettingEnabled
                    ? ` · Wagered ${lockedWager.toLocaleString()} chips`
                    : ''}
                  {waitingSummaryText ? ` · ${waitingSummaryText}` : ''}
                </span>
              </div>
              {waitingCount > 0 && (
                <button
                  type="button"
                  onClick={onForceEndRound}
                  className="shrink-0 rounded-lg border border-amber-500/40 bg-amber-500/15 px-2.5 py-1 text-[11px] font-semibold text-amber-300 hover:bg-amber-500/25 transition"
                >
                  End Round Now
                </button>
              )}
            </div>
          ) : (
            <>
              {bettingEnabled && (
                <div className="rounded-xl border border-amber-400/20 bg-slate-900/80 px-2.5 py-2 space-y-1.5">
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <div className="flex items-center gap-1.5 font-semibold text-slate-200">
                      <Coins className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                      <span>Confidence Bet</span>
                    </div>
                    <span className="rounded-full border border-amber-400/30 bg-amber-400/15 px-2 py-0.5 font-mono text-[10px] font-bold text-amber-300">
                      {safeChips.toLocaleString()} chips
                    </span>
                  </div>

                  {safeChips === 0 && (
                    <div className="text-[10px] text-slate-400">
                      0 chips — free guess (0 wager)
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      aria-label="Confidence wager slider"
                      min={0}
                      max={safeChips}
                      step={1}
                      value={clampedWager}
                      disabled={submitting || safeChips === 0}
                      onChange={(e) =>
                        setWager(clampWager(Number(e.target.value), safeChips))
                      }
                      className="h-1.5 flex-1 cursor-pointer accent-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
                    />
                    <input
                      type="number"
                      aria-label="Confidence wager amount"
                      min={0}
                      max={safeChips}
                      step={1}
                      value={clampedWager}
                      disabled={submitting || safeChips === 0}
                      onChange={(e) => {
                        const raw = e.target.value;
                        if (raw === '') {
                          setWager(0);
                          return;
                        }
                        setWager(clampWager(Number(raw), safeChips));
                      }}
                      className="w-16 rounded-lg border border-white/15 bg-slate-950 px-2 py-0.5 text-right font-mono text-[11px] font-semibold text-amber-300 focus:border-amber-400/60 focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
                    />
                  </div>

                  <div className="grid grid-cols-5 gap-1">
                    {presets.map((preset) => {
                      const isActive =
                        !preset.optionDisabled && clampedWager === preset.value;
                      return (
                        <button
                          key={preset.label}
                          type="button"
                          disabled={submitting || preset.optionDisabled}
                          onClick={() =>
                            setWager(clampWager(preset.value, safeChips))
                          }
                          className={`rounded-md border px-1 py-0.5 text-[10px] font-semibold transition ${
                            isActive
                              ? 'border-amber-400/60 bg-amber-400/20 text-amber-200'
                              : 'border-white/10 bg-slate-950/80 text-slate-300 hover:bg-slate-800'
                          } disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-slate-950/80`}
                        >
                          {preset.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <button
                type="button"
                disabled={!selectedCoords || submitting}
                onClick={handleSubmit}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-3 py-2 text-xs font-bold text-slate-950 shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
              >
                <Flag className="h-3.5 w-3.5" />
                <span>
                  {submitting
                    ? 'Submitting...'
                    : selectedCoords
                      ? bettingEnabled
                        ? `Submit Guess · Wager ${clampedWager.toLocaleString()}`
                        : 'Submit Guess'
                      : 'Click Map to Drop Pin'}
                </span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
