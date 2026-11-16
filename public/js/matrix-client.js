// Единственный слой, который знает про matrix-js-sdk и Synapse.
// Vue (app.js) не должен импортировать sdk напрямую — только этот модуль.
import * as sdk from 'https://esm.sh/matrix-js-sdk';
// если esm.sh закапризничает, запасной ESM-CDN:
// import * as sdk from 'https://cdn.jsdelivr.net/npm/matrix-js-sdk@latest/+esm';

const listeners = new Set();

const state = {
    phase: 'idle', // idle | syncing | ready | error
    connection: 'offline', // offline | syncing | online | reconnecting
    error: '',
    rooms: [],
    activeRoomId: null,
    myUserId: '',
    myName: '',
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

// Собираем плоские view-модели комнат из SDK-состояния (без утечки SDK-объектов в Vue).
function buildRooms() {
    if (!client) return [];

    return client.getRooms().map((r) => {
        const messages = (r.timeline || [])
            .filter((e) => e.getType() === 'm.room.message' && e.getContent()?.body)
            .map((e) => {
                const sender = e.getSender();
                const member = typeof r.getMember === 'function' ? r.getMember(sender) : null;
                return {
                    id: e.getId(),
                    body: e.getContent().body,
                    sender,
                    senderName: member?.rawDisplayName || member?.name || sender,
                    ts: e.getDate ? e.getDate().getTime() : 0,
                };
            });

        return {
            roomId: r.roomId,
            name: r.name || r.roomId,
            membership: typeof r.getMyMembership === 'function' ? r.getMyMembership() : 'join',
            memberCount: typeof r.getMemberCount === 'function' ? r.getMemberCount() : 0,
            messages,
        };
    });
}

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
            // SDK сам ретраит и продолжит sync с того же since — переподключение без потери сессии
            state.connection = 'reconnecting';
        }
        notify();
    });

    client.on(sdk.ClientEvent.Room, () => {
        state.rooms = buildRooms();
        notify();
    });
}

export async function login({ baseUrl, username, password }) {
    reset();
    client = sdk.createClient({ baseUrl: baseUrl.trim() });
    await client.loginWithPassword(username.trim(), password);
    wire();
    state.phase = 'syncing';
    state.connection = 'syncing';
    notify();
    await client.startClient();
}

export async function register({ baseUrl, username, password, token }) {
    reset();
    const url = baseUrl.trim().replace(/\/$/, '') + '/_matrix/client/v3/register';
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            username: username.trim(),
            password,
            auth: { type: 'm.login.registration_token', token: (token || '').trim() },
        }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `register failed (${res.status})`);

    client = sdk.createClient({
        baseUrl: baseUrl.trim(),
        accessToken: data.access_token,
        userId: data.user_id,
        deviceId: data.device_id,
    });
    wire();
    state.phase = 'syncing';
    state.connection = 'syncing';
    notify();
    await client.startClient();
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

export function selectRoom(roomId) {
    state.activeRoomId = roomId;
    notify();
}

export async function joinRoom(roomId) {
    if (!client) return;
    await client.joinRoom(roomId); // sync обновит membership
}

// История: подтянуть более старые события в комнату (scrollback даёт предыдущие страницы timeline).
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
    // подтверждение придёт через sync (Synapse — источник истины); локально не дублируем
}
