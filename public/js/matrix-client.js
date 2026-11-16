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

// Связующее звено между Vue (app.js) и matrix-js-sdk.
// Здесь живёт запущенный клиент Matrix, хранятся данные экрана и отправляются
// запросы к Synapse. Чистые преобразования вынесены в matrix-core.js.
const store = makeSessionStore(localStorage);
const listeners = new Set();

// phase: idle — форма входа, syncing — первое подключение, ready — комнаты.
// connection отдельно описывает сеть после открытия интерфейса.
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

// Копия состояния для интерфейса: Vue не должен напрямую менять массив комнат
// или сообщений, которым владеет этот модуль.
const snapshot = () => ({
    ...state,
    rooms: state.rooms.map((r) => ({ ...r, messages: [...r.messages] })),
});
// Сообщает всем подписчикам, что состояние изменилось.
const notify = () => listeners.forEach((fn) => fn(snapshot()));

/**
 * Подписывает компонент Vue на обновления. Сразу отдаёт текущее состояние,
 * а возвращённая функция снимает подписку при удалении компонента.
 */
export const subscribe = (fn) => {
    listeners.add(fn);
    fn(snapshot());
    return () => listeners.delete(fn);
};
/** Текущий снимок экрана для первого отображения в app.js. */
export const getState = () => snapshot();
/** Адрес Synapse, заданный в matrix-core.js. */
export const getHomeserver = () => HOMESERVER;

/** Перечитывает комнаты SDK и превращает их в данные для интерфейса. */
function refreshRooms() {
    if (!client) return;
    state.rooms = buildRoomViews(client.getRooms());
}

/**
 * Подключает обработчики к созданному клиенту SDK.
 * Sync обновляет готовность, состояние сети и пользователя; события комнаты
 * и временные сообщения обновляют переписку. После изменения вызываем notify,
 * чтобы Vue заново отобразил актуальные данные.
 */
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

    // События, добавленные в начало при загрузке истории, здесь не дублируем:
    // loadOlder() перечитывает комнату отдельно после завершения запроса.
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

/** Сбрасывает состояние интерфейса перед новым входом или после выхода. */
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

/**
 * Создаёт клиент без сессии, запрашивает вход по паролю, затем запускает
 * синхронизацию. Токен сохраняет performLogin; wire следит за сообщениями.
 */
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

/**
 * Выполняет регистрацию с кодом через registerWithUIA, сохраняет новую
 * сессию и запускает тот же поток синхронизации, что и при обычном входе.
 */
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

/**
 * При загрузке страницы проверяет сохранённую сессию.
 * none — входа не было; invalid — ключ отвергнут и удалён;
 * network — сеть недоступна, ключ ОСТАЁТСЯ; restored — запущен SDK.
 * Никогда не удаляем ключ только потому, что Synapse временно не отвечает.
 */
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

/**
 * Пытается сообщить серверу о выходе и остановить клиент; даже при ошибке
 * сети удаляет локальную сессию и возвращает интерфейс к форме входа.
 */
export async function logout() {
    if (client) {
        try {
            await client.logout();
        } catch {
            // Сервер недоступен — локальный выход всё равно должен завершиться.
        }
        try {
            client.stopClient();
        } catch {
            // Остановку SDK тоже не считаем причиной оставлять сессию.
        }
    }
    store.clear();
    reset();
}

/** Выбирает открытую комнату локально, не отправляя запрос на сервер. */
export function selectRoom(roomId) {
    state.activeRoomId = roomId;
    notify();
}
/** Принимает приглашение в комнату через SDK; список обновится при синхронизации. */
export async function joinRoom(roomId) {
    if (client) await client.joinRoom(roomId);
}
/** Запрашивает до 30 предыдущих событий комнаты и обновляет её отображение. */
export async function loadOlder(roomId) {
    if (!client) return;
    const room = client.getRooms().find((r) => r.roomId === roomId);
    if (!room) return;
    await client.scrollback(room, 30);
    refreshRooms();
    notify();
}
/** Отправляет текст в выбранную комнату; без клиента отправка запрещена. */
export async function sendText(roomId, text) {
    if (!client) throw new Error('no client');
    await client.sendTextMessage(roomId, text);
}

/**
 * Создаёт публичную или закрытую комнату. Параметры видимости передаются
 * прямо в SDK, а вызывающему коду возвращается ID созданной комнаты.
 */
export async function createRoom(name, isPublic = false) {
    if (!client) throw new Error('no client');
    const res = await client.createRoom({
        name: String(name).trim(),
        visibility: isPublic ? 'public' : 'private',
        preset: isPublic ? 'public_chat' : 'trusted_private_chat',
    });
    return res.room_id;
}
/** Приглашает Matrix-пользователя по ID в существующую комнату. */
export async function inviteUser(roomId, userId) {
    if (!client) throw new Error('no client');
    await client.invite(roomId, String(userId).trim());
}
