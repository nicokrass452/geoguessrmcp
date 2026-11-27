import { useEffect, useRef, useState } from 'react';
import { Check, Home, Link2, Menu, Settings, Terminal, WifiOff } from 'lucide-react';
import type { PublicGameState } from '@geoguessr-mcp/shared';
import {
  buildRoomInviteUrl,
  copyTextToClipboard,
} from '../lib/playerSession';

export interface TopHudProps {
  state: PublicGameState;
  wsConnected: boolean;
  onOpenSettings: () => void;
  onOpenDeveloper?: () => void;
  onReturnHome: () => void;
}

function formatTime(sec: number | null): string {
  if (sec === null) return 'No limit';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function TopHud({
  state,
  wsConnected,
  onOpenSettings,
  onOpenDeveloper,
  onReturnHome,
}: TopHudProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [copiedInvite, setCopiedInvite] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', onPointerDown);
    return () => window.removeEventListener('mousedown', onPointerDown);
  }, [menuOpen]);

  const timerUrgent =
    state.timeRemainingSec !== null && state.timeRemainingSec <= 15;
  const timerWarn =
    state.timeRemainingSec !== null &&
    state.timeRemainingSec <= 30 &&
    !timerUrgent;

  const isMultiHuman =
    state.mode === 'pvp' ||
    state.mode === 'pvp_ai' ||
    (state.humans && state.humans.length > 1);

  return (
    <header className="pointer-events-none absolute top-4 left-4 right-4 z-30 flex items-start justify-between gap-2">
      {/* Left: Menu button + Reconnecting indicator (only if disconnected) */}
      <div ref={menuRef} className="pointer-events-auto relative flex items-center gap-2">
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className="geo-glass inline-flex items-center gap-2 px-3.5 py-2.5 text-[14px] font-semibold text-[#eef0f5] hover:border-white/25 transition"
        >
          <Menu className="h-4 w-4 text-[#8a91a3]" />
          <span>Menu</span>
        </button>

        {!wsConnected && (
          <div className="geo-glass inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-[#f2777b] border-[#e5484d]/30">
            <WifiOff className="h-3.5 w-3.5" />
            <span>Reconnecting…</span>
          </div>
        )}

        {menuOpen && (
          <div className="absolute top-12 left-0 w-56 rounded-2xl border border-white/15 bg-[#11141c]/95 p-1.5 shadow-2xl backdrop-blur-md">
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                onOpenSettings();
              }}
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-[#eef0f5] hover:bg-white/10 transition"
            >
              <Settings className="h-4 w-4 text-[#8a91a3]" />
              <span>Change settings</span>
            </button>
            {onOpenDeveloper && (
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onOpenDeveloper();
                }}
                className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-[#eef0f5] hover:bg-white/10 transition"
              >
                <Terminal className="h-4 w-4 text-[#8a91a3]" />
                <span>Developer &amp; MCP</span>
              </button>
            )}
            <div className="my-1 h-px bg-white/10" />
            <button
              type="button"
              data-testid="quick-return-home"
              onClick={() => {
                setMenuOpen(false);
                onReturnHome();
              }}
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-[#f2777b] hover:bg-[#e5484d]/10 transition"
            >
              <Home className="h-4 w-4" />
              <span>Leave game</span>
            </button>
          </div>
        )}
      </div>

      {/* Center: Clean 3-Stat Bar (Round, Time, Score [+ Chips if betting]) */}
      <div className="pointer-events-auto geo-glass flex items-stretch overflow-hidden">
        <div className="px-4 sm:px-5 py-2 text-center border-r border-white/10">
          <small className="block text-[12px] text-[#8a91a3]">
            Round
          </small>
          <b className="text-[18px] sm:text-[22px] font-semibold text-white leading-tight">
            {state.currentRoundNumber} / {state.totalRounds}
          </b>
        </div>

        <div
          className={`px-4 sm:px-5 py-2 text-center ${
            state.mode !== 'spectator' || state.bettingEnabled
              ? 'border-r border-white/10'
              : ''
          }`}
        >
          <small className="block text-[12px] text-[#8a91a3]">
            Time
          </small>
          <b
            className={`text-[18px] sm:text-[22px] font-semibold leading-tight font-mono ${
              timerUrgent
                ? 'text-[#e5484d]'
                : timerWarn
                  ? 'text-[#e3b65c]'
                  : state.timeRemainingSec !== null
                    ? 'text-[#e3b65c]'
                    : 'text-white'
            }`}
          >
            {formatTime(state.timeRemainingSec)}
          </b>
        </div>

        {state.mode !== 'spectator' && (
          <div
            className={`px-4 sm:px-5 py-2 text-center ${
              state.bettingEnabled ? 'border-r border-white/10' : ''
            }`}
          >
            <small className="block text-[12px] text-[#8a91a3]">
              Score
            </small>
            <b className="text-[18px] sm:text-[22px] font-semibold text-white leading-tight">
              {state.human.totalScore.toLocaleString()}
            </b>
          </div>
        )}

        {state.bettingEnabled && state.mode !== 'spectator' && (
          <div
            data-testid="top-hud-chips"
            className="px-4 sm:px-5 py-2 text-center"
          >
            <small className="block text-[12px] text-[#8a91a3]">
              Chips
            </small>
            <b className="text-[18px] sm:text-[22px] font-semibold text-[#e3b65c] leading-tight">
              {state.human.chips.toLocaleString()}
            </b>
          </div>
        )}
      </div>

      {/* Right: Room Code & Invite Link Pill (multiplayer only) */}
      <div className="pointer-events-auto flex items-center justify-end min-w-[84px]">
        {isMultiHuman && state.roomCode && (
          <button
            type="button"
            data-testid="room-code"
            aria-label={`Room Code ${state.roomCode}`}
            title="Copy invite link"
            onClick={() => {
              const link = buildRoomInviteUrl(state.roomCode || '');
              void copyTextToClipboard(link).then((ok) => {
                if (!ok) return;
                setCopiedInvite(true);
                if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
                copyTimerRef.current = setTimeout(
                  () => setCopiedInvite(false),
                  1800
                );
              });
            }}
            className="geo-glass inline-flex items-center gap-2 px-3.5 py-2.5 text-[14px] text-[#eef0f5] hover:border-white/25 transition"
          >
            <span className="text-[#8a91a3]">Room</span>
            <b className="font-mono font-medium text-white">{state.roomCode}</b>
            <span className="text-[#8a91a3]">·</span>
            {copiedInvite ? (
              <Check className="h-4 w-4 text-[#ff7a2f]" />
            ) : (
              <Link2 className="h-4 w-4 text-[#8a91a3]" />
            )}
          </button>
        )}
      </div>
    </header>
  );
}
