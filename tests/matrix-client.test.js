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
        getProfileInfo: vi.fn(async () => ({})),
        setDisplayName: vi.fn(async () => ({})),
        setAvatarUrl: vi.fn(async () => ({})),
        uploadContent: vi.fn(async () => ({ content_uri: 'mxc://test/AV' })),
        sendStateEvent: vi.fn(async () => ({})),
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

describe('профиль: ник и аватар через Matrix', () => {
    it('не затирает displayname при последующих /sync после смены ника', async () => {
        browser();
        const instance = matrixClient();
        sdk.createClient.mockReturnValueOnce(matrixClient()).mockReturnValueOnce(instance);
        const client = await import('../public/js/matrix-client.js');
        await client.login({ username: 'test', password: 'fake' });
        instance.getProfileInfo.mockResolvedValue({ displayname: 'Старое' });
        await client.setProfileName('Новое имя');
        expect(client.getState().myName).toBe('Новое имя');
        // Повторный sync не должен вернуть myName на userId.
        instance.emit('sync', 'SYNCING');
        expect(client.getState().myName).toBe('Новое имя');
    });

    it('рассылает смену ника в m.room.member join-комнат', async () => {
        browser();
        const instance = matrixClient([room('!r:example.org', false)]);
        sdk.createClient.mockReturnValueOnce(matrixClient()).mockReturnValueOnce(instance);
        const client = await import('../public/js/matrix-client.js');
        await client.login({ username: 'test', password: 'fake' });
        await client.setProfileName('Видимый ник');
        expect(instance.sendStateEvent).toHaveBeenCalledWith(
            '!r:example.org',
            'm.room.member',
            expect.objectContaining({ membership: 'join', displayname: 'Видимый ник' }),
            '@test:example.org',
        );
    });

    it('грузит файл в Matrix, ставит avatar_url и рассылает его в комнату', async () => {
        browser();
        const instance = matrixClient([room('!r:example.org', false)]);
        sdk.createClient.mockReturnValueOnce(matrixClient()).mockReturnValueOnce(instance);
        const client = await import('../public/js/matrix-client.js');
        await client.login({ username: 'test', password: 'fake' });
        await client.setAvatarUrl(await client.uploadAvatar({ name: 'a.png', type: 'image/png' }));
        expect(instance.uploadContent).toHaveBeenCalled();
        expect(instance.setAvatarUrl).toHaveBeenCalledWith('mxc://test/AV');
        expect(client.getState().myAvatarUrl).toBe('mxc://test/AV');
        expect(instance.sendStateEvent).toHaveBeenCalledWith(
            '!r:example.org',
            'm.room.member',
            expect.objectContaining({ membership: 'join', avatar_url: 'mxc://test/AV' }),
            '@test:example.org',
        );
    });

    it('удаление аватара очищает state и рассылает пустой avatar_url', async () => {
        browser();
        const instance = matrixClient([room('!r:example.org', false)]);
        sdk.createClient.mockReturnValueOnce(matrixClient()).mockReturnValueOnce(instance);
        const client = await import('../public/js/matrix-client.js');
        await client.login({ username: 'test', password: 'fake' });
        await client.setAvatarUrl('mxc://test/AV');
        await client.removeAvatar();
        expect(instance.setAvatarUrl).toHaveBeenLastCalledWith('');
        expect(client.getState().myAvatarUrl).toBe('');
        expect(instance.sendStateEvent).toHaveBeenLastCalledWith(
            '!r:example.org',
            'm.room.member',
            expect.objectContaining({ membership: 'join', avatar_url: '' }),
            '@test:example.org',
        );
    });
});

describe('резолв медиа через авторизованный эндпоинт', () => {
    it('строит v1-URL с аутентификацией, шлёт Bearer-токен и отдаёт blob-ссылку', async () => {
        browser();
        const instance = matrixClient();
        instance.mxcUrlToHttp = vi.fn(
            () => 'https://hs/_matrix/client/v1/media/thumbnail/h/M?width=48&height=48&method=crop',
        );
        sdk.createClient.mockReturnValueOnce(matrixClient()).mockReturnValueOnce(instance);
        const objectUrl = 'blob:hs/abc';
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => ({ ok: true, blob: async () => new Blob(['x']) })),
        );
        vi.stubGlobal('URL', {
            ...URL,
            createObjectURL: vi.fn(() => objectUrl),
            revokeObjectURL: vi.fn(),
        });

        const client = await import('../public/js/matrix-client.js');
        await client.login({ username: 'test', password: 'fake' });
        const url = await client.resolveAvatarUrl('mxc://h/M', 48);

        expect(url).toBe(objectUrl);
        expect(instance.mxcUrlToHttp).toHaveBeenCalledWith(
            'mxc://h/M',
            48,
            48,
            'crop',
            false,
            true,
            true,
        );
        const [, init] = globalThis.fetch.mock.calls[0];
        expect(init.headers.Authorization).toBe('Bearer test-token');
    });
});
