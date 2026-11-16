// Чистая логика без matrix-js-sdk. Все внешние зависимости传入 параметрами
// (fetch, storage, client), чтобы покрывать P0 тестами без реального сервера.
// matrix-client.js — единственный, кто импортирует SDK и дёргает эти хелперы.

export const SESSION_KEY = 'alt_matrix_session';
export const HS_KEY = 'alt_matrix_hs';

// P1-6: централизованный Alt — whitelist разрешённых homeserver.
// Чужой адрес из ?hs= или storage не принимается без явного подтверждения
// (подтверждение делает UI до отправки логина/пароля).
export const ALLOWED_HOMESERVERS = ['https://synapse.creatusest.ru'];
export const DEFAULT_HOMESERVER = ALLOWED_HOMESERVERS[0];

const normalize = (u) =>
    String(u || '')
        .trim()
        .replace(/\/+$/, '');

export function resolveBaseUrl({
    search,
    storage,
    allowed = ALLOWED_HOMESERVERS,
    fallback = DEFAULT_HOMESERVER,
}) {
    const normAllowed = allowed.map(normalize);
    const fromUrl = normalize(search?.get?.('hs') || '');
    const fromStore = normalize(storage?.getItem?.(HS_KEY) || '');

    if (fromUrl && normAllowed.includes(fromUrl)) {
        storage?.setItem?.(HS_KEY, fromUrl);
        return { url: fromUrl, needConfirm: false };
    }
    if (fromStore && normAllowed.includes(fromStore)) {
        return { url: fromStore, needConfirm: false };
    }
    // адрес вне whitelist (или пуст) → дефолт, но если юзер явно ввёл/притащил
    // другой — флаг needConfirm, UI спросит перед отправкой учётных данных
    const foreign = fromUrl || fromStore;
    return { url: fallback, needConfirm: Boolean(foreign), foreign };
}

export function makeSessionStore(storage) {
    return {
        // P1-9: храним только токен/иды, НИКОГДА пароль
        save: (baseUrl, accessToken, userId, deviceId) =>
            storage.setItem(
                SESSION_KEY,
                JSON.stringify({ baseUrl, accessToken, userId, deviceId }),
            ),
        load: () => {
            try {
                return JSON.parse(storage.getItem(SESSION_KEY));
            } catch {
                return null;
            }
        },
        clear: () => storage.removeItem(SESSION_KEY),
    };
}

// P0-2: различаем валидный токен, отозванный (invalid) и отсутствие сети.
export async function validateSession(fetchImpl, { baseUrl, accessToken }) {
    try {
        const res = await fetchImpl(normalize(baseUrl) + '/_matrix/client/v3/account/whoami', {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (res.ok) return 'valid';
        if (res.status === 401 || res.status === 403) return 'invalid';
        return 'network'; // неожиданный статус — считаем временным
    } catch {
        return 'network'; // fetch throw = сеть недоступна, сессию НЕ теряем
    }
}

// P0-1: токен берём из ОТВЕТА loginWithPassword(), а не из client.credentials
export async function performLogin(client, { baseUrl, username, password }, store) {
    const res = await client.loginWithPassword(String(username).trim(), String(password));
    store.save(normalize(baseUrl), res.access_token, res.user_id, res.device_id);
    return res;
}

// P0-3: многошаговый UIA. Стадия считается ПРИНЯТОЙ только если она исчезла
// из flows следующего 401. Если стадия осталась при том же session — это отказ
// по значению (неверный/истёкший код) → явная ошибка, а не «следующий шаг».
export async function registerWithUIA(fetchImpl, { baseUrl, username, password, token }) {
    const url = normalize(baseUrl) + '/_matrix/client/v3/register';
    const submitted = new Set();
    let body = { username: String(username).trim(), password };

    for (let i = 0; i < 10; i += 1) {
        const res = await fetchImpl(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));

        if (res.ok) return data; // 200 = регистрация завершена
        if (res.status !== 401) throw new Error(data.error || `register failed (${res.status})`);

        const session = data.session;
        const flows = data.flows || [];
        if (!session) throw new Error(data.error || 'no session in 401');

        const stages = new Set();
        flows.forEach((f) => (f.stages || []).forEach((s) => stages.add(s)));

        // если только что поданная стадия всё ещё в flows при том же session —
        // сервер её отклонил по значению
        const lastSubmitted = [...submitted].pop();
        if (lastSubmitted && stages.has(lastSubmitted)) {
            throw new Error('invalid or expired registration token');
        }

        let next = null;
        if (
            stages.has('m.login.registration_token') &&
            !submitted.has('m.login.registration_token')
        ) {
            next = { type: 'm.login.registration_token', token: String(token || '').trim() };
        } else if (stages.has('m.login.dummy') && !submitted.has('m.login.dummy')) {
            next = { type: 'm.login.dummy' };
        }
        if (!next) throw new Error(`unsupported auth stages: ${[...stages].join(', ')}`);

        submitted.add(next.type);
        body = { username: String(username).trim(), password, auth: { ...next, session } };
    }
    throw new Error('registration flow exceeded max attempts');
}

// P1-4 + P1-5 realtime-маппинг: чистая функция SDK-комнаты → view.
// В тестах подаём фейковые объекты с теми же методами.
export function buildRoomViews(rooms) {
    return (rooms || []).map((r) => {
        const encState = r.currentState?.getStateEvents?.('m.room.encryption', '');
        const isEncrypted = Boolean(encState);

        const messages = (r.timeline || [])
            .filter((e) => {
                const t = e.getType();
                return t === 'm.room.message' || t === 'm.room.encrypted';
            })
            .map((e) => {
                const t = e.getType();
                const sender = e.getSender();
                const member = typeof r.getMember === 'function' ? r.getMember(sender) : null;
                const senderName = member?.rawDisplayName || member?.name || sender;
                if (t === 'm.room.encrypted') {
                    return {
                        id: e.getId(),
                        body: '[зашифрованное сообщение — E2EE не поддерживается]',
                        sender,
                        senderName,
                        ts: e.getDate ? e.getDate().getTime() : 0,
                        encrypted: true,
                    };
                }
                return {
                    id: e.getId(),
                    body: e.getContent()?.body || '',
                    sender,
                    senderName,
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
