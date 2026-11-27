import { useState } from 'react';
import { Check, Copy, Settings, Terminal, X } from 'lucide-react';
import type {
  AgyRunnerStatus,
  HealthInfo,
  McpStatusInfo,
  PanoramaProviderChoice,
} from '@geoguessr-mcp/shared';
import { copyTextToClipboard } from '../lib/playerSession';
import { MCP_SNIPPET_HTTP, MCP_SNIPPET_STDIO } from '../lib/uiHelpers';

export interface SettingsModalProps {
  initialTab?: 'general' | 'developer';
  humanName: string;
  provider: PanoramaProviderChoice;
  maxStepsPerRound: number;
  timeoutSec: number;
  health: HealthInfo | null;
  mcpStatus?: McpStatusInfo;
  agyRunner?: AgyRunnerStatus;
  onSaveGeneral: (patch: {
    humanName: string;
    provider: PanoramaProviderChoice;
    maxStepsPerRound: number;
    timeoutSec: number;
  }) => void;
  onClose: () => void;
}

export function SettingsModal({
  initialTab = 'general',
  humanName,
  provider,
  maxStepsPerRound,
  timeoutSec,
  health,
  mcpStatus,
  agyRunner,
  onSaveGeneral,
  onClose,
}: SettingsModalProps) {
  const [tab, setTab] = useState<'general' | 'developer'>(initialTab);
  const [draftName, setDraftName] = useState(humanName);
  const [draftProvider, setDraftProvider] =
    useState<PanoramaProviderChoice>(provider);
  const [draftSteps, setDraftSteps] = useState(maxStepsPerRound);
  const [draftTimeout, setDraftTimeout] = useState(timeoutSec);
  const [copiedStdio, setCopiedStdio] = useState(false);

  const handleCopyStdio = async () => {
    const ok = await copyTextToClipboard(MCP_SNIPPET_STDIO);
    if (!ok) return;
    setCopiedStdio(true);
    setTimeout(() => setCopiedStdio(false), 1800);
  };

  const mcpLabel =
    mcpStatus?.status === 'connected'
      ? `Connected (${mcpStatus.activeMcpAgents} external agent${mcpStatus.activeMcpAgents === 1 ? '' : 's'})`
      : mcpStatus?.status === 'bridge_ready'
        ? 'HTTP bridge ready'
        : 'Offline';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0b0d14]/80 p-4 backdrop-blur-md">
      <div className="flex max-h-[90dvh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#11141c] text-[#eef0f5] shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <Settings className="h-5 w-5 text-[#ff7a2f]" />
            <h2 className="text-base font-medium">Settings</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="rounded-lg p-1.5 text-[#8a91a3] hover:bg-[#1a1e28] hover:text-white transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Segmented tabs */}
        <div className="border-b border-white/10 px-5 pt-3 pb-3">
          <div className="inline-flex rounded-xl border border-white/10 bg-[#0b0d14] p-1 gap-1">
            <button
              type="button"
              onClick={() => setTab('general')}
              className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition ${
                tab === 'general'
                  ? 'bg-[#1a1e28] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)]'
                  : 'text-[#8a91a3] hover:text-white'
              }`}
            >
              General
            </button>
            <button
              type="button"
              onClick={() => setTab('developer')}
              className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition ${
                tab === 'developer'
                  ? 'bg-[#1a1e28] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)]'
                  : 'text-[#8a91a3] hover:text-white'
              }`}
            >
              Developer &amp; MCP
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-4">
          {tab === 'general' ? (
            <>
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-[#eef0f5]">
                  Your display name
                </label>
                <input
                  type="text"
                  maxLength={40}
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  className="w-full rounded-xl border border-white/15 bg-[#0b0d14] px-3.5 py-2.5 text-sm text-[#eef0f5] focus:border-[#ff7a2f] focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-semibold text-[#eef0f5]">
                  Default street image source
                </label>
                <select
                  value={draftProvider}
                  onChange={(e) =>
                    setDraftProvider(e.target.value as PanoramaProviderChoice)
                  }
                  className="w-full rounded-xl border border-white/15 bg-[#0b0d14] px-3.5 py-2.5 text-sm text-[#eef0f5] focus:border-[#ff7a2f] focus:outline-none"
                >
                  <option value="auto">Auto (best available)</option>
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

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="mb-1.5 block text-sm font-semibold text-[#eef0f5]">
                    AI move limit per round
                  </label>
                  <select
                    value={String(draftSteps)}
                    onChange={(e) => setDraftSteps(Number(e.target.value))}
                    className="w-full rounded-xl border border-white/15 bg-[#0b0d14] px-3.5 py-2.5 text-sm text-[#eef0f5] focus:border-[#ff7a2f] focus:outline-none"
                  >
                    <option value="3">3 moves</option>
                    <option value="5">5 moves</option>
                    <option value="8">8 moves</option>
                    <option value="12">12 moves</option>
                    <option value="15">15 moves</option>
                    <option value="20">20 moves</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-semibold text-[#eef0f5]">
                    AI turn timeout
                  </label>
                  <select
                    value={String(draftTimeout)}
                    onChange={(e) => setDraftTimeout(Number(e.target.value))}
                    className="w-full rounded-xl border border-white/15 bg-[#0b0d14] px-3.5 py-2.5 text-sm text-[#eef0f5] focus:border-[#ff7a2f] focus:outline-none"
                  >
                    <option value="60">60 seconds</option>
                    <option value="120">120 seconds</option>
                    <option value="180">180 seconds</option>
                    <option value="240">240 seconds</option>
                  </select>
                </div>
              </div>
            </>
          ) : (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-xl border border-white/10 bg-[#0b0d14] p-3.5">
                  <div className="text-xs font-medium text-[#8a91a3]">
                    Built-in AI Runner
                  </div>
                  <div className="mt-1 font-semibold text-white">
                    {agyRunner?.available
                      ? 'Ready (agy CLI found)'
                      : 'Unavailable (set AGY_BIN)'}
                  </div>
                </div>
                <div className="rounded-xl border border-white/10 bg-[#0b0d14] p-3.5">
                  <div className="text-xs font-medium text-[#8a91a3]">
                    External MCP Bridge
                  </div>
                  <div className="mt-1 font-semibold text-white">{mcpLabel}</div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-medium text-[#8a91a3]">
                  <Terminal className="h-3.5 w-3.5 text-[#ff7a2f]" />
                  <span>Connect your own MCP agent</span>
                </div>
                <p className="text-xs text-[#8a91a3] leading-relaxed">
                  Add this configuration to Antigravity (
                  <code className="text-[#eef0f5]">~/.gemini/config/mcp_config.json</code>),
                  Claude Desktop, or Cursor — or start{' '}
                  <code className="text-[#eef0f5]">npm run mcp:http</code> for
                  Streamable HTTP &amp; SSE.
                </p>
                <div className="relative">
                  <pre className="overflow-x-auto rounded-xl border border-white/10 bg-[#0b0d14] p-3 font-mono text-xs text-[#a3a9b8]">
                    {MCP_SNIPPET_STDIO}
                  </pre>
                  <button
                    type="button"
                    onClick={handleCopyStdio}
                    className="absolute top-2.5 right-2.5 flex items-center gap-1 rounded-lg border border-white/15 bg-[#1a1e28] px-2.5 py-1 text-xs font-semibold text-[#eef0f5] hover:bg-[#223050] transition"
                  >
                    {copiedStdio ? (
                      <>
                        <Check className="h-3 w-3 text-[#ff7a2f]" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                </div>
                <pre className="overflow-x-auto rounded-xl border border-white/10 bg-[#0b0d14] p-3 font-mono text-xs text-[#a3a9b8]">
                  {MCP_SNIPPET_HTTP}
                </pre>
              </div>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2.5 border-t border-white/10 bg-[#0b0d14]/60 px-5 py-3.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-white/15 bg-transparent px-4 py-2 text-sm font-semibold text-[#8a91a3] hover:text-white transition"
          >
            {tab === 'developer' ? 'Close' : 'Cancel'}
          </button>
          {tab === 'general' && (
            <button
              type="button"
              onClick={() => {
                onSaveGeneral({
                  humanName: draftName.trim() || 'You',
                  provider: draftProvider,
                  maxStepsPerRound: draftSteps,
                  timeoutSec: draftTimeout,
                });
                onClose();
              }}
              className="rounded-xl bg-[#ff7a2f] px-5 py-2 text-sm font-medium text-[#1f0e03] hover:bg-[#ff8d4d] transition"
            >
              Save settings
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
