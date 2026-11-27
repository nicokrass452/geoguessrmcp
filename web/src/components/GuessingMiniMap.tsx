import { useCallback, useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Coins,
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
      <path d="M14 0C6.268 0 0 6.268 0 14c0 10.5 14 22 14 22s14-11.5 14-22C28 6.268 21.732 0 14 0z" fill="${color}" stroke="#ffffff" stroke-width="2.5"/>
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
  const [hovered, setHovered] = useState(false);
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
        icon: createPinIcon('#60a5fa'),
      }).addTo(map);
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

    let pointerDownPos: { x: number; y: number } | null = null;
    const onDomMouseDownCapture = (evt: MouseEvent) => {
      pointerDownPos = { x: evt.clientX, y: evt.clientY };
    };

    const onDomClickCapture = (evt: MouseEvent) => {
      if (hasGuessedRef.current) return;
      const target = evt.target as HTMLElement | null;
      if (target?.closest('.leaflet-control')) return;
      if (pointerDownPos) {
        const dx = evt.clientX - pointerDownPos.x;
        const dy = evt.clientY - pointerDownPos.y;
        pointerDownPos = null;
        if (Math.hypot(dx, dy) >= 6) {
          return;
        }
      }
      try {
        const latlng = map.mouseEventToLatLng(evt);
        if (
          latlng &&
          Number.isFinite(latlng.lat) &&
          Number.isFinite(latlng.lng)
        ) {
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

    el.addEventListener('mousedown', onDomMouseDownCapture, { capture: true });
    el.addEventListener('click', onDomClickCapture, { capture: true });

    mapRef.current = map;

    let active = true;
    const ro = new ResizeObserver(() => {
      if (!active || mapRef.current !== map) return;
      map.invalidateSize({ animate: false });
    });
    ro.observe(el);

    return () => {
      active = false;
      el.removeEventListener('mousedown', onDomMouseDownCapture, {
        capture: true,
      });
      el.removeEventListener('click', onDomClickCapture, { capture: true });
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

  const handleSubmit = useCallback(() => {
    if (!selectedCoords || submitting || hasGuessed) return;
    if (bettingEnabled) {
      setSubmittedWager(clampedWager);
      onSubmitGuess(selectedCoords.lat, selectedCoords.lng, clampedWager);
    } else {
      onSubmitGuess(selectedCoords.lat, selectedCoords.lng);
    }
  }, [
    selectedCoords,
    submitting,
    hasGuessed,
    bettingEnabled,
    clampedWager,
    onSubmitGuess,
  ]);

  // Spacebar shortcut to submit guess
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat) return;
      const tag = document.activeElement?.tagName;
      if (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        tag === 'BUTTON'
      ) {
        return;
      }
      if (!selectedCoords || hasGuessed || submitting) return;
      e.preventDefault();
      handleSubmit();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedCoords, hasGuessed, submitting, handleSubmit]);

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
      ? `Waiting for ${waitingCount} player${waitingCount === 1 ? '' : 's'}`
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
    ? 'w-72 h-12'
    : maximized
      ? 'w-[min(680px,90vw)] h-[min(500px,72vh)]'
      : expanded
        ? showBettingControls
          ? 'w-[min(460px,calc(100vw-2rem))] h-[420px]'
          : 'w-[min(460px,calc(100vw-2rem))] h-[352px]'
        : showBettingControls
          ? 'w-[min(420px,calc(100vw-2rem))] h-[360px]'
          : 'w-[min(420px,calc(100vw-2rem))] h-[300px]';

  const presets = [
    { label: '0', value: 0, optionDisabled: false },
    { label: '100', value: 100, optionDisabled: safeChips < 100 },
    { label: '250', value: 250, optionDisabled: safeChips < 250 },
    {
      label: '50%',
      value: Math.floor(safeChips * 0.5),
      optionDisabled: safeChips === 0,
    },
    { label: 'All-in', value: safeChips, optionDisabled: safeChips === 0 },
  ];

  return (
    <div
      data-testid="guess-minimap"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`geo-glass absolute bottom-4 right-4 z-30 flex max-h-[calc(100vh-6rem)] max-w-[calc(100vw-2rem)] flex-col overflow-hidden p-0 shadow-2xl transition-[border-color,opacity] duration-200 ${boxSizeClass}`}
    >
      {collapsed ? (
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="flex h-full w-full items-center justify-between px-4 text-sm font-semibold text-white hover:bg-white/5 transition"
        >
          <span className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-[#ff7a2f]" />
            <span>Open guess map</span>
          </span>
          <ChevronUp className="h-4 w-4 text-[#8a91a3]" />
        </button>
      ) : (
        <>
          {/* Map Canvas + Floating Top-Right Mini Controls */}
          <div className="relative min-h-0 flex-1">
            <div ref={mapDivRef} className="h-full w-full" />

            <div className="absolute top-2.5 right-2.5 z-[450] flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setMaximized((m) => !m)}
                title={maximized ? 'Restore map' : 'Maximize map'}
                className="grid h-8 w-8 place-items-center rounded-lg bg-[#0b0d14]/85 text-[#eef0f5] border border-white/15 hover:bg-[#1a1e28] transition"
              >
                {maximized ? (
                  <Minimize2 className="h-3.5 w-3.5" />
                ) : (
                  <Maximize2 className="h-3.5 w-3.5" />
                )}
              </button>
              <button
                type="button"
                onClick={() => setPinnedOpen((p) => !p)}
                title={pinnedOpen ? 'Unpin map size' : 'Pin map expanded'}
                className={`grid h-8 w-8 place-items-center rounded-lg border transition ${
                  pinnedOpen
                    ? 'border-[#ff7a2f] bg-[#ff7a2f]/20 text-[#ff7a2f]'
                    : 'border-white/15 bg-[#0b0d14]/85 text-[#eef0f5] hover:bg-[#1a1e28]'
                }`}
              >
                <Pin className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setCollapsed(true)}
                title="Collapse map"
                className="grid h-8 w-8 place-items-center rounded-lg bg-[#0b0d14]/85 text-[#eef0f5] border border-white/15 hover:bg-[#1a1e28] transition"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Footer: Optional Betting + Big Guess CTA */}
          <div className="border-t border-white/10 bg-[#0b0d14]/90 p-3 flex flex-col gap-2.5">
            {hasGuessed ? (
              <div className="flex w-full items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2 text-sm text-[#ff7a2f] font-semibold">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span className="truncate">
                    Guess locked
                    {bettingEnabled
                      ? ` · ${lockedWager.toLocaleString()} chips`
                      : ''}
                    {waitingSummaryText ? ` · ${waitingSummaryText}` : ''}
                  </span>
                </div>
                {waitingCount > 0 && (
                  <button
                    type="button"
                    onClick={onForceEndRound}
                    className="shrink-0 rounded-xl border border-white/[0.08] bg-[#1a1e28] px-3 py-1.5 text-xs font-medium text-[#e3b65c] hover:bg-[#222734] transition"
                  >
                    End round now
                  </button>
                )}
              </div>
            ) : (
              <>
                {bettingEnabled && (
                  <div className="rounded-xl border border-white/10 bg-[#11141c] px-3 py-2 space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5 font-semibold text-white">
                        <Coins className="h-3.5 w-3.5 text-[#a3a9b8]" />
                        <span>Wager</span>
                      </span>
                      <span className="font-mono text-xs font-medium text-[#e3b65c]">
                        {safeChips.toLocaleString()} chips
                      </span>
                    </div>

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
                        className="h-1.5 flex-1 cursor-pointer accent-[#ff7a2f] disabled:opacity-40"
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
                        className="w-16 rounded-lg border border-white/15 bg-[#0b0d14] px-2 py-0.5 text-right font-mono text-xs font-medium text-[#e3b65c] focus:border-[#ff7a2f] focus:outline-none"
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
                            className={`rounded-md border px-1 py-0.5 text-[11px] font-semibold transition ${
                              isActive
                                ? 'border-[#ff7a2f] bg-[#ff7a2f]/20 text-white'
                                : 'border-white/10 bg-[#0b0d14] text-[#8a91a3] hover:text-white'
                            } disabled:opacity-40`}
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
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#ff7a2f] px-4 py-3.5 text-[16px] font-medium text-[#1f0e03] hover:bg-[#ff8d4d] disabled:bg-[#1a1e28] disabled:text-[#8a91a3] disabled:shadow-none transition"
                >
                  <MapPin className="h-4 w-4" />
                  <span>
                    {submitting
                      ? 'Submitting…'
                      : selectedCoords
                        ? bettingEnabled
                          ? `Guess · Wager ${clampedWager.toLocaleString()}`
                          : 'Guess'
                        : 'Click map to place pin'}
                  </span>
                  {selectedCoords && !submitting && (
                    <span className="ml-1 rounded border border-black/25 px-1.5 py-0.5 text-[11px] font-semibold opacity-75">
                      Space
                    </span>
                  )}
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
