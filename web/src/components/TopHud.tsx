import { useEffect, useRef, useState } from 'react';
import {
  Check,
  Clock,
  Coins,
  Globe2,
  Home,
  Link2,
  Radio,
  Settings2,
  Trophy,
  User,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type { PublicGameState } from '@geoguessr-mcp/shared';
import {
  buildRoomInviteUrl,
  copyTextToClipboard,
} from '../lib/playerSession';

export interface TopHudProps {
  state: PublicGameState;
  wsConnected: boolean;
  onOpenSettings: () => void;
  onReturnHome: () => void;
}

function formatTime(sec: number | null): string {
  if (sec === null) return 'No Limit';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function TopHud({
  state,
  wsConnected,
  onOpenSettings,
  onReturnHome,
}: TopHudProps) {
  const [copiedInvite, setCopiedInvite] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);
  const timerUrgent =
    state.timeRemainingSec !== null && state.timeRemainingSec <= 15;
  const timerWarn =
    state.timeRemainingSec !== null &&
    state.timeRemainingSec <= 30 &&
    !timerUrgent;

  const mcpStatus = state.mcpStatus;
  const mcpBadge =
    mcpStatus?.status === 'connected'
      ? {
          label: `MCP Connected${mcpStatus.activeMcpAgents > 0 ? ` (${mcpStatus.activeMcpAgents})` : ''}`,
          cls: 'border-emerald-400/40 bg-emerald-500/20 text-emerald-300',
        }
      : mcpStatus?.status === 'bridge_ready'
        ? {
            label: 'MCP Bridge Ready',
            cls: 'border-sky-400/40 bg-sky-500/20 text-sky-300',
          }
        : {
            label: 'MCP Offline',
            cls: 'border-slate-700 bg-slate-900/90 text-slate-400',
          };

  const isMultiHuman =
    state.mode === 'pvp' ||
    state.mode === 'pvp_ai' ||
    (state.humans && state.humans.length > 1);

  return (
    <header className="pointer-events-none absolute top-3 left-3 right-3 z-30 flex flex-wrap items-center justify-between gap-2">
      {/* Left Brand + Quick Return Home + Mode + Live MCP Badge */}
      <div className="pointer-events-auto flex flex-wrap items-center gap-2.5 rounded-2xl border border-white/15 bg-slate-950/85 px-3 py-2 backdrop-blur-md shadow-xl">
        <button
          type="button"
          data-testid="quick-return-home"
          aria-label="Quick Return to Home"
          title="Quick Return to Home"
          onClick={onReturnHome}
          className="flex items-center gap-1.5 rounded-xl border border-white/15 bg-slate-900 px-2.5 py-1.5 text-xs font-bold text-slate-100 hover:bg-slate-800 hover:border-sky-400/40 transition"
        >
          <Home className="h-3.5 w-3.5 text-sky-400" />
          <span>Home</span>
        </button>

        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-sky-400 to-emerald-400 text-slate-950 shadow-md">
          <Globe2 className="h-4 w-4 stroke-[2.5]" />
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-bold tracking-tight text-slate-100">
              GeoGuessr MCP
            </span>
            <span className="rounded-md bg-sky-500/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-sky-300 border border-sky-400/30">
              {state.mode}
            </span>
            {state.locationMode !== 'standard' && (
              <span className="rounded-md bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-300 border border-emerald-400/30">
                {state.locationMode === 'big_cities'
                  ? 'Big Cities'
                  : 'Mountains'}
              </span>
            )}
            {isMultiHuman && state.roomCode && (
              <button
                type="button"
                data-testid="room-code"
                aria-label={`Room Code ${state.roomCode}`}
                title="Click to copy auto-join invite link"
                onClick={() => {
                  const link = buildRoomInviteUrl(state.roomCode || '');
                  void copyTextToClipboard(link).then((ok) => {
                    if (!ok) return;
                    setCopiedInvite(true);
                    if (copyTimerRef.current) {
                      clearTimeout(copyTimerRef.current);
                    }
                    copyTimerRef.current = setTimeout(
                      () => setCopiedInvite(false),
                      1800
                    );
                  });
                }}
                className="flex items-center gap-1 rounded-md border border-violet-400/40 bg-violet-500/20 px-1.5 py-0.5 font-mono text-[10px] font-bold text-violet-200 hover:bg-violet-500/30 transition"
              >
                {copiedInvite ? (
                  <Check className="h-2.5 w-2.5 text-emerald-300" />
                ) : (
                  <Link2 className="h-2.5 w-2.5" />
                )}
                <span>Room {state.roomCode}</span>
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
            <span className="flex items-center gap-1 font-semibold text-slate-200">
              <User className="h-3 w-3 text-sky-400" />
              <span>{state.human.name}</span>
            </span>
            <span>•</span>
            <span>{state.activeLocationProvider}</span>
            <span>•</span>
            <span className="flex items-center gap-1">
              {wsConnected ? (
                <>
                  <Wifi className="h-3 w-3 text-emerald-400" />
                  <span className="text-emerald-400">Live Sync</span>
                </>
              ) : (
                <>
                  <WifiOff className="h-3 w-3 text-rose-400" />
                  <span className="text-rose-400">Reconnecting</span>
                </>
              )}
            </span>
          </div>
        </div>

        <div
          data-testid="live-mcp-badge"
          aria-label={`Live MCP status: ${mcpBadge.label}`}
          className={`flex items-center gap-1.5 rounded-xl border px-2.5 py-1 text-[11px] font-bold ${mcpBadge.cls}`}
        >
          <Radio className="h-3 w-3" />
          <span>{mcpBadge.label}</span>
        </div>
      </div>

      {/* Right Stats + Chips + Settings */}
      <div className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-2xl border border-white/15 bg-slate-950/85 px-3 py-1.5 backdrop-blur-md shadow-xl">
        <div className="flex items-center gap-1.5 px-2 text-xs">
          <span className="text-slate-400">Round</span>
          <span className="font-bold text-slate-100">
            {state.currentRoundNumber} / {state.totalRounds}
          </span>
        </div>

        <div className="h-4 w-px bg-white/10" />

        <div
          className={`flex items-center gap-1.5 px-2 text-xs font-mono font-semibold ${
            timerUrgent
              ? 'text-rose-400 animate-pulse'
              : timerWarn
                ? 'text-amber-300'
                : 'text-slate-200'
          }`}
        >
          <Clock className="h-3.5 w-3.5" />
          <span>{formatTime(state.timeRemainingSec)}</span>
        </div>

        <div className="h-4 w-px bg-white/10" />

        <div className="flex items-center gap-1.5 px-2 text-xs">
          <Trophy className="h-3.5 w-3.5 text-amber-400" />
          <span className="text-slate-400">Score</span>
          <span className="font-bold text-emerald-400">
            {state.human.totalScore.toLocaleString()}
          </span>
        </div>

        {state.bettingEnabled && state.mode !== 'spectator' && (
          <>
            <div className="h-4 w-px bg-white/10" />
            <div
              data-testid="top-hud-chips"
              className="flex items-center gap-1.5 rounded-xl border border-amber-400/30 bg-amber-500/15 px-2.5 py-1 text-xs font-bold text-amber-300"
            >
              <Coins className="h-3.5 w-3.5 text-amber-400" />
              <span>{state.human.chips.toLocaleString()} chips</span>
            </div>
          </>
        )}

        <button
          type="button"
          onClick={onOpenSettings}
          className="ml-1 flex items-center gap-1.5 rounded-xl border border-white/10 bg-slate-800/80 px-2.5 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 transition"
        >
          <Settings2 className="h-3.5 w-3.5 text-sky-400" />
          <span className="hidden sm:inline">Match Setup</span>
        </button>
      </div>
    </header>
  );
}
