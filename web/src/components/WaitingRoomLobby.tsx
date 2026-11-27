import { useEffect, useRef, useState } from 'react';
import { Check, Link2, Pencil, Play, Plus, X } from 'lucide-react';
import type { PublicGameState } from '@geoguessr-mcp/shared';
import { api } from '../lib/api';
import {
  buildRoomInviteUrl,
  copyTextToClipboard,
} from '../lib/playerSession';
import {
  FALLBACK_AGY_MODELS,
  formatDurationLabel,
  getModelUiMeta,
  getPlayerInitials,
  LOCATION_META,
} from '../lib/uiHelpers';

export interface WaitingRoomLobbyProps {
  state: PublicGameState;
  playerId: string;
  isHost: boolean;
  busyAction: boolean;
  onStartMatch: () => void;
  onLeaveRoom: () => void;
  onRenamePlayer: (nextName: string) => void;
  onOpenEditRules: () => void;
  onError?: (msg: string) => void;
}

export function WaitingRoomLobby({
  state,
  playerId,
  isHost,
  busyAction,
  onStartMatch,
  onLeaveRoom,
  onRenamePlayer,
  onOpenEditRules,
  onError,
}: WaitingRoomLobbyProps) {
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(state.human.name);
  const [showAddAi, setShowAddAi] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);

  const codeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const linkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setNameDraft(state.human.name);
  }, [state.human.name]);

  useEffect(() => {
    return () => {
      if (codeTimerRef.current) clearTimeout(codeTimerRef.current);
      if (linkTimerRef.current) clearTimeout(linkTimerRef.current);
    };
  }, []);

  const inviteUrl = state.roomCode ? buildRoomInviteUrl(state.roomCode) : '';
  const agyRunner = state.agyRunner;
  const availableModels =
    agyRunner?.availableModels && agyRunner.availableModels.length > 0
      ? agyRunner.availableModels
      : FALLBACK_AGY_MODELS;

  const configuredModelIds =
    state.mode === 'pvp'
      ? []
      : agyRunner?.selectedModels ?? [];

  const connectedExternalAgents = state.agents.filter(
    (a) => !a.managed && a.connected
  );

  // Merge configured managed AI models and live agents for display
  const aiRoster = [
    ...configuredModelIds.map((modelId) => {
      const opt = availableModels.find((m) => m.id === modelId);
      const meta = getModelUiMeta(modelId, opt?.family, opt?.label);
      return {
        key: `model:${modelId}`,
        modelId,
        name: meta.shortName,
        badge: meta.badge,
        color: meta.color,
        removable: true,
      };
    }),
    ...connectedExternalAgents.map((a) => ({
      key: `ext:${a.id}`,
      modelId: a.model || a.id,
      name: a.name,
      badge: getPlayerInitials(a.name),
      color: a.color,
      removable: false,
    })),
  ];

  const unselectedModels = availableModels.filter(
    (m) => !configuredModelIds.includes(m.id)
  );

  const totalPlayers = state.humans.length + aiRoster.length;

  const handleCopyCode = () => {
    if (!state.roomCode) return;
    void copyTextToClipboard(state.roomCode).then((ok) => {
      if (!ok) return;
      setCopiedCode(true);
      if (codeTimerRef.current) clearTimeout(codeTimerRef.current);
      codeTimerRef.current = setTimeout(() => setCopiedCode(false), 1800);
    });
  };

  const handleCopyInviteLink = () => {
    if (!inviteUrl) return;
    void copyTextToClipboard(inviteUrl).then((ok) => {
      if (!ok) return;
      setCopiedLink(true);
      if (linkTimerRef.current) clearTimeout(linkTimerRef.current);
      linkTimerRef.current = setTimeout(() => setCopiedLink(false), 1800);
    });
  };

  const handleAddAiModel = async (modelId: string) => {
    if (aiBusy) return;
    setAiBusy(true);
    try {
      const next = Array.from(new Set([...configuredModelIds, modelId]));
      await api.updateAgyConfig({
        selectedModels: next,
        autoPlayEnabled: true,
      });
      setShowAddAi(false);
    } catch (err) {
      onError?.(err instanceof Error ? err.message : String(err));
    } finally {
      setAiBusy(false);
    }
  };

  const handleRemoveAiModel = async (modelId: string) => {
    if (aiBusy) return;
    setAiBusy(true);
    try {
      const next = configuredModelIds.filter((id) => id !== modelId);
      await api.updateAgyConfig({
        selectedModels: next,
        autoPlayEnabled: next.length > 0,
      });
    } catch (err) {
      onError?.(err instanceof Error ? err.message : String(err));
    } finally {
      setAiBusy(false);
    }
  };

  const handleSaveName = () => {
    const clean = nameDraft.trim();
    if (clean && clean !== state.human.name) {
      onRenamePlayer(clean);
    }
    setEditingName(false);
  };

  return (
    <main className="geo-bg h-full w-full overflow-y-auto overflow-x-hidden page-scrollbar text-[#eef1f8]">
      {/* Top Nav */}
      <nav className="mx-auto flex max-w-[1200px] items-center justify-between px-5 py-5 sm:px-10">
        <div className="flex items-center gap-2.5 text-[18px] font-extrabold tracking-tight text-white">
          <span className="grid h-[34px] w-[34px] place-items-center rounded-[10px] bg-gradient-to-br from-[#22c55e] to-[#3b82f6] text-lg">
            🌍
          </span>
          <span>GeoArena</span>
        </div>

        <button
          type="button"
          data-testid="quick-return-home"
          onClick={onLeaveRoom}
          className="rounded-xl border border-white/15 bg-transparent px-3.5 py-2 text-[14px] font-semibold text-[#eef1f8] hover:bg-white/5 transition"
        >
          Leave room
        </button>
      </nav>

      <div className="mx-auto max-w-[980px] px-5 pt-2 pb-12 sm:px-12">
        <h1 className="text-[30px] font-extrabold tracking-[-0.02em] text-white">
          Waiting for players…
        </h1>
        <div className="mt-1 mb-5 text-[15px] text-[#8d97ae]">
          {LOCATION_META[state.locationMode].title} · {state.totalRounds} rounds
          · {formatDurationLabel(state.roundDurationSec)} per round
          {state.bettingEnabled ? ' · Betting on' : ''}
          {isHost && (
            <>
              {' · '}
              <button
                type="button"
                onClick={onOpenEditRules}
                className="underline text-[#eef1f8] hover:text-[#22c55e] transition"
              >
                Edit
              </button>
            </>
          )}
        </div>

        <div className="grid gap-[22px] md:grid-cols-2">
          {/* Left Invite Card */}
          <div className="geo-card p-7 text-center flex flex-col justify-center">
            <small className="text-[12px] font-bold uppercase tracking-[0.1em] text-[#8d97ae]">
              Room code
            </small>

            <button
              type="button"
              data-testid="room-code"
              aria-label={`Room Code ${state.roomCode}`}
              title="Click to copy room code"
              onClick={handleCopyCode}
              className="my-2 font-mono text-5xl sm:text-[64px] font-extrabold tracking-[0.18em] text-white hover:text-[#22c55e] transition select-all"
            >
              {state.roomCode}
            </button>
            {copiedCode && (
              <div className="mb-2 text-xs font-semibold text-[#22c55e]">
                Room code copied!
              </div>
            )}

            {inviteUrl && (
              <div className="mt-3 flex items-center gap-2 rounded-xl border border-white/15 bg-[#0b1020] p-1.5 pl-3.5">
                <span className="flex-1 truncate text-left font-mono text-[13px] text-[#8d97ae] select-all">
                  {inviteUrl.replace(/^https?:\/\//, '')}
                </span>
                <button
                  type="button"
                  data-testid="copy-invite-link"
                  onClick={handleCopyInviteLink}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-[10px] bg-[#22c55e] px-4 py-2.5 text-[14px] font-bold text-[#052e14] shadow-[0_8px_24px_rgba(34,197,94,0.25)] hover:bg-[#34d369] transition"
                >
                  {copiedLink ? (
                    <>
                      <Check className="h-4 w-4" />
                      <span>Copied!</span>
                    </>
                  ) : (
                    <>
                      <Link2 className="h-4 w-4" />
                      <span>Copy invite link</span>
                    </>
                  )}
                </button>
              </div>
            )}

            <p className="mt-3.5 text-[13px] text-[#8d97ae]">
              Friends who open the link join automatically.
            </p>
          </div>

          {/* Right Players Card */}
          <div className="geo-card p-6">
            <div className="text-[13px] font-bold uppercase tracking-[0.08em] text-[#8d97ae] mb-3">
              Players · {totalPlayers} / 8
            </div>

            <div className="divide-y divide-white/[0.08]">
              {state.humans.map((h) => {
                const isSelf = h.id === playerId;
                return (
                  <div
                    key={h.id}
                    className="flex items-center gap-3 py-3"
                  >
                    <div
                      style={{
                        backgroundColor: isSelf ? '#60a5fa' : h.color,
                      }}
                      className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-[13px] font-extrabold text-[#0b1020]"
                    >
                      {getPlayerInitials(h.name)}
                    </div>
                    <b className="flex-1 truncate text-[15px] font-bold text-white">
                      {h.name}
                    </b>
                    {isSelf && (
                      <span className="rounded-full bg-[#60a5fa]/15 px-2.5 py-0.5 text-[12px] font-bold text-[#60a5fa]">
                        You
                      </span>
                    )}
                    {h.isHost && (
                      <span className="rounded-full bg-[#fbbf24]/15 px-2.5 py-0.5 text-[12px] font-bold text-[#fbbf24]">
                        Host
                      </span>
                    )}
                  </div>
                );
              })}

              {aiRoster.map((ai) => (
                <div
                  key={ai.key}
                  className="flex items-center gap-3 py-3"
                >
                  <div
                    style={{ backgroundColor: ai.color }}
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-[13px] font-extrabold text-[#0b1020]"
                  >
                    {ai.badge}
                  </div>
                  <b className="flex-1 truncate text-[15px] font-bold text-white">
                    {ai.name}
                  </b>
                  <span className="rounded-full bg-[#a78bfa]/15 px-2.5 py-0.5 text-[12px] font-bold text-[#a78bfa]">
                    AI
                  </span>
                  {isHost && ai.removable && (
                    <button
                      type="button"
                      disabled={aiBusy}
                      title="Remove AI player"
                      onClick={() => handleRemoveAiModel(ai.modelId)}
                      className="rounded-lg p-1 text-[#8d97ae] hover:bg-white/10 hover:text-white transition"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}

              {isHost && agyRunner?.available && (
                <div className="pt-3">
                  <button
                    type="button"
                    disabled={aiBusy || unselectedModels.length === 0}
                    onClick={() => setShowAddAi((v) => !v)}
                    className="flex w-full items-center gap-3 text-left group disabled:opacity-50"
                  >
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full border-2 border-dashed border-white/20 text-[#8d97ae] group-hover:border-[#22c55e] group-hover:text-white transition">
                      <Plus className="h-4 w-4" />
                    </div>
                    <span className="text-[15px] font-medium text-[#8d97ae] group-hover:text-white transition">
                      Add an AI player
                    </span>
                  </button>

                  {showAddAi && unselectedModels.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5 pl-[52px]">
                      {unselectedModels.map((m) => {
                        const meta = getModelUiMeta(m.id, m.family, m.label);
                        return (
                          <button
                            key={m.id}
                            type="button"
                            disabled={aiBusy}
                            onClick={() => handleAddAiModel(m.id)}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-[#18223a] px-3 py-1.5 text-xs font-semibold text-white hover:border-[#22c55e] transition"
                          >
                            <span
                              style={{ backgroundColor: meta.color }}
                              className="h-2.5 w-2.5 rounded-full"
                            />
                            <span>{meta.shortName}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Bottom Action Bar */}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
          {editingName ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                maxLength={40}
                value={nameDraft}
                autoFocus
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveName();
                  if (e.key === 'Escape') setEditingName(false);
                }}
                className="rounded-xl border border-white/20 bg-[#0b1020] px-3 py-2 text-sm text-white focus:border-[#22c55e] focus:outline-none"
              />
              <button
                type="button"
                disabled={busyAction || !nameDraft.trim()}
                onClick={handleSaveName}
                className="rounded-xl bg-[#18223a] border border-white/15 px-3.5 py-2 text-sm font-semibold text-white hover:bg-[#223050]"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => {
                  setNameDraft(state.human.name);
                  setEditingName(false);
                }}
                className="rounded-xl px-2.5 py-2 text-sm text-[#8d97ae] hover:text-white"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-[15px] text-[#8d97ae]">
              <Pencil className="h-3.5 w-3.5 text-[#fbbf24]" />
              <span>
                Playing as <b className="text-white">{state.human.name}</b>
              </span>
              <span>·</span>
              <button
                type="button"
                onClick={() => setEditingName(true)}
                className="text-[#8d97ae] underline hover:text-white transition"
              >
                change name
              </button>
            </div>
          )}

          {isHost ? (
            <button
              type="button"
              data-testid="lobby-start-match"
              disabled={busyAction}
              onClick={onStartMatch}
              className="inline-flex items-center gap-2 rounded-[14px] bg-[#22c55e] px-7 py-3.5 text-[17px] font-bold text-[#052e14] shadow-[0_8px_24px_rgba(34,197,94,0.25)] hover:bg-[#34d369] disabled:opacity-50 transition"
            >
              <Play className="h-4 w-4 fill-current" />
              <span>{busyAction ? 'Starting…' : 'Start game'}</span>
            </button>
          ) : (
            <div className="rounded-xl border border-white/15 bg-[#121a2e] px-5 py-3 text-sm font-semibold text-[#8d97ae]">
              Waiting for host to start…
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
