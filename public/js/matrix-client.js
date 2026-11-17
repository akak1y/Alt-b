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
    cryptoError: '',
    rooms: [],
    activeRoomId: null,
    myUserId: '',
    myName: '',
    baseUrl: HOMESERVER,
};

let client = null;
let transitioning = false;
let releaseSessionLock = null;

// Один активный клиент на origin. Все вкладки используют одну запись сессии.
// Блокировка действует до закрытия Rust Crypto и его соединений с IndexedDB.
async function acquireSessionLock() {
    const locks = globalThis.navigator?.locks;
    if (!locks) return;
    await new Promise((resolve, reject) => {
        locks
            .request('alt-matrix-session', { ifAvailable: true }, (lock) => {
                if (!lock) {
                    reject(
                        new Error(
                            'Alt уже открыт в другой вкладке. Закройте её и обновите страницу.',
                        ),
                    );
                    return;
                }
                return new Promise((release) => {
                    releaseSessionLock = release;
                    resolve();
                });
            })
            .catch(reject);
    });
}

function closeClient() {
    const closing = client;
    client = null;
    closing?.stopClient();
    releaseSessionLock?.();
    releaseSessionLock = null;
}

// Снимок из BFCache может содержать уже остановленный SDK или старую сессию.
globalThis.addEventListener?.('pagehide', () => {
    if (!transitioning) closeClient();
});
globalThis.addEventListener?.('pageshow', (event) => {
    if (event.persisted) globalThis.location.reload();
});

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

/** Запрос к защищённому API Alt с текущей пользовательской сессией. */
export async function invitationRequest(path, options = {}) {
    const session = store.load();
    if (!session?.accessToken) throw new Error('Для управления приглашениями необходимо войти.');
    let response;
    try {
        response = await fetch(path, {
            ...options,
            headers: {
                Authorization: `Bearer ${session.accessToken}`,
                'Content-Type': 'application/json',
            },
            cache: 'no-store',
            // Сервер последовательно выполняет whoami и запрос к Admin API.
            signal: AbortSignal.timeout(25_000),
        });
    } catch {
        throw new Error('Сервер Alt недоступен. Попробуйте позже.');
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok)
        throw new Error(data.error || 'Не удалось выполнить действие с приглашением.');
    return data;
}

/** Перечитывает комнаты SDK и превращает их в данные для интерфейса. */
function refreshRooms() {
    if (!client) return;
    // Sync расшифровывает события, нужные для превью. Открытая комната
    // дополнительно запрашивает расшифровку всей загруженной ленты.
    if (!state.cryptoError && state.activeRoomId) {
        const room = client.getRoom(state.activeRoomId);
        for (const event of room?.timeline || []) {
            if (event.shouldAttemptDecryption()) void client.decryptEventIfNeeded(event);
        }
    }
    state.rooms = buildRoomViews(client.getRooms());
}

/**
 * Подключает обработчики к созданному клиенту SDK.
 * Sync обновляет готовность, состояние сети и пользователя; события комнаты
 * и временные сообщения обновляют переписку. После изменения вызываем notify,
 * чтобы Vue заново отобразил актуальные данные.
 */
function wire(current) {
    current.on(sdk.ClientEvent.Sync, (syncState) => {
        if (client !== current) return;
        if (isReadySyncState(syncState)) {
            refreshRooms();
            state.phase = 'ready';
            state.connection = 'online';
            state.error = '';
            state.myUserId = current.getUserId() || '';
            state.myName = current.getUser?.()?.displayName || state.myUserId;
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
    const updateRooms = () => {
        if (client !== current) return;
        refreshRooms();
        notify();
    };
    current.on(sdk.RoomEvent.Timeline, (_event, room, toStartOfTimeline) => {
        if (!toStartOfTimeline && room) updateRooms();
    });
    current.on(sdk.RoomEvent.LocalEchoUpdated, updateRooms);
    current.on(sdk.ClientEvent.Room, updateRooms);
    current.on(sdk.MatrixEventEvent.Decrypted, updateRooms);
}

/** Сбрасывает состояние интерфейса перед новым входом или после выхода. */
function reset() {
    state.phase = 'idle';
    state.connection = 'offline';
    state.error = '';
    state.cryptoError = '';
    state.rooms = [];
    state.activeRoomId = null;
    state.myUserId = '';
    state.myName = '';
    notify();
}

async function startSession({ accessToken, userId, deviceId }) {
    client = sdk.createClient({ baseUrl: HOMESERVER, accessToken, userId, deviceId });
    state.phase = 'syncing';
    state.connection = 'syncing';
    notify();
    if (!releaseSessionLock || !globalThis.indexedDB) {
        state.cryptoError = 'Для E2EE нужны IndexedDB и Web Locks в защищённом контексте.';
    } else if (!deviceId) {
        state.cryptoError = 'В этой сессии нет ID устройства. Войдите заново для работы с E2EE.';
    } else {
        try {
            await client.initRustCrypto({
                useIndexedDB: true,
                cryptoDatabasePrefix: `alt-e2ee-${JSON.stringify([HOMESERVER, userId, deviceId])}`,
            });
        } catch {
            state.cryptoError =
                'Не удалось запустить E2EE. Проверьте доступ к хранилищу браузера и обновите страницу.';
        }
    }
    wire(client);
    await client.startClient();
}

async function openSession(action) {
    if (transitioning || client) throw new Error('Сессия Alt уже открывается или активна.');
    transitioning = true;
    reset();
    try {
        await acquireSessionLock();
        return await action();
    } finally {
        // Даже при неудачном входе или запуске следующая вкладка сможет войти.
        if (!client) closeClient();
        transitioning = false;
    }
}

async function startAuthenticatedSession(session) {
    try {
        await startSession(session);
    } catch {
        closeClient();
        reset();
        throw new Error('Не удалось запустить клиент Matrix. Обновите страницу.');
    }
}

/** Запрашивает вход по паролю, сохраняя выданный сервером ID устройства. */
export async function login({ username, password }) {
    return openSession(async () => {
        const auth = sdk.createClient({ baseUrl: HOMESERVER });
        const result = await performLogin(auth, { username, password }, store);
        await startAuthenticatedSession({
            accessToken: result.access_token,
            userId: result.user_id,
            deviceId: result.device_id,
        });
    });
}

/**
 * Выполняет регистрацию с кодом через registerWithUIA, сохраняет новую
 * сессию и запускает тот же поток синхронизации, что и при обычном входе.
 */
export async function register({ username, password, token }) {
    return openSession(async () => {
        const data = await registerWithUIA(fetch, { username, password, token });
        store.save(data.access_token, data.user_id, data.device_id);
        await startAuthenticatedSession({
            accessToken: data.access_token,
            userId: data.user_id,
            deviceId: data.device_id,
        });
    });
}

/**
 * При загрузке страницы проверяет сохранённую сессию.
 * none — входа не было; invalid — ключ отвергнут и удалён;
 * network — сеть недоступна, ключ ОСТАЁТСЯ; restored — запущен SDK.
 * Никогда не удаляем ключ только потому, что Synapse временно не отвечает.
 */
export async function restoreSession() {
    if (!store.load()) return 'none';
    return openSession(async () => {
        const saved = store.load();
        if (!saved) return 'none';
        const verdict = await validateSession(fetch, saved);
        if (verdict === 'invalid') {
            store.clear();
            return 'invalid';
        }
        if (verdict === 'network') {
            state.connection = 'reconnecting';
            state.error = 'Нет связи с Synapse. Сессия сохранена, обновите страницу.';
            notify();
            return 'network';
        }
        await startAuthenticatedSession(saved);
        return 'restored';
    });
}

/**
 * Пытается сообщить серверу о выходе и остановить клиент; даже при ошибке
 * сети удаляет локальную сессию и возвращает интерфейс к форме входа.
 */
export async function logout() {
    if (!client || transitioning) return;
    transitioning = true;
    try {
        const closing = client;
        client = null;
        try {
            await closing.logout(true);
        } catch {
            // Сервер недоступен — локальный выход всё равно должен завершиться.
        }
        store.clear();
    } finally {
        closeClient();
        transitioning = false;
        reset();
    }
}

/** Выбирает открытую комнату локально, не отправляя запрос на сервер. */
export function selectRoom(roomId) {
    state.activeRoomId = roomId;
    refreshRooms();
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
    const room = client?.getRoom(roomId);
    if (!room || room.getMyMembership() !== 'join' || state.phase !== 'ready') {
        throw new Error('Комната ещё не готова к отправке сообщений.');
    }
    if (room.hasEncryptionStateEvent() && (state.cryptoError || !client.getCrypto())) {
        throw new Error('Шифрование недоступно. Сообщение не отправлено.');
    }
    await client.sendTextMessage(roomId, text);
}

/**
 * Создаёт публичную или закрытую комнату. Параметры видимости передаются
 * прямо в SDK, а вызывающему коду возвращается ID созданной комнаты.
 */
export async function createRoom(name, isPublic = false, encrypted = false) {
    if (!client) throw new Error('no client');
    if (encrypted && isPublic)
        throw new Error('Создать зашифрованную комнату можно только приватной.');
    if (encrypted && (state.cryptoError || !client.getCrypto())) {
        throw new Error('Шифрование недоступно. Комната не создана.');
    }
    const res = await client.createRoom({
        name: String(name).trim(),
        visibility: isPublic ? 'public' : 'private',
        preset: isPublic ? 'public_chat' : encrypted ? 'private_chat' : 'trusted_private_chat',
        ...(encrypted && {
            initial_state: [
                {
                    type: 'm.room.encryption',
                    state_key: '',
                    content: { algorithm: 'm.megolm.v1.aes-sha2' },
                },
            ],
        }),
    });
    return res.room_id;
}
/** Приглашает Matrix-пользователя по ID в существующую комнату. */
export async function inviteUser(roomId, userId) {
    if (!client) throw new Error('no client');
    await client.invite(roomId, String(userId).trim());
}
