import { describe, it, expect, vi } from 'vitest';
import { SyncState } from 'matrix-js-sdk';
import {
    makeSessionStore,
    validateSession,
    performLogin,
    isReadySyncState,
    registerWithUIA,
    buildRoomViews,
    HOMESERVER,
    SESSION_KEY,
} from '../public/js/matrix-core.js';

describe('состояния синхронизации matrix-js-sdk', () => {
    it('открывает клиент после PREPARED и последующих SYNCING', () => {
        expect(isReadySyncState(SyncState.Prepared)).toBe(true);
        expect(isReadySyncState(SyncState.Syncing)).toBe(true);
        expect(isReadySyncState(SyncState.Reconnecting)).toBe(false);
        expect(isReadySyncState(SyncState.Error)).toBe(false);
        expect(SyncState.SYNCED).toBeUndefined();
    });
});

const memStorage = () => {
    const m = new Map();
    return {
        getItem: (k) => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => m.set(k, String(v)),
        removeItem: (k) => m.delete(k),
    };
};

describe('session store (P0-1, P1-9)', () => {
    it('сохраняет токен/иды и НЕ сохраняет пароль', () => {
        const st = memStorage();
        const store = makeSessionStore(st);
        store.save('tok', '@u:hs', 'DEV');
        const loaded = store.load();
        expect(loaded.accessToken).toBe('tok');
        expect(loaded.userId).toBe('@u:hs');
        expect(loaded.deviceId).toBe('DEV');
        expect(JSON.stringify(loaded)).not.toMatch(/password/i);
    });

    it('clear удаляет сессию', () => {
        const st = memStorage();
        const store = makeSessionStore(st);
        store.save('tok', '@u:hs', 'DEV');
        store.clear();
        expect(store.load()).toBe(null);
        expect(st.getItem(SESSION_KEY)).toBe(null);
    });
});

describe('performLogin (P0-1 блокирующий дефект)', () => {
    it('берёт access_token из ответа loginWithPassword, а не из credentials', async () => {
        const st = memStorage();
        const store = makeSessionStore(st);
        const client = {
            loginWithPassword: vi.fn(async () => ({
                access_token: 'REAL',
                user_id: '@a:h',
                device_id: 'D1',
            })),
            credentials: { access_token: undefined }, // ловушка: раньше брали отсюда
        };
        await performLogin(client, { username: ' a ', password: 'p' }, store);
        expect(client.loginWithPassword).toHaveBeenCalledWith('a', 'p');
        expect(store.load().accessToken).toBe('REAL');
    });
});

describe('validateSession (P0-2)', () => {
    it('200 → valid', async () => {
        const fetchImpl = vi.fn(async () => ({ ok: true, status: 200 }));
        expect(await validateSession(fetchImpl, { accessToken: 't' })).toBe('valid');
        expect(fetchImpl).toHaveBeenCalledWith(HOMESERVER + '/_matrix/client/v3/account/whoami', {
            headers: { Authorization: 'Bearer t' },
        });
    });
    it('401 → invalid', async () => {
        const fetchImpl = vi.fn(async () => ({ ok: false, status: 401 }));
        expect(await validateSession(fetchImpl, { accessToken: 't' })).toBe('invalid');
    });
    it('throw сети → network (сессия сохраняется)', async () => {
        const fetchImpl = vi.fn(async () => {
            throw new TypeError('net');
        });
        expect(await validateSession(fetchImpl, { accessToken: 't' })).toBe('network');
    });
});

describe('registerWithUIA (P0-3)', () => {
    const mk = (responses) => {
        let i = 0;
        return vi.fn(async () => responses[i++]);
    };

    it('полный flow: token → dummy → 200', async () => {
        const fetchImpl = mk([
            {
                ok: false,
                status: 401,
                json: async () => ({
                    session: 'S',
                    flows: [{ stages: ['m.login.registration_token', 'm.login.dummy'] }],
                }),
            },
            {
                ok: false,
                status: 401,
                json: async () => ({ session: 'S', flows: [{ stages: ['m.login.dummy'] }] }),
            },
            {
                ok: true,
                status: 200,
                json: async () => ({ access_token: 'T', user_id: '@u:h', device_id: 'D' }),
            },
        ]);
        const data = await registerWithUIA(fetchImpl, {
            username: 'u',
            password: 'p',
            token: 'CODE',
        });
        expect(data.access_token).toBe('T');
        const bodies = fetchImpl.mock.calls.map((c) => JSON.parse(c[1].body));
        expect(bodies[1].auth).toEqual({
            type: 'm.login.registration_token',
            token: 'CODE',
            session: 'S',
        });
        expect(bodies[2].auth).toEqual({ type: 'm.login.dummy', session: 'S' });
    });

    it('неверный код: стадия остаётся в flows → ошибка, а не «следующий шаг»', async () => {
        const fetchImpl = mk([
            {
                ok: false,
                status: 401,
                json: async () => ({
                    session: 'S',
                    flows: [{ stages: ['m.login.registration_token'] }],
                }),
            },
            {
                ok: false,
                status: 401,
                json: async () => ({
                    session: 'S',
                    flows: [{ stages: ['m.login.registration_token'] }],
                }),
            },
        ]);
        await expect(
            registerWithUIA(fetchImpl, {
                username: 'u',
                password: 'p',
                token: 'BAD',
            }),
        ).rejects.toThrow(/invalid or expired registration token/);
    });

    it('истёкший код обрабатывается как invalid (та же стадия в flows)', async () => {
        const fetchImpl = mk([
            {
                ok: false,
                status: 401,
                json: async () => ({
                    session: 'S',
                    flows: [{ stages: ['m.login.registration_token'] }],
                }),
            },
            {
                ok: false,
                status: 401,
                json: async () => ({
                    session: 'S',
                    flows: [{ stages: ['m.login.registration_token'] }],
                }),
            },
        ]);
        await expect(
            registerWithUIA(fetchImpl, {
                username: 'u',
                password: 'p',
                token: 'EXPIRED',
            }),
        ).rejects.toThrow(/invalid or expired/);
    });

    it('повторная попытка после ошибки с корректным кодом проходит', async () => {
        const first = mk([
            {
                ok: false,
                status: 401,
                json: async () => ({
                    session: 'S',
                    flows: [{ stages: ['m.login.registration_token'] }],
                }),
            },
            {
                ok: false,
                status: 401,
                json: async () => ({
                    session: 'S',
                    flows: [{ stages: ['m.login.registration_token'] }],
                }),
            },
        ]);
        await expect(
            registerWithUIA(first, {
                username: 'u',
                password: 'p',
                token: 'BAD',
            }),
        ).rejects.toThrow();

        const second = mk([
            {
                ok: false,
                status: 401,
                json: async () => ({
                    session: 'S2',
                    flows: [{ stages: ['m.login.registration_token'] }],
                }),
            },
            {
                ok: true,
                status: 200,
                json: async () => ({ access_token: 'OK2', user_id: '@u:h', device_id: 'D' }),
            },
        ]);
        const data = await registerWithUIA(second, {
            username: 'u',
            password: 'p',
            token: 'GOOD',
        });
        expect(data.access_token).toBe('OK2');
    });
});

describe('buildRoomViews (P1-4)', () => {
    const fakeRoom = (over = {}) => ({
        roomId: '!r:h',
        name: 'room',
        timeline: [],
        currentState: { getStateEvents: () => null },
        getMember: () => null,
        getMyMembership: () => 'join',
        getMemberCount: () => 1,
        ...over,
    });

    it('помечает зашифрованную комнату и encrypted-события', () => {
        const encEvent = {
            getType: () => 'm.room.encrypted',
            getSender: () => '@b:h',
            getId: () => '$e1',
            getDate: () => new Date(1000),
            getContent: () => ({}),
        };
        const rooms = [
            fakeRoom({
                isEncrypted: true,
                timeline: [encEvent],
                currentState: { getStateEvents: () => ({}) },
            }),
        ];
        const views = buildRoomViews(rooms);
        expect(views[0].isEncrypted).toBe(true);
        expect(views[0].messages[0].encrypted).toBe(true);
        expect(views[0].messages[0].body).toMatch(/E2EE/);
    });

    it('обычное m.room.message маппится с body', () => {
        const ev = {
            getType: () => 'm.room.message',
            getSender: () => '@a:h',
            getId: () => '$m1',
            getDate: () => new Date(2000),
            getContent: () => ({ body: 'привет' }),
        };
        const views = buildRoomViews([fakeRoom({ timeline: [ev] })]);
        expect(views[0].messages[0].body).toBe('привет');
        expect(views[0].messages[0].encrypted).toBe(false);
    });
});
