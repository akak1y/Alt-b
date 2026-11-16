import * as sdk from 'matrix-js-sdk';
import {
    HOMESERVER,
    makeSessionStore,
    validateSession,
    performLogin,
    isReadySyncState,
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
    baseUrl: HOMESERVER,
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
export const getHomeserver = () => HOMESERVER;

function refreshRooms() {
    if (!client) return;
    state.rooms = buildRoomViews(client.getRooms());
}

function wire() {
    client.on(sdk.ClientEvent.Sync, (syncState) => {
        if (isReadySyncState(syncState)) {
            refreshRooms();
            state.phase = 'ready';
            state.connection = 'online';
            state.error = '';
            state.myUserId = client.getUserId() || '';
            state.myName = client.getUser?.()?.displayName || state.myUserId;
        } else if (syncState === sdk.SyncState.Catchup) {
            state.connection = 'syncing';
            if (state.phase !== 'ready') state.phase = 'syncing';
        } else if (syncState === sdk.SyncState.Error || syncState === sdk.SyncState.Reconnecting) {
            state.connection = 'reconnecting';
        }
        notify();
    });

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
    notify();
}

export async function login({ username, password }) {
    reset();
    client = sdk.createClient({ baseUrl: HOMESERVER });
    await performLogin(client, { username, password }, store);
    wire();
    state.phase = 'syncing';
    state.connection = 'syncing';
    notify();
    await client.startClient();
}

export async function register({ username, password, token }) {
    reset();
    const data = await registerWithUIA(fetch, { username, password, token });
    client = sdk.createClient({
        baseUrl: HOMESERVER,
        accessToken: data.access_token,
        userId: data.user_id,
        deviceId: data.device_id,
    });
    store.save(data.access_token, data.user_id, data.device_id);
    wire();
    state.phase = 'syncing';
    state.connection = 'syncing';
    notify();
    await client.startClient();
}

export async function restoreSession() {
    const saved = store.load();
    if (!saved) return 'none';

    const verdict = await validateSession(fetch, saved);
    if (verdict === 'invalid') {
        store.clear();
        reset();
        return 'invalid';
    }
    if (verdict === 'network') {
        state.phase = 'idle';
        state.connection = 'reconnecting';
        state.error = 'нет сети, сессия сохранена — ждём восстановления';
        notify();
        return 'network';
    }

    reset();
    client = sdk.createClient({
        baseUrl: HOMESERVER,
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
            /* ignore */
        }
        try {
            client.stopClient();
        } catch {
            /* ignore */
        }
    }
    store.clear();
    reset();
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
