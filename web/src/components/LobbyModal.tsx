import { useState } from 'react';
import { Coins, Globe2, Play, Users, X } from 'lucide-react';
import type {
  GameMode,
  HealthInfo,
  LocationMode,
  PanoramaProviderChoice,
} from '@geoguessr-mcp/shared';
import type { StartMatchPayload } from '../lib/api';

interface LobbyModalProps {
  initialMode: GameMode;
  initialLocationMode?: LocationMode;
  initialBettingEnabled?: boolean;
  initialRounds: number;
  initialDuration: number | null;
  initialProvider: PanoramaProviderChoice;
  initialHumanName: string;
  health: HealthInfo | null;
  starting: boolean;
  onStart: (opts: StartMatchPayload) => void;
  onClose: () => void;
}

export function LobbyModal({
  initialMode,
  initialLocationMode = 'standard',
  initialBettingEnabled = false,
  initialRounds,
  initialDuration,
  initialProvider,
  initialHumanName,
  health,
  starting,
  onStart,
  onClose,
}: LobbyModalProps) {
  const [humanName, setHumanName] = useState(
    initialHumanName || 'You (Player)'
  );
  const [mode, setMode] = useState<GameMode>(initialMode);
  const [locationMode, setLocationMode] =
    useState<LocationMode>(initialLocationMode);
  const [bettingEnabled, setBettingEnabled] = useState<boolean>(
    initialBettingEnabled
  );
  const [totalRounds, setTotalRounds] = useState<number>(initialRounds);
  const [roundDurationSec, setRoundDurationSec] = useState<number | null>(
    initialDuration
  );
  const [provider, setProvider] =
    useState<PanoramaProviderChoice>(initialProvider);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-md">
      <div className="flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-white/15 bg-slate-900 shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <Globe2 className="h-5 w-5 text-sky-400" />
            <h2 className="text-base font-bold text-slate-100">Match Setup</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar space-y-4 p-5 text-xs">
          <div>
            <label className="mb-1.5 block font-semibold text-slate-300">
              Your Display Name
            </label>
            <input
              type="text"
              value={humanName}
              onChange={(e) => setHumanName(e.target.value)}
              maxLength={40}
              className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-sky-400 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1.5 block font-semibold text-slate-300">
              Game Mode
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {(
                [
                  { id: 'ffa', label: 'Free-For-All', desc: 'Multi-MCP AI' },
                  { id: '1v1', label: '1v1 Duel', desc: 'Single AI' },
                  { id: 'pvp_ai', label: 'PvPvAI', desc: 'Humans + AI' },
                  { id: 'pvp', label: 'PvP', desc: 'Humans Only' },
                  { id: 'solo', label: 'Solo', desc: 'Practice' },
                  { id: 'spectator', label: 'Spectator', desc: 'AI Only' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setMode(opt.id)}
                  className={`rounded-xl border p-2 text-left transition ${
                    mode === opt.id
                      ? 'border-sky-400 bg-sky-500/20 text-slate-100'
                      : 'border-white/10 bg-slate-950/60 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-bold">
                    <Users className="h-3.5 w-3.5 text-sky-400" />
                    <span>{opt.label}</span>
                  </div>
                  <div className="mt-0.5 text-[10px] text-slate-400">
                    {opt.desc}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block font-semibold text-slate-300">
                Location Gamemode
              </label>
              <select
                value={locationMode}
                onChange={(e) =>
                  setLocationMode(e.target.value as LocationMode)
                }
                className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-xs text-slate-100 focus:border-sky-400 focus:outline-none"
              >
                <option value="standard">Standard (All regions)</option>
                <option value="big_cities">Big Cities Only</option>
                <option value="mountain_regions">Mountain Regions Only</option>
              </select>
            </div>

            <div>
              <label className="mb-1.5 block font-semibold text-slate-300">
                Confidence Betting
              </label>
              <button
                type="button"
                onClick={() => setBettingEnabled((v) => !v)}
                className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 font-bold transition ${
                  bettingEnabled
                    ? 'border-amber-400 bg-amber-500/20 text-amber-200'
                    : 'border-white/10 bg-slate-950 text-slate-400'
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <Coins className="h-3.5 w-3.5 text-amber-400" />
                  <span>{bettingEnabled ? 'Betting ON' : 'Betting OFF'}</span>
                </span>
                <span>1,000</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block font-semibold text-slate-300">
                Rounds
              </label>
              <div className="flex gap-1.5">
                {[3, 5, 10].map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setTotalRounds(r)}
                    className={`flex-1 rounded-xl border py-2 font-bold transition ${
                      totalRounds === r
                        ? 'border-sky-400 bg-sky-500/20 text-slate-100'
                        : 'border-white/10 bg-slate-950/60 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-1.5 block font-semibold text-slate-300">
                Round Timer
              </label>
              <select
                value={
                  roundDurationSec === null ? 'none' : String(roundDurationSec)
                }
                onChange={(e) =>
                  setRoundDurationSec(
                    e.target.value === 'none' ? null : Number(e.target.value)
                  )
                }
                className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-xs text-slate-100 focus:border-sky-400 focus:outline-none"
              >
                <option value="none">No Time Limit</option>
                <option value="10">10 seconds</option>
                <option value="60">60 seconds</option>
                <option value="120">2 minutes</option>
                <option value="180">3 minutes</option>
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block font-semibold text-slate-300">
              Street Panorama Provider
            </label>
            <select
              value={provider}
              onChange={(e) =>
                setProvider(e.target.value as PanoramaProviderChoice)
              }
              className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-xs text-slate-100 focus:border-sky-400 focus:outline-none"
            >
              <option value="auto">Auto (Best Configured)</option>
              <option value="open">
                Open 360° Procedural (Out-of-the-Box)
              </option>
              <option value="wikimedia">
                Wikimedia Commons 360° (with fallback)
              </option>
              <option value="mapillary">
                MapillaryJS{' '}
                {health?.configuredProviders.mapillary
                  ? '(Token Configured)'
                  : '(Requires MAPILLARY_ACCESS_TOKEN)'}
              </option>
              <option value="google">
                Google Street View{' '}
                {health?.configuredProviders.google
                  ? '(Key Configured)'
                  : '(Requires GOOGLE_MAPS_API_KEY)'}
              </option>
            </select>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-white/10 bg-slate-950/60 px-5 py-3.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-white/10 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={starting}
            onClick={() =>
              onStart({
                mode,
                locationMode,
                bettingEnabled,
                totalRounds,
                roundDurationSec,
                provider,
                humanName: humanName.trim() || 'You (Player)',
              })
            }
            className="flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-400 disabled:opacity-60 transition"
          >
            <Play className="h-3.5 w-3.5 fill-current" />
            <span>{starting ? 'Starting...' : 'Start New Match'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
