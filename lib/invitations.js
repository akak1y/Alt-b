const express = require('express');
const fs = require('node:fs');
const path = require('node:path');

const TOKEN_PATH = '/_synapse/admin/v1/registration_tokens';
const TOKEN_PATTERN = /^[A-Za-z0-9._~-]{1,64}$/;
const INVITE_ORIGIN = 'https://alt.creatusest.ru/';

class ApiError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

// Секрет читается только сервером из файла вне public/ и репозитория.
// Ошибка настройки отключает приглашения, но не мешает раздаче клиента.
function readConfig(env = process.env) {
    try {
        const baseUrl = new URL(env.ALT_INVITES_SYNAPSE_URL || 'https://synapse.creatusest.ru');
        if (
            !['http:', 'https:'].includes(baseUrl.protocol) ||
            baseUrl.username ||
            baseUrl.password ||
            baseUrl.search ||
            baseUrl.hash ||
            baseUrl.pathname !== '/'
        ) {
            return null;
        }
        const allowedUsers = new Set(
            (env.ALT_INVITES_ALLOWED_USERS || '')
                .split(',')
                .map((id) => id.trim())
                .filter(Boolean),
        );
        if (!allowedUsers.size || [...allowedUsers].some((id) => !/^@[^\s:]+:[^\s]+$/.test(id)))
            return null;
        const filename = env.ALT_INVITES_ADMIN_TOKEN_FILE;
        if (!filename || !path.isAbsolute(filename)) return null;
        const resolved = fs.realpathSync(filename);
        const repository = path.resolve(__dirname, '..');
        if (resolved === repository || resolved.startsWith(repository + path.sep)) return null;
        const adminToken = fs.readFileSync(resolved, 'utf8').trim();
        if (!adminToken || /\s/.test(adminToken)) return null;
        return { baseUrl: baseUrl.origin, allowedUsers, adminToken };
    } catch {
        return null;
    }
}

// Synapse учитывает и завершённые, и начатые регистрации при проверке лимита.
// Токены старых административных инструментов могут не иметь срока/лимита.
function presentToken(value, now) {
    if (
        !value ||
        typeof value.token !== 'string' ||
        !TOKEN_PATTERN.test(value.token) ||
        !Number.isSafeInteger(value.completed) ||
        value.completed < 0 ||
        !Number.isSafeInteger(value.pending) ||
        value.pending < 0 ||
        !(
            value.uses_allowed === null ||
            (Number.isSafeInteger(value.uses_allowed) && value.uses_allowed >= 0)
        ) ||
        !(
            value.expiry_time === null ||
            (Number.isSafeInteger(value.expiry_time) && value.expiry_time >= 0)
        )
    ) {
        throw new ApiError(502, 'Synapse вернул некорректные данные приглашения.');
    }
    let status = 'active';
    if (value.uses_allowed === 0) status = 'invalid';
    else if (value.expiry_time !== null && value.expiry_time <= now) status = 'expired';
    else if (
        value.uses_allowed !== null &&
        (value.completed >= value.uses_allowed ||
            value.pending >= value.uses_allowed - value.completed)
    )
        status = 'exhausted';
    return {
        token: value.token,
        uses_allowed: value.uses_allowed,
        completed: value.completed,
        pending: value.pending,
        expiry_time: value.expiry_time,
        status,
        link: `${INVITE_ORIGIN}?registration_token=${encodeURIComponent(value.token)}`,
    };
}

function createInvitationsRouter({
    config = readConfig(),
    fetchImpl = fetch,
    now = Date.now,
} = {}) {
    const router = express.Router();
    // Пять попыток создания в час на разрешённый Matrix ID, а не на IP прокси.
    // Счётчики только для разрешённых пользователей; перезапуск процесса их сбрасывает.
    const creationAttempts = new Map();

    async function synapse(path, accessToken, method = 'GET', body, identity = false) {
        let response;
        try {
            response = await fetchImpl(config.baseUrl + path, {
                method,
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
                signal: AbortSignal.timeout(10_000),
                redirect: 'error',
            });
        } catch {
            throw new ApiError(503, 'Synapse недоступен. Попробуйте позже.');
        }
        if (identity && [401, 403].includes(response.status))
            throw new ApiError(401, 'Сессия недействительна. Войдите снова.');
        if (!response.ok) {
            if (!identity && response.status === 404 && path !== TOKEN_PATH)
                throw new ApiError(404, 'Приглашение не найдено или метод недоступен.');
            throw new ApiError(
                503,
                'Управление приглашениями Synapse недоступно. Обратитесь к администратору.',
            );
        }
        try {
            return await response.json();
        } catch {
            throw new ApiError(502, 'Некорректный ответ Synapse.');
        }
    }

    // Ошибки отправляем без тела ответа Synapse, адресов запросов и секретов.
    const handle = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
    router.use((req, res, next) => {
        res.set('Cache-Control', 'no-store');
        next();
    });
    router.use(
        handle(async (req, res, next) => {
            const match = /^Bearer ([^\s]+)$/.exec(req.get('Authorization') || '');
            if (!match) throw new ApiError(401, 'Для управления приглашениями необходимо войти.');
            if (!config)
                throw new ApiError(503, 'Управление приглашениями не настроено на сервере Alt.');
            const identity = await synapse(
                '/_matrix/client/v3/account/whoami',
                match[1],
                'GET',
                undefined,
                true,
            );
            // Не доверяем ID, присланному браузером; только ответу whoami.
            if (typeof identity?.user_id !== 'string')
                throw new ApiError(502, 'Некорректный ответ проверки сессии.');
            if (!config.allowedUsers.has(identity.user_id))
                throw new ApiError(403, 'У вас нет права управлять приглашениями.');
            req.inviteUserId = identity.user_id;
            next();
        }),
    );
    router.use(express.json({ limit: '2kb' }));

    router.get(
        '/',
        handle(async (req, res) => {
            const data = await synapse(TOKEN_PATH, config.adminToken);
            if (!Array.isArray(data?.registration_tokens))
                throw new ApiError(502, 'Некорректный список приглашений.');
            const time = now();
            res.json({
                invitations: data.registration_tokens.map((token) => presentToken(token, time)),
                server_time: time,
            });
        }),
    );

    router.post(
        '/',
        handle(async (req, res) => {
            const body = req.body;
            if (
                !body ||
                ![1, 24, 168].includes(body.hours) ||
                ![1, 5].includes(body.uses) ||
                Object.keys(body).some((key) => !['hours', 'uses'].includes(key))
            ) {
                throw new ApiError(
                    400,
                    'Выберите срок 1 час, 24 часа или 7 дней и число регистраций 1 или 5.',
                );
            }
            const time = now();
            const attempts = (creationAttempts.get(req.inviteUserId) || []).filter(
                (at) => at > time - 3_600_000,
            );
            if (attempts.length >= 5) {
                res.set('Retry-After', String(Math.ceil((attempts[0] + 3_600_000 - time) / 1000)));
                throw new ApiError(429, 'Не более пяти попыток создания в час. Попробуйте позже.');
            }
            creationAttempts.set(req.inviteUserId, [...attempts, time]);
            // Сам код генерирует Synapse. Alt не хранит токены в отдельной базе.
            const data = await synapse(`${TOKEN_PATH}/new`, config.adminToken, 'POST', {
                uses_allowed: body.uses,
                expiry_time: time + body.hours * 3_600_000,
                length: 32,
            });
            res.status(201).json({ invitation: presentToken(data, now()) });
        }),
    );

    router.param('token', (req, res, next, token) => {
        if (!TOKEN_PATTERN.test(token))
            return next(new ApiError(400, 'Некорректный код приглашения.'));
        next();
    });
    router.get(
        '/:token',
        handle(async (req, res) => {
            const data = await synapse(
                `${TOKEN_PATH}/${encodeURIComponent(req.params.token)}`,
                config.adminToken,
            );
            res.json({ invitation: presentToken(data, now()) });
        }),
    );
    router.post(
        '/:token/revoke',
        handle(async (req, res) => {
            // Сохраняем историю, поэтому PUT uses_allowed=0 вместо DELETE.
            const data = await synapse(
                `${TOKEN_PATH}/${encodeURIComponent(req.params.token)}`,
                config.adminToken,
                'PUT',
                { uses_allowed: 0 },
            );
            res.json({ invitation: presentToken(data, now()) });
        }),
    );
    router.use((req, res) =>
        res.status(404).json({ error: 'Метод управления приглашениями не найден.' }),
    );
    router.use((error, req, res, _next) => {
        const status =
            error instanceof ApiError
                ? error.status
                : error.type === 'entity.too.large'
                  ? 413
                  : error instanceof SyntaxError
                    ? 400
                    : 500;
        res.status(status).json({
            error:
                error instanceof ApiError
                    ? error.message
                    : status === 400
                      ? 'Некорректный JSON запроса.'
                      : status === 413
                        ? 'Слишком большой запрос.'
                        : 'Не удалось обработать приглашение.',
        });
    });
    return router;
}

module.exports = { createInvitationsRouter, readConfig, presentToken };
