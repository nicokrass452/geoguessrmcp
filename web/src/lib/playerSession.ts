const PLAYER_ID_KEY = 'geoguessr_player_id';
const PLAYER_NAME_KEY = 'geoguessr_player_name';
const ROOM_CODE_KEY = 'geoguessr_room_code';
const VIEW_MODE_KEY = 'geoguessr_view_mode';

function createRandomPlayerId(): string {
  const rand = Math.random().toString(36).slice(2, 8);
  const ts = Date.now().toString(36).slice(-4);
  return `player_${ts}_${rand}`;
}

export function getSessionPlayerId(): string {
  if (typeof window === 'undefined') return 'human';
  try {
    const existing = window.sessionStorage.getItem(PLAYER_ID_KEY)?.trim();
    if (existing && existing.length > 0) {
      return existing;
    }
    const created = createRandomPlayerId();
    window.sessionStorage.setItem(PLAYER_ID_KEY, created);
    return created;
  } catch {
    return 'human';
  }
}

export function getSessionPlayerName(): string {
  if (typeof window === 'undefined') return 'You (Player)';
  try {
    return window.sessionStorage.getItem(PLAYER_NAME_KEY)?.trim() || 'You (Player)';
  } catch {
    return 'You (Player)';
  }
}

export function setSessionPlayerName(name: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(PLAYER_NAME_KEY, name.trim() || 'You (Player)');
  } catch {
    // ignore storage errors
  }
}

export function getSessionRoomCode(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const code = window.sessionStorage.getItem(ROOM_CODE_KEY)?.trim().toUpperCase();
    return code || null;
  } catch {
    return null;
  }
}

export function setSessionRoomCode(roomCode: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (roomCode && roomCode.trim()) {
      window.sessionStorage.setItem(ROOM_CODE_KEY, roomCode.trim().toUpperCase());
    } else {
      window.sessionStorage.removeItem(ROOM_CODE_KEY);
    }
  } catch {
    // ignore
  }
}

export function getSessionViewMode(): 'home' | 'arena' {
  if (typeof window === 'undefined') return 'home';
  try {
    const val = window.sessionStorage.getItem(VIEW_MODE_KEY);
    return val === 'arena' ? 'arena' : 'home';
  } catch {
    return 'home';
  }
}

export function setSessionViewMode(mode: 'home' | 'arena'): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(VIEW_MODE_KEY, mode);
  } catch {
    // ignore
  }
}
