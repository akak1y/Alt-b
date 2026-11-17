import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const express = require('express');
const { createInvitationsRouter, presentToken, readConfig } = require('../lib/invitations.js');

const time = 1_800_000_000_000;
const adminToken = 'ADMIN-SECRET';
const member = '@manager:example.org';
const config = {
    baseUrl: 'https://matrix.example.org',
    allowedUsers: new Set([member]),
    adminToken,
};
const token = (extra = {}) => ({
    token: 'from-synapse',
    uses_allowed: 1,
    completed: 0,
    pending: 0,
    expiry_time: time + 3600_000,
    ...extra,
});
const servers = [];
const reply = (data, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
});

async function fixture(handler, options = {}) {
    const calls = [];
    const fetchImpl = vi.fn(async (url, init) => {
        calls.push({ url, ...init, body: init.body && JSON.parse(init.body) });
        if (url.endsWith('/whoami')) return reply({ user_id: member });
        return handler(url, init);
    });
    const app = express();
    app.use(
        '/api/invitations',
        createInvitationsRouter({ config, now: () => time, fetchImpl, ...options }),
    );
    const server = await new Promise((resolve) => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    servers.push(server);
    const request = async (path = '', { auth = 'USER-SESSION', method = 'GET', body } = {}) => {
        const res = await fetch(
            `http://127.0.0.1:${server.address().port}/api/invitations${path}`,
            {
                method,
                headers: {
                    ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
                    'Content-Type': 'application/json',
                },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            },
        );
        return { status: res.status, headers: res.headers, data: await res.json() };
    };
    return { request, calls, fetchImpl };
}
afterEach(async () => {
    await Promise.all(
        servers.splice(0).map(
            (server) =>
                new Promise((resolve) => {
                    server.close(resolve);
                    server.closeAllConnections();
                }),
        ),
    );
});

describe('защищённый API приглашений', () => {
    it.each([
        [1, 1],
        [24, 1],
        [168, 5],
    ])('создаёт приглашение на %s часов и %s регистраций в Synapse', async (hours, uses) => {
        const { request, calls } = await fixture(() => reply(token()));
        const res = await request('', { method: 'POST', body: { hours, uses } });
        expect(res.status).toBe(201);
        expect(calls[0].headers.Authorization).toBe('Bearer USER-SESSION');
        expect(calls[1].url).toBe(
            'https://matrix.example.org/_synapse/admin/v1/registration_tokens/new',
        );
        expect(calls[1].headers.Authorization).toBe(`Bearer ${adminToken}`);
        expect(calls[1].body).toEqual({
            uses_allowed: uses,
            expiry_time: time + hours * 3600_000,
            length: 32,
        });
        expect(res.data.invitation.link).toBe(
            'https://alt.creatusest.ru/?registration_token=from-synapse',
        );
        expect(JSON.stringify(res.data)).not.toContain(adminToken);
        expect(res.headers.get('cache-control')).toBe('no-store');
    });
    it('возвращает старые токены и отсутствие лимита, не ведёт собственный список', async () => {
        const { request } = await fixture(() =>
            reply({
                registration_tokens: [
                    token({
                        token: 'old-admin-token',
                        uses_allowed: null,
                        expiry_time: null,
                        completed: 18,
                    }),
                ],
            }),
        );
        const res = await request();
        expect(res.status).toBe(200);
        expect(res.data.invitations[0]).toMatchObject({
            token: 'old-admin-token',
            status: 'active',
            uses_allowed: null,
            completed: 18,
        });
        expect(res.data.server_time).toBe(time);
    });
    it('возвращает отдельное приглашение и корректно кодирует путь', async () => {
        const { request, calls } = await fixture(() => reply(token({ token: 'a.~_-' })));
        expect((await request('/a.~_-')).status).toBe(200);
        expect(calls[1].url).toContain('/registration_tokens/a.~_-');
    });
    it('отзывает через PUT uses_allowed=0, сохраняя счётчики и историю', async () => {
        const { request, calls } = await fixture(() =>
            reply(token({ uses_allowed: 0, pending: 1, completed: 3 })),
        );
        const res = await request('/from-synapse/revoke', { method: 'POST', body: {} });
        expect(calls[1].method).toBe('PUT');
        expect(calls[1].body).toEqual({ uses_allowed: 0 });
        expect(res.data.invitation).toMatchObject({ status: 'invalid', pending: 1, completed: 3 });
    });
    it.each(['', '/one', '/one/revoke'])(
        'без авторизации запрещает %s до обращения к Synapse',
        async (path) => {
            const { request, calls } = await fixture(() => reply({}));
            expect(
                (
                    await request(path, {
                        auth: null,
                        method: path.endsWith('revoke') ? 'POST' : 'GET',
                    })
                ).status,
            ).toBe(401);
            expect(calls).toHaveLength(0);
        },
    );
    it('без авторизации нельзя создавать токены', async () => {
        const { request, calls } = await fixture(() => reply({}));
        expect(
            (await request('', { auth: null, method: 'POST', body: { hours: 24, uses: 1 } }))
                .status,
        ).toBe(401);
        expect(calls).toHaveLength(0);
    });
    it('не доверяет ID браузера и запрещает доступ неразрешённому пользователю', async () => {
        const fetchImpl = vi.fn(async () => reply({ user_id: '@other:example.org' }));
        const { request } = await fixture(() => reply({}), { fetchImpl });
        expect(
            (await request('', { method: 'POST', body: { hours: 24, uses: 1, user_id: member } }))
                .status,
        ).toBe(403);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
    it('просроченная пользовательская сессия получает 401', async () => {
        const { request } = await fixture(() => reply({}), {
            fetchImpl: async () => reply({}, 401),
        });
        expect((await request()).status).toBe(401);
    });
    it('не настроенный backend сообщает 503, а без авторизации 401', async () => {
        const { request, calls } = await fixture(() => reply({}), { config: null });
        expect((await request()).status).toBe(503);
        expect((await request('', { auth: null })).status).toBe(401);
        expect(calls).toHaveLength(0);
        expect(readConfig({})).toBeNull();
    });
    it.each([401, 403, 500])(
        'ошибка административного API %s не раскрывает секреты',
        async (status) => {
            const { request } = await fixture(() => reply({ error: adminToken }, status));
            const res = await request();
            expect(res.status).toBe(503);
            expect(JSON.stringify(res.data)).not.toContain(adminToken);
        },
    );
    it('сетевая ошибка Synapse не раскрывает данные исключения', async () => {
        const { request } = await fixture(() => {
            throw new Error(adminToken);
        });
        const res = await request();
        expect(res.status).toBe(503);
        expect(JSON.stringify(res.data)).not.toContain(adminToken);
    });
    it.each([
        { hours: 0, uses: 1 },
        { hours: 24, uses: 99 },
        { hours: '24', uses: 1 },
        { hours: 24, uses: 1, token: 'chosen' },
    ])('проверяет параметры %j', async (body) => {
        const { request, calls } = await fixture(() => reply({}));
        expect((await request('', { method: 'POST', body })).status).toBe(400);
        expect(calls).toHaveLength(1);
    });
    it('ограничивает создание по подтверждённому Matrix ID, а не ключу или IP', async () => {
        const { request, calls } = await fixture(() => reply(token()));
        for (let i = 0; i < 5; i += 1)
            expect(
                (await request('', { method: 'POST', body: { hours: 24, uses: 1 } })).status,
            ).toBe(201);
        const res = await request('', {
            auth: 'DIFFERENT-SESSION',
            method: 'POST',
            body: { hours: 24, uses: 1 },
        });
        expect(res.status).toBe(429);
        expect(res.headers.get('retry-after')).toBe('3600');
        expect(calls.filter((call) => call.url.endsWith('/new'))).toHaveLength(5);
    });
    it('не позволяет передать путь вместо токена', async () => {
        const { request, calls } = await fixture(() => reply({}));
        expect((await request('/bad%2Ftoken')).status).toBe(400);
        expect(calls).toHaveLength(1);
    });
});

describe('статус по правилам Synapse', () => {
    it('не возвращает произвольные поля ответа Synapse и отвергает неполные данные', () => {
        expect(presentToken(token({ secret: adminToken }), time)).not.toHaveProperty('secret');
        expect(() => presentToken(token({ token: undefined }), time)).toThrow();
        expect(() => presentToken(token({ completed: -1 }), time)).toThrow();
    });
    it('истекает на границе expiry_time', () => {
        expect(presentToken(token({ expiry_time: time }), time).status).toBe('expired');
        expect(presentToken(token({ expiry_time: time + 1 }), time).status).toBe('active');
    });
    it('учитывает завершённые регистрации и pending при исчерпании лимита', () => {
        expect(presentToken(token({ completed: 1 }), time).status).toBe('exhausted');
        expect(presentToken(token({ pending: 1 }), time).status).toBe('exhausted');
        expect(
            presentToken(token({ uses_allowed: 5, completed: 3, pending: 1 }), time).status,
        ).toBe('active');
    });
    it('отозванное приглашение остаётся недействительным даже после окончания срока', () => {
        expect(presentToken(token({ uses_allowed: 0, expiry_time: time - 1 }), time).status).toBe(
            'invalid',
        );
    });
});

describe('серверная конфигурация приглашений', () => {
    it('читает ключ из внешнего файла; запрещает пустые права, относительный путь и секрет в репозитории', () => {
        const dir = mkdtempSync(join(tmpdir(), 'alt-invites-test-'));
        try {
            const filename = join(dir, 'token');
            writeFileSync(filename, 'TEST-ADMIN-ONLY\n', { mode: 0o600 });
            const env = {
                ALT_INVITES_ADMIN_TOKEN_FILE: filename,
                ALT_INVITES_ALLOWED_USERS: member,
                ALT_INVITES_SYNAPSE_URL: 'https://matrix.example.org',
            };
            const value = readConfig(env);
            expect(value.adminToken).toBe('TEST-ADMIN-ONLY');
            expect(value.allowedUsers.has(member)).toBe(true);
            expect(readConfig({ ...env, ALT_INVITES_ALLOWED_USERS: '' })).toBeNull();
            expect(
                readConfig({ ...env, ALT_INVITES_ADMIN_TOKEN_FILE: 'relative-token' }),
            ).toBeNull();
            expect(
                readConfig({
                    ...env,
                    ALT_INVITES_ADMIN_TOKEN_FILE: join(process.cwd(), 'package.json'),
                }),
            ).toBeNull();
            expect(
                readConfig({ ...env, ALT_INVITES_SYNAPSE_URL: 'https://secret@example.org' }),
            ).toBeNull();
        } finally {
            rmSync(dir, { recursive: true });
        }
    });
});
