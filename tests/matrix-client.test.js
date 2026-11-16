import { afterEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock('matrix-js-sdk', () => ({
    createClient: sdk.createClient,
    ClientEvent: { Sync: 'sync', Room: 'room' },
    RoomEvent: { Timeline: 'timeline', LocalEchoUpdated: 'echo' },
    SyncState: { Error: 'ERROR', Reconnecting: 'RECONNECTING', Catchup: 'CATCHUP' },
}));

function storage() {
    const items = new Map();
    return {
        getItem: (key) => items.get(key) || null,
        setItem: (key, value) => items.set(key, value),
        removeItem: (key) => items.delete(key),
    };
}

function matrixClient() {
    const events = new Map();
    return {
        on: (name, listener) => events.set(name, listener),
        loginWithPassword: vi.fn(async () => ({
            access_token: 'test-token',
            user_id: '@test:example.org',
            device_id: 'TEST',
        })),
        startClient: vi.fn(async () => {
            events.get('sync')('PREPARED');
            events.get('sync')('SYNCING');
        }),
        getRooms: () => [],
        getUserId: () => '@test:example.org',
        getUser: () => null,
    };
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    sdk.createClient.mockReset();
});

describe('вход и восстановление клиента', () => {
    it('показывает комнаты после первой синхронизации и перезагрузки', async () => {
        vi.stubGlobal('localStorage', storage());
        sdk.createClient.mockImplementation(matrixClient);

        const client = await import('../public/js/matrix-client.js');
        await client.login({ baseUrl: 'https://example.org', username: 'test', password: 'fake' });
        expect(client.getState().phase).toBe('ready');
        expect(client.getState().myUserId).toBe('@test:example.org');

        vi.stubGlobal(
            'fetch',
            vi.fn(async () => ({ ok: true })),
        );
        vi.resetModules();
        const restored = await import('../public/js/matrix-client.js');
        expect(await restored.restoreSession()).toBe('restored');
        expect(restored.getState().phase).toBe('ready');
    });
});
