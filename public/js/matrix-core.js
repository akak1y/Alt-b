// Вспомогательная логика Matrix без привязки к Vue и конкретному браузеру.
// Поэтому функции можно проверять тестами с подставными хранилищем, сетью
// и ответами SDK, не создавая пользователей на настоящем Synapse.
export const SESSION_KEY = 'alt_matrix_session';
export const HOMESERVER = 'https://synapse.creatusest.ru';

/**
 * Создаёт оболочку над localStorage: save/load/clear вызываются в matrix-client.js.
 * Сохраняются ключ доступа, ID пользователя и устройства, но НЕ пароль.
 * Повреждённая запись при чтении превращается в null, чтобы экран не ломался.
 */
export function makeSessionStore(storage) {
    return {
        // save вызывается только после успешного входа или регистрации.
        save: (accessToken, userId, deviceId) =>
            storage.setItem(SESSION_KEY, JSON.stringify({ accessToken, userId, deviceId })),
        // load возвращает сохранённый объект или null при некорректном JSON.
        load: () => {
            try {
                return JSON.parse(storage.getItem(SESSION_KEY));
            } catch {
                return null;
            }
        },
        // clear удаляет локальный ключ при выходе или недействительной сессии.
        clear: () => storage.removeItem(SESSION_KEY),
    };
}

/**
 * Спрашивает Synapse «кто я?» с сохранённым ключом доступа.
 * valid — ключ действует; invalid — сервер отверг его (401/403);
 * network — ответ не получен или произошла другая ошибка сервера.
 * При проблеме сети нельзя стирать сессию: пользователь может быть просто офлайн.
 */
export async function validateSession(fetchImpl, { accessToken }) {
    try {
        const res = await fetchImpl(HOMESERVER + '/_matrix/client/v3/account/whoami', {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (res.ok) return 'valid';
        if (res.status === 401 || res.status === 403) return 'invalid';
        return 'network';
    } catch {
        return 'network';
    }
}

/** Получает результат входа из SDK и сохраняет именно выданные сервером данные. */
export async function performLogin(client, { username, password }, store) {
    const res = await client.loginWithPassword(String(username).trim(), String(password));
    store.save(res.access_token, res.user_id, res.device_id);
    return res;
}

/** Состояния SDK, при которых уже можно показать загруженный интерфейс комнат. */
export function isReadySyncState(syncState) {
    return syncState === 'PREPARED' || syncState === 'SYNCING';
}

/**
 * Регистрирует пользователя через последовательную проверку Synapse.
 * Первый POST обычно возвращает 401 с session и flows — это предложение шагов,
 * а не ошибка пароля. Для каждого следующего POST передаём ту же session и
 * ответ на очередной шаг: код приглашения либо подтверждение m.login.dummy.
 * completed показывает, какие шаги сервер действительно принял. Только
 * успешный ответ (200) содержит данные, с которыми можно начать сессию.
 * fetchImpl передаётся параметром, чтобы тесты не обращались к рабочему серверу.
 */
export async function registerWithUIA(fetchImpl, { username, password, token }) {
    const url = HOMESERVER + '/_matrix/client/v3/register';
    let body = { username: String(username).trim(), password };

    // Ограничиваем число запросов на случай неожиданного или повторяющегося
    // сценария регистрации: бесконечный цикл браузеру здесь не нужен.
    for (let i = 0; i < 10; i += 1) {
        const res = await fetchImpl(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));

        if (res.ok) return data;
        if (res.status !== 401) throw new Error(data.error || `register failed (${res.status})`);

        const session = data.session;
        const flows = data.flows || [];
        if (!session) throw new Error(data.error || 'no session in 401');

        // В Matrix flows описывает все шаги; выполненные шаги перечислены отдельно в completed.
        const completed = new Set(data.completed || []);
        const supported = new Set(['m.login.registration_token', 'm.login.dummy']);
        const supportedFlows = flows.filter((item) =>
            (item.stages || []).every((stage) => supported.has(stage)),
        );
        const flow =
            (token &&
                supportedFlows.find((item) =>
                    item.stages.includes('m.login.registration_token'),
                )) ||
            supportedFlows[0];
        if (!flow) throw new Error(data.error || 'unsupported registration stages');

        // Если сервер не включил отправленный шаг в completed, не переходим
        // к следующему: иначе ошибочный код можно принять за успешный.
        const lastSubmitted = body.auth?.type;
        if (lastSubmitted && !completed.has(lastSubmitted)) {
            throw new Error(
                data.error ||
                    (lastSubmitted === 'm.login.registration_token'
                        ? 'invalid or expired registration token'
                        : 'registration step was not accepted'),
            );
        }

        const nextStage = (flow.stages || []).find((stage) => !completed.has(stage));
        if (!nextStage) throw new Error(data.error || 'registration did not complete');
        const next =
            nextStage === 'm.login.registration_token'
                ? { type: nextStage, token: String(token || '').trim() }
                : { type: nextStage };
        body = { username: String(username).trim(), password, auth: { ...next, session } };
    }
    throw new Error('registration flow exceeded max attempts');
}

/**
 * Превращает комнаты SDK в простые объекты для Vue: имя, членство, сообщения.
 * Здесь определяется признак шифрования. Клиент не расшифровывает E2EE:
 * зашифрованные события заменяются предупреждением вместо текста сообщения.
 * buildRoomViews вызывается при синхронизации и новых событиях комнаты.
 */
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
