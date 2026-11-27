import { useState } from 'react';
import { ChevronDown, ChevronUp, Coins, Globe2, Play, Users, X } from 'lucide-react';
import type {
  AgyRunnerStatus,
  GameMode,
  HealthInfo,
  LocationMode,
  PanoramaProviderChoice,
} from '@geoguessr-mcp/shared';
import type { StartMatchPayload } from '../lib/api';
import { FALLBACK_AGY_MODELS, getModelUiMeta, LOCATION_META } from '../lib/uiHelpers';

interface LobbyModalProps {
  initialMode: GameMode;
  initialLocationMode?: LocationMode;
  initialBettingEnabled?: boolean;
  initialRounds: number;
  initialDuration: number | null;
  initialProvider: PanoramaProviderChoice;
  initialHumanName: string;
  agyRunner?: AgyRunnerStatus;
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
  agyRunner,
  health,
  starting,
  onStart,
  onClose,
}: LobbyModalProps) {
  const [humanName, setHumanName] = useState(
    initialHumanName && initialHumanName !== 'You (Player)'
      ? initialHumanName
      : 'You'
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
  const [maxStepsPerRound, setMaxStepsPerRound] = useState<number>(
    agyRunner?.maxStepsPerRound ?? 5
  );
  const [selectedModels, setSelectedModels] = useState<string[]>(
    agyRunner?.selectedModels && agyRunner.selectedModels.length > 0
      ? agyRunner.selectedModels
      : ['gemini-4-hydrogen-medium', 'claude-sonnet-5-5-medium']
  );
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const availableModels =
    agyRunner?.availableModels && agyRunner.availableModels.length > 0
      ? agyRunner.availableModels
      : FALLBACK_AGY_MODELS;

  const allowsAi =
    mode === '1v1' ||
    mode === 'ffa' ||
    mode === 'pvp_ai' ||
    mode === 'spectator';

  const toggleModel = (modelId: string) => {
    setSelectedModels((prev) => {
      if (mode === '1v1') return [modelId];
      if (prev.includes(modelId)) {
        return prev.length > 1 ? prev.filter((id) => id !== modelId) : prev;
      }
      return [...prev, modelId];
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0b1020]/80 p-4 backdrop-blur-md">
      <div className="flex max-h-[90dvh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#121a2e] text-[#eef1f8] shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <Globe2 className="h-5 w-5 text-[#22c55e]" />
            <h2 className="text-base font-bold">Change settings</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-[#8d97ae] hover:bg-[#18223a] hover:text-white transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar space-y-4 p-5 text-sm">
          <div>
            <label className="mb-1.5 block font-semibold text-[#eef1f8]">
              Your name
            </label>
            <input
              type="text"
              value={humanName}
              onChange={(e) => setHumanName(e.target.value)}
              maxLength={40}
              className="w-full rounded-xl border border-white/15 bg-[#0b1020] px-3.5 py-2.5 text-sm text-white focus:border-[#22c55e] focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1.5 block font-semibold text-[#eef1f8]">
              Game mode
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {(
                [
                  { id: 'ffa', label: 'vs All AI', desc: 'Multiple models' },
                  { id: '1v1', label: '1 vs 1 AI', desc: 'Single model' },
                  { id: 'pvp_ai', label: 'Friends + AI', desc: 'Room + AI' },
                  { id: 'pvp', label: 'Friends only', desc: 'Room' },
                  { id: 'solo', label: 'Solo', desc: 'Practice' },
                  { id: 'spectator', label: 'Watch AIs', desc: 'AI only' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setMode(opt.id)}
                  className={`rounded-xl border p-2.5 text-left transition ${
                    mode === opt.id
                      ? 'border-[#22c55e] bg-[#22c55e]/10 text-white'
                      : 'border-white/10 bg-[#0b1020]/60 text-[#8d97ae] hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-bold text-xs">
                    <Users className="h-3.5 w-3.5 text-[#22c55e]" />
                    <span>{opt.label}</span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-[#8d97ae]">
                    {opt.desc}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {allowsAi && (
            <div>
              <label className="mb-1.5 block font-semibold text-[#eef1f8]">
                AI opponents
              </label>
              <div className="flex flex-wrap gap-2">
                {availableModels.map((m) => {
                  const meta = getModelUiMeta(m.id, m.family, m.label);
                  const active = (
                    mode === '1v1' ? selectedModels.slice(0, 1) : selectedModels
                  ).includes(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => toggleModel(m.id)}
                      className={`inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
                        active
                          ? 'border-[#22c55e] bg-[#22c55e]/10 text-white'
                          : 'border-white/10 bg-[#0b1020] text-[#8d97ae] hover:text-white'
                      }`}
                    >
                      <span
                        style={{ backgroundColor: meta.color }}
                        className="grid h-5 w-5 place-items-center rounded-full text-[10px] font-extrabold text-[#0b1020]"
                      >
                        {meta.badge}
                      </span>
                      <span>{meta.shortName}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block font-semibold text-[#eef1f8]">
                Map
              </label>
              <select
                value={locationMode}
                onChange={(e) =>
                  setLocationMode(e.target.value as LocationMode)
                }
                className="w-full rounded-xl border border-white/15 bg-[#0b1020] px-3 py-2.5 text-sm text-white focus:border-[#22c55e] focus:outline-none"
              >
                <option value="standard">
                  {LOCATION_META.standard.emoji} Whole world
                </option>
                <option value="big_cities">
                  {LOCATION_META.big_cities.emoji} Big cities
                </option>
                <option value="mountain_regions">
                  {LOCATION_META.mountain_regions.emoji} Mountains
                </option>
              </select>
            </div>

            <div>
              <label className="mb-1.5 block font-semibold text-[#eef1f8]">
                Betting
              </label>
              <button
                type="button"
                onClick={() => setBettingEnabled((v) => !v)}
                className={`flex w-full items-center justify-between rounded-xl border px-3.5 py-2.5 text-sm font-bold transition ${
                  bettingEnabled
                    ? 'border-[#22c55e] bg-[#22c55e]/10 text-white'
                    : 'border-white/15 bg-[#0b1020] text-[#8d97ae]'
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <Coins className="h-4 w-4 text-[#fbbf24]" />
                  <span>{bettingEnabled ? 'Betting ON' : 'Betting OFF'}</span>
                </span>
                <span className="text-xs text-[#8d97ae]">1,000</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block font-semibold text-[#eef1f8]">
                Rounds
              </label>
              <div className="flex gap-1.5">
                {[3, 5, 10].map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setTotalRounds(r)}
                    className={`flex-1 rounded-xl border py-2 text-sm font-bold transition ${
                      totalRounds === r
                        ? 'border-[#22c55e] bg-[#22c55e]/10 text-white'
                        : 'border-white/10 bg-[#0b1020] text-[#8d97ae] hover:text-white'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-1.5 block font-semibold text-[#eef1f8]">
                Time per round
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
                className="w-full rounded-xl border border-white/15 bg-[#0b1020] px-3 py-2.5 text-sm text-white focus:border-[#22c55e] focus:outline-none"
              >
                <option value="none">No limit</option>
                <option value="30">30s</option>
                <option value="60">1 min</option>
                <option value="120">2 min</option>
                <option value="180">3 min</option>
              </select>
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-[#0b1020]/50 overflow-hidden">
            <button
              type="button"
              onClick={() => setAdvancedOpen((v) => !v)}
              className="flex w-full items-center justify-between px-4 py-2.5 text-xs font-semibold text-[#8d97ae] hover:text-white"
            >
              <span>⚙ Advanced — image source, AI move limit</span>
              {advancedOpen ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </button>
            {advancedOpen && (
              <div className="border-t border-white/10 p-3.5 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-[#8d97ae]">
                    Image source
                  </label>
                  <select
                    value={provider}
                    onChange={(e) =>
                      setProvider(e.target.value as PanoramaProviderChoice)
                    }
                    className="w-full rounded-xl border border-white/15 bg-[#0b1020] px-3 py-2 text-xs text-white focus:border-[#22c55e] focus:outline-none"
                  >
                    <option value="auto">Auto (Best available)</option>
                    <option value="open">Open 360° Procedural</option>
                    <option value="wikimedia">Wikimedia Commons 360°</option>
                    <option value="mapillary">
                      Mapillary 360°{' '}
                      {health?.configuredProviders.mapillary
                        ? '(Configured)'
                        : '(Needs token)'}
                    </option>
                    <option value="google">
                      Google Street View{' '}
                      {health?.configuredProviders.google
                        ? '(Configured)'
                        : '(Needs API key)'}
                    </option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-[#8d97ae]">
                    AI move limit
                  </label>
                  <select
                    value={String(maxStepsPerRound)}
                    onChange={(e) =>
                      setMaxStepsPerRound(Number(e.target.value))
                    }
                    className="w-full rounded-xl border border-white/15 bg-[#0b1020] px-3 py-2 text-xs text-white focus:border-[#22c55e] focus:outline-none"
                  >
                    <option value="3">3 moves</option>
                    <option value="5">5 moves</option>
                    <option value="8">8 moves</option>
                    <option value="12">12 moves</option>
                  </select>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2.5 border-t border-white/10 bg-[#0b1020]/60 px-5 py-3.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold text-[#8d97ae] hover:text-white transition"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={starting}
            onClick={() => {
              const finalModels = allowsAi
                ? mode === '1v1'
                  ? selectedModels.slice(0, 1)
                  : selectedModels
                : [];
              onStart({
                mode,
                locationMode,
                bettingEnabled,
                totalRounds,
                roundDurationSec,
                provider,
                humanName: humanName.trim() || 'You',
                maxStepsPerRound,
                selectedModels: finalModels,
                autoPlayEnabled: allowsAi && finalModels.length > 0,
              });
            }}
            className="flex items-center gap-2 rounded-xl bg-[#22c55e] px-5 py-2 text-sm font-bold text-[#052e14] shadow-[0_8px_24px_rgba(34,197,94,0.25)] hover:bg-[#34d369] disabled:opacity-60 transition"
          >
            <Play className="h-3.5 w-3.5 fill-current" />
            <span>{starting ? 'Starting…' : 'Start new match'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
