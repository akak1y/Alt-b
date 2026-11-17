import { afterEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock('matrix-js-sdk', () => ({
    createClient: sdk.createClient,
    ClientEvent: { Sync: 'sync', Room: 'room' },
    RoomEvent: { Timeline: 'timeline', LocalEchoUpdated: 'echo' },
    MatrixEventEvent: { Decrypted: 'decrypted' },
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

function matrixClient(rooms = []) {
    const events = new Map();
    return {
        on: (name, listener) => events.set(name, listener),
        emit: (name, ...args) => events.get(name)(...args),
        initRustCrypto: vi.fn(async () => {}),
        getCrypto: () => ({}),
        decryptEventIfNeeded: vi.fn(async () => {}),
        sendTextMessage: vi.fn(async () => {}),
        createRoom: vi.fn(async () => ({ room_id: '!new:example.org' })),
        stopClient: vi.fn(),
        logout: vi.fn(async () => {}),
        loginWithPassword: vi.fn(async () => ({
            access_token: 'test-token',
            user_id: '@test:example.org',
            device_id: 'TEST',
        })),
        startClient: vi.fn(async () => {
            events.get('sync')('PREPARED');
            events.get('sync')('SYNCING');
        }),
        getRooms: () => rooms,
        getRoom: (id) => rooms.find((room) => room.roomId === id),
        getUserId: () => '@test:example.org',
        getUser: () => null,
    };
}

function browser() {
    const request = vi.fn(async (_name, _options, useLock) => useLock({}));
    vi.stubGlobal('navigator', { locks: { request } });
    vi.stubGlobal('indexedDB', {});
    vi.stubGlobal('localStorage', storage());
    return request;
}

function room(roomId, encrypted, timeline = []) {
    return {
        roomId,
        hasEncryptionStateEvent: () => encrypted,
        getMyMembership: () => 'join',
        timeline,
    };
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    sdk.createClient.mockReset();
});

describe('вход и восстановление клиента', () => {
    it('показывает комнаты после первой синхронизации и перезагрузки', async () => {
        browser();
        const first = matrixClient();
        const second = matrixClient();
        sdk.createClient
            .mockReturnValueOnce(matrixClient())
            .mockReturnValueOnce(first)
            .mockReturnValueOnce(second);

        const client = await import('../public/js/matrix-client.js');
        await client.login({ baseUrl: 'https://example.org', username: 'test', password: 'fake' });
        expect(client.getState().phase).toBe('ready');
        expect(client.getState().myUserId).toBe('@test:example.org');
        expect(first.initRustCrypto).toHaveBeenCalledWith({
            useIndexedDB: true,
            cryptoDatabasePrefix: expect.stringContaining('"@test:example.org","TEST"'),
        });
        expect(first.initRustCrypto.mock.invocationCallOrder[0]).toBeLessThan(
            first.startClient.mock.invocationCallOrder[0],
        );

        vi.stubGlobal(
            'fetch',
            vi.fn(async () => ({ ok: true })),
        );
        vi.resetModules();
        const restored = await import('../public/js/matrix-client.js');
        expect(await restored.restoreSession()).toBe('restored');
        expect(restored.getState().phase).toBe('ready');
        expect(second.initRustCrypto.mock.calls).toEqual(first.initRustCrypto.mock.calls);
    });

    it('не открывает второй клиент и не меняет сессию, если вкладка уже держит lock', async () => {
        const request = browser();
        request.mockImplementationOnce(async (_name, _options, useLock) => useLock(null));
        const client = await import('../public/js/matrix-client.js');
        await expect(client.login({ username: 'test', password: 'fake' })).rejects.toThrow(
            'другой вкладке',
        );
        expect(sdk.createClient).not.toHaveBeenCalled();
    });

    it('запускает Rust Crypto с данными, полученными при регистрации', async () => {
        browser();
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => ({
                ok: true,
                json: async () => ({
                    access_token: 'fake',
                    user_id: '@new:example.org',
                    device_id: 'NEW',
                }),
            })),
        );
        const current = matrixClient();
        sdk.createClient.mockReturnValue(current);
        const client = await import('../public/js/matrix-client.js');
        await client.register({ username: 'new', password: 'fake' });
        expect(current.initRustCrypto.mock.calls[0][0].cryptoDatabasePrefix).toContain(
            '"@new:example.org","NEW"',
        );
        expect(current.initRustCrypto.mock.invocationCallOrder[0]).toBeLessThan(
            current.startClient.mock.invocationCallOrder[0],
        );
    });
});

describe('зашифрованная переписка', () => {
    async function login(rooms, { failCrypto = false } = {}) {
        browser();
        const current = matrixClient(rooms);
        if (failCrypto) current.initRustCrypto.mockRejectedValue(new Error('IDB unavailable'));
        sdk.createClient.mockReturnValueOnce(matrixClient()).mockReturnValueOnce(current);
        const client = await import('../public/js/matrix-client.js');
        await client.login({ username: 'test', password: 'fake' });
        return { client, current };
    }

    it('обновляет то же событие после ошибки и последующей расшифровки', async () => {
        const event = {
            getId: () => '$e1',
            getSender: () => '@other:example.org',
            getType: vi.fn(() => 'm.room.encrypted'),
            getContent: vi.fn(() => ({ ciphertext: 'ciphertext' })),
            isDecryptionFailure: vi.fn(() => false),
            shouldAttemptDecryption: vi.fn(() => true),
        };
        const { client, current } = await login([room('!enc:example.org', true, [event])]);
        const messages = () => client.getState().rooms[0].messages;
        client.selectRoom('!enc:example.org');
        expect(messages()[0].body).toMatch(/Ожидание расшифровки/);
        expect(current.decryptEventIfNeeded).toHaveBeenCalledWith(event);

        event.getType.mockReturnValue('m.room.message');
        event.getContent.mockReturnValue({ body: '** Unable to decrypt **' });
        event.isDecryptionFailure.mockReturnValue(true);
        event.shouldAttemptDecryption.mockReturnValue(false);
        event.decryptionFailureReason = 'MEGOLM_UNKNOWN_INBOUND_SESSION_ID';
        current.emit('decrypted', event, new Error('missing key'));
        expect(messages()[0]).toMatchObject({ id: '$e1', encrypted: true });
        expect(messages()[0].body).toMatch(/нет ключа/);

        event.isDecryptionFailure.mockReturnValue(false);
        event.getContent.mockReturnValue({ body: 'Привет из Element' });
        current.emit('decrypted', event);
        expect(messages()[0]).toMatchObject({
            id: '$e1',
            encrypted: false,
            body: 'Привет из Element',
        });
    });

    it('передаёт текст SDK и создаёт комнату с m.room.encryption в initial_state', async () => {
        const { client, current } = await login([room('!enc:example.org', true)]);
        await client.sendText('!enc:example.org', 'Привет');
        expect(current.sendTextMessage).toHaveBeenCalledWith('!enc:example.org', 'Привет');
        await client.createRoom('Моя комната', false, true);
        expect(current.createRoom).toHaveBeenCalledWith({
            name: 'Моя комната',
            visibility: 'private',
            preset: 'private_chat',
            initial_state: [
                {
                    type: 'm.room.encryption',
                    state_key: '',
                    content: { algorithm: 'm.megolm.v1.aes-sha2' },
                },
            ],
        });
        await expect(client.createRoom('Общая', true, true)).rejects.toThrow('приватной');
    });

    it('блокирует отправку в зашифрованную или неизвестную комнату при сбое crypto', async () => {
        const { client, current } = await login(
            [room('!enc:example.org', true), room('!clear:example.org', false)],
            { failCrypto: true },
        );
        expect(client.getState().cryptoError).toMatch(/запустить E2EE/);
        await expect(client.sendText('!enc:example.org', 'текст')).rejects.toThrow(
            'Шифрование недоступно',
        );
        await expect(client.sendText('!unknown:example.org', 'текст')).rejects.toThrow(
            'Комната ещё не готова',
        );
        await expect(client.createRoom('Закрытая', false, true)).rejects.toThrow(
            'Шифрование недоступно',
        );
        expect(current.sendTextMessage).not.toHaveBeenCalled();
        expect(current.createRoom).not.toHaveBeenCalled();
        await client.sendText('!clear:example.org', 'обычный текст');
        expect(current.sendTextMessage).toHaveBeenCalledWith('!clear:example.org', 'обычный текст');
        await client.createRoom('Обычная', false);
        expect(current.createRoom).toHaveBeenCalledWith({
            name: 'Обычная',
            visibility: 'private',
            preset: 'trusted_private_chat',
        });
    });
});
