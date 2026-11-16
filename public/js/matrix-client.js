// Единственный слой, знающий про matrix-js-sdk. Вся чистая логика — в
// matrix-core.js (тестируется без SDK). P1-5: версия закреплена и синхронна
// с package.json (37.13.0).
import * as sdk from 'https://esm.sh/matrix-js-sdk@37.13.0';
import {
    SESSION_KEY,
    HS_KEY,
    DEFAULT_HOMESERVER,
    resolveBaseUrl,
    makeSessionStore,
    validateSession,
    performLogin,
    registerWithUIA,
    buildRoomViews,
} from './matrix-core.js';

const store = makeSessionStore(localStorage);
const listeners = new Set();

const state = {
    phase: 'idle',
    connection: 'offline',
    error: '',
    rooms: [],
    activeRoomId: null,
    myUserId: '',
    myName: '',
    baseUrl: DEFAULT_HOMESERVER,
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

export function initBaseUrl(search) {
    const r = resolveBaseUrl({ search, storage: localStorage });
    state.baseUrl = r.url;
    return r; // needConfirm/foreign — UI спросит перед отправкой учётных данных
}
export function setBaseUrl(url) {
    localStorage.setItem(HS_KEY, String(url).trim().replace(/\/+$/, ''));
    state.baseUrl = String(url).trim().replace(/\/+$/, '');
}

function refreshRooms() {
    if (!client) return;
    state.rooms = buildRoomViews(client.getRooms());
}

function wire() {
    client.on(sdk.ClientEvent.Sync, (syncState) => {
        if (syncState === sdk.SyncState.SYNCED) {
            refreshRooms();
            state.phase = 'ready';
            state.connection = 'online';
            state.error = '';
            state.myUserId = client.getUserId() || '';
            state.myName = client.getUser?.()?.displayName || state.myUserId;
        } else if (syncState === sdk.SyncState.SYNCING) {
            state.connection = 'syncing';
            if (state.phase !== 'ready') state.phase = 'syncing';
        } else if (syncState === sdk.SyncState.ERROR) {
            // P0-2: временная ошибка sync — SDK сам ретраит с тем же since,
            // сессию не теряем, показываем переподключение
            state.connection = 'reconnecting';
        }
        notify();
    });

    // P1-5 realtime: новое событие в таймлайне комнаты → пересобираем только её
    client.on(sdk.RoomEvent.Timeline, (event, room, toStartOfTimeline) => {
        if (toStartOfTimeline || !room) return;
        refreshRooms();
        notify();
    });
    client.on(sdk.RoomEvent.LocalEchoUpdated, () => {
        refreshRooms();
        notify();
    });
    client.on(sdk.ClientEvent.Room, () => {
        refreshRooms();
        notify();
    });
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

export async function login({ baseUrl, username, password }) {
    reset();
    state.baseUrl = String(baseUrl).trim().replace(/\/+$/, '');
    client = sdk.createClient({ baseUrl: state.baseUrl });
    // P0-1: сохранение из ответа loginWithPassword (через core.performLogin)
    await performLogin(client, { baseUrl: state.baseUrl, username, password }, store);
    wire();
    state.phase = 'syncing';
    state.connection = 'syncing';
    notify();
    await client.startClient();
}

export async function register({ baseUrl, username, password, token }) {
    reset();
    state.baseUrl = String(baseUrl).trim().replace(/\/+$/, '');
    // P0-3: полный UIA-flow через core.registerWithUIA
    const data = await registerWithUIA(fetch, {
        baseUrl: state.baseUrl,
        username,
        password,
        token,
    });
    client = sdk.createClient({
        baseUrl: state.baseUrl,
        accessToken: data.access_token,
        userId: data.user_id,
        deviceId: data.device_id,
    });
    store.save(state.baseUrl, data.access_token, data.user_id, data.device_id);
    wire();
    state.phase = 'syncing';
    state.connection = 'syncing';
    notify();
    await client.startClient();
}

// P0-2: восстановление с различением invalid/network
export async function restoreSession() {
    const saved = store.load();
    if (!saved) return 'none';

    const verdict = await validateSession(fetch, saved);
    if (verdict === 'invalid') {
        store.clear();
        reset();
        notify();
        return 'invalid';
    }
    if (verdict === 'network') {
        state.baseUrl = saved.baseUrl;
        state.phase = 'idle';
        state.connection = 'reconnecting';
        state.error = 'нет сети, сессия сохранена — ждём восстановления';
        notify();
        return 'network';
    }

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
    return 'restored';
}

export async function logout() {
    if (client) {
        try {
            await client.logout();
        } catch {
            /* игнор */
        }
        try {
            client.stopClient();
        } catch {
            /* игнор */
        }
    }
    store.clear();
    reset();
    notify();
}

export function selectRoom(roomId) {
    state.activeRoomId = roomId;
    notify();
}
export async function joinRoom(roomId) {
    if (client) await client.joinRoom(roomId);
}
export async function loadOlder(roomId) {
    if (!client) return;
    const room = client.getRooms().find((r) => r.roomId === roomId);
    if (!room) return;
    await client.scrollback(room, 30);
    refreshRooms();
    notify();
}
export async function sendText(roomId, text) {
    if (!client) throw new Error('no client');
    await client.sendTextMessage(roomId, text);
}

// P1-7: выбор приватности при создании комнаты
export async function createRoom(name, isPublic = false) {
    if (!client) throw new Error('no client');
    const res = await client.createRoom({
        name: String(name).trim(),
        visibility: isPublic ? 'public' : 'private',
        preset: isPublic ? 'public_chat' : 'trusted_private_chat',
    });
    return res.room_id;
}
export async function inviteUser(roomId, userId) {
    if (!client) throw new Error('no client');
    await client.invite(roomId, String(userId).trim());
}

void SESSION_KEY; // экспорт core используется в тестах, здесь не нужен напрямую
