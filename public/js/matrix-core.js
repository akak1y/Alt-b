export const SESSION_KEY = 'alt_matrix_session';
export const HOMESERVER = 'https://synapse.creatusest.ru';

export function makeSessionStore(storage) {
    return {
        save: (accessToken, userId, deviceId) =>
            storage.setItem(SESSION_KEY, JSON.stringify({ accessToken, userId, deviceId })),
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

export async function performLogin(client, { username, password }, store) {
    const res = await client.loginWithPassword(String(username).trim(), String(password));
    store.save(res.access_token, res.user_id, res.device_id);
    return res;
}

export function isReadySyncState(syncState) {
    return syncState === 'PREPARED' || syncState === 'SYNCING';
}

export async function registerWithUIA(fetchImpl, { username, password, token }) {
    const url = HOMESERVER + '/_matrix/client/v3/register';
    let body = { username: String(username).trim(), password };

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
