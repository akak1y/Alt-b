// Единственный слой, который знает про matrix-js-sdk и Synapse.
// Vue (app.js) не импортирует sdk напрямую — только этот модуль.
import * as sdk from 'https://esm.sh/matrix-js-sdk';

// ─── FIX #1: homeserver URL из конфигурации, не хардкод ───
function resolveBaseUrl() {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get('hs');
  if (fromUrl) {
    localStorage.setItem('alt_matrix_hs', fromUrl);
    return fromUrl;
  }
  return localStorage.getItem('alt_matrix_hs') || 'https://synapse.creatusest.ru';
}

export const DEFAULT_BASE_URL = resolveBaseUrl();

export function setBaseUrl(url) {
  localStorage.setItem('alt_matrix_hs', url.trim());
}

// ─── FIX #3: персистентная сессия (token, НЕ пароль) ───
const SESSION_KEY = 'alt_matrix_session';

function saveSession(baseUrl, accessToken, userId, deviceId) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ baseUrl, accessToken, userId, deviceId }));
}

function loadSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY));
  } catch {
    return null;
  }
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

// ─── состояние ───
const listeners = new Set();

const state = {
  phase: 'idle',       // idle | syncing | ready | error
  connection: 'offline', // offline | syncing | online | reconnecting
  error: '',
  rooms: [],
  activeRoomId: null,
  myUserId: '',
  myName: '',
  baseUrl: DEFAULT_BASE_URL,
};

let client = null;

const snapshot = () => ({
  ...state,
  rooms: state.rooms.map((r) => ({ ...r, messages: [...r.messages] })),
});

const notify = () => listeners.forEach((fn) => fn(snapshot()));

export const subscribe = (fn) => {
  listeners.add(fn);
  fn(snapshot());
  return () => listeners.delete(fn);
};

export const getState = () => snapshot();

// ─── FIX #4: детект шифрования per-room и per-event ───
function buildRooms() {
  if (!client) return [];

  return client.getRooms().map((r) => {
    // проверяем, включено ли шифрование в комнате
    const encState = r.currentState?.getStateEvents('m.room.encryption', '');
    const isEncrypted = Boolean(encState);

    const messages = (r.timeline || [])
      .filter((e) => {
        const type = e.getType();
        return type === 'm.room.message' || type === 'm.room.encrypted';
      })
      .map((e) => {
        const type = e.getType();
        const sender = e.getSender();
        const member = typeof r.getMember === 'function' ? r.getMember(sender) : null;
        const name = member?.rawDisplayName || member?.name || sender;

        if (type === 'm.room.encrypted') {
          return {
            id: e.getId(),
            body: '[зашифрованное сообщение — E2EE не поддерживается]',
            sender,
            senderName: name,
            ts: e.getDate ? e.getDate().getTime() : 0,
            encrypted: true,
          };
        }

        return {
          id: e.getId(),
          body: e.getContent()?.body || '',
          sender,
          senderName: name,
          ts: e.getDate ? e.getDate().getTime() : 0,
          encrypted: false,
        };
      });

    return {
      roomId: r.roomId,
      name: r.name || r.roomId,
      membership: typeof r.getMyMembership === 'function' ? r.getMyMembership() : 'join',
      memberCount: typeof r.getMemberCount === 'function' ? r.getMemberCount() : 0,
      isEncrypted,
      messages,
    };
  });
}

// ─── FIX #5: слушаем Timeline и LocalEcho, не только Sync ───
function wire() {
  client.on(sdk.ClientEvent.Sync, (syncState) => {
    if (syncState === sdk.SyncState.SYNCED) {
      state.rooms = buildRooms();
      state.phase = 'ready';
      state.connection = 'online';
      state.error = '';
      state.myUserId = client.getUserId() || '';
      state.myName = client.getUser?.()?.displayName || state.myUserId;
    } else if (syncState === sdk.SyncState.SYNCING) {
      state.connection = 'syncing';
      if (state.phase !== 'ready') state.phase = 'syncing';
    } else if (syncState === sdk.SyncState.ERROR) {
      state.connection = 'reconnecting';
    }
    notify();
  });

  // новые события в таймлайн конкретной комнаты
  client.on(sdk.RoomEvent.Timeline, (event, room, toStartOfTimeline) => {
    if (toStartOfTimeline) return; // пагинация, не новое сообщение
    if (!room) return;

    const idx = state.rooms.findIndex((r) => r.roomId === room.roomId);
    if (idx >= 0) {
      const rebuilt = buildRooms();
      const fresh = rebuilt.find((r) => r.roomId === room.roomId);
      if (fresh) state.rooms[idx] = fresh;
    }
    notify();
  });

  // локальное эхо (своё сообщение подтверждено сервером)
  client.on(sdk.RoomEvent.LocalEchoUpdated, (event, room) => {
    if (!room) return;
    const idx = state.rooms.findIndex((r) => r.roomId === room.roomId);
    if (idx >= 0) {
      const rebuilt = buildRooms();
      const fresh = rebuilt.find((r) => r.roomId === room.roomId);
      if (fresh) state.rooms[idx] = fresh;
    }
    notify();
  });

  // комната появилась/исчезла
  client.on(sdk.ClientEvent.Room, () => {
    state.rooms = buildRooms();
    notify();
  });
}

// ─── FIX #2: полный UIA flow регистрации ───
async function registerWithUIA(baseUrl, username, password, token) {
  const url = baseUrl.trim().replace(/\/$/, '') + '/_matrix/client/v3/register';
  const submitted = new Set();
  let body = { username: username.trim(), password };

  for (let i = 0; i < 10; i++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await res.json().catch(() => ({}));

    if (res.ok) return data; // 200 = успех

    if (res.status !== 401) {
      throw new Error(data.error || `register failed (${res.status})`);
    }

    const flows = data.flows || [];
    const session = data.session;
    if (!session) throw new Error(data.error || 'no session in 401');

    // собираем все stages из всех flows
    const allStages = new Set();
    flows.forEach((f) => (f.stages || []).forEach((s) => allStages.add(s)));

    // подаём следующий неподанный stage
    let next = null;

    if (allStages.has('m.login.registration_token') && !submitted.has('m.login.registration_token')) {
      next = { type: 'm.login.registration_token', token: (token || '').trim() };
    } else if (allStages.has('m.login.dummy') && !submitted.has('m.login.dummy')) {
      next = { type: 'm.login.dummy' };
    }

    if (!next) {
      throw new Error(`unsupported auth stages: ${[...allStages].join(', ')}`);
    }

    submitted.add(next.type);
    body = { username: username.trim(), password, auth: { ...next, session } };
  }

  throw new Error('registration flow exceeded max attempts');
}

// ─── вход существующего пользователя ───
export async function login({ baseUrl, username, password }) {
  reset();
  state.baseUrl = baseUrl.trim();

  client = sdk.createClient({ baseUrl: state.baseUrl });
  await client.loginWithPassword(username.trim(), password);

  const cred = client.credentials;
  saveSession(state.baseUrl, cred.access_token, cred.userId, cred.deviceId);

  wire();
  state.phase = 'syncing';
  state.connection = 'syncing';
  notify();
  await client.startClient();
}

// ─── регистрация с UIA ───
export async function register({ baseUrl, username, password, token }) {
  reset();
  state.baseUrl = baseUrl.trim();

  const data = await registerWithUIA(state.baseUrl, username, password, token);

  client = sdk.createClient({
    baseUrl: state.baseUrl,
    accessToken: data.access_token,
    userId: data.user_id,
    deviceId: data.device_id,
  });

  saveSession(state.baseUrl, data.access_token, data.user_id, data.device_id);

  wire();
  state.phase = 'syncing';
  state.connection = 'syncing';
  notify();
  await client.startClient();
}

// ─── FIX #3: восстановление сессии при загрузке страницы ───
export async function restoreSession() {
  const saved = loadSession();
  if (!saved) return false;

  reset();
  state.baseUrl = saved.baseUrl;

  client = sdk.createClient({
    baseUrl: saved.baseUrl,
    accessToken: saved.accessToken,
    userId: saved.userId,
    deviceId: saved.deviceId,
  });

  wire();
  state.phase = 'syncing';
  state.connection = 'syncing';
  notify();
  await client.startClient();
  return true;
}

export async function logout() {
  if (client) {
    try { await client.logout(); } catch { /* игнор */ }
    try { client.stopClient(); } catch { /* игнор */ }
  }
  clearSession();
  reset();
  notify();
}

function reset() {
  client = null;
  state.phase = 'idle';
  state.connection = 'offline';
  state.error = '';
  state.rooms = [];
  state.activeRoomId = null;
  state.myUserId = '';
  state.myName = '';
}

// ─── навигация ───
export function selectRoom(roomId) {
  state.activeRoomId = roomId;
  notify();
}

export async function joinRoom(roomId) {
  if (!client) return;
  await client.joinRoom(roomId);
}

export async function loadOlder(roomId) {
  if (!client) return;
  const room = client.getRooms().find((r) => r.roomId === roomId);
  if (!room) return;
  await client.scrollback(room, 30);
  state.rooms = buildRooms();
  notify();
}

export async function sendText(roomId, text) {
  if (!client) throw new Error('no client');
  await client.sendTextMessage(roomId, text);
}

// ─── FIX #6: создание комнаты и приглашение ───
export async function createRoom(name) {
  if (!client) throw new Error('no client');
  const res = await client.createRoom({
    name: name.trim(),
    visibility: 'public',
    preset: 'public_chat',
  });
  return res.room_id;
}

export async function inviteUser(roomId, userId) {
  if (!client) throw new Error('no client');
  await client.invite(roomId, userId.trim());
}