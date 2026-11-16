const MATRIX_URL = process.env.MATRIX_URL;

async function mx(method, path, options = {}) {
    const { token, body, query } = options;

    const url = new URL(MATRIX_URL + path);

    if (query) {
        Object.entries(query).forEach(([key, value]) => {
            url.searchParams.set(key, value);
        });
    }

    const res = await fetch(url, {
        method,
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
        const err = new Error(data.error || `matrix error ${res.status}`);
        err.status = res.status;
        err.matrix = data;
        throw err;
    }

    return data;
}

const localpart = (mxid) =>
    String(mxid || '')
        .replace(/^@/, '')
        .split(':')[0];

const encodeRoom = (roomId) => encodeURIComponent(roomId);
const encodeUser = (userId) => encodeURIComponent(userId);

async function registerUser(username, password) {
    try {
        return await mx('POST', '/_matrix/client/v3/register', {
            body: { username, password },
        });
    } catch (err) {
        const session = err.matrix?.session;
        const flows = err.matrix?.flows || [];

        if (!session || !flows.length) {
            throw err;
        }

        const stage = flows[0].stages?.[0];

        if (!stage) {
            throw err;
        }

        return mx('POST', '/_matrix/client/v3/register', {
            body: {
                username,
                password,
                auth: { type: stage, session },
            },
        });
    }
}

async function loginUser(username, password) {
    return mx('POST', '/_matrix/client/v3/login', {
        body: {
            type: 'm.login.password',
            identifier: { type: 'm.id.user', user: username },
            password,
        },
    });
}

async function createRoom(token, { name, isSpace = false }) {
    return mx('POST', '/_matrix/client/v3/createRoom', {
        token,
        body: {
            name,
            visibility: 'public',
            preset: 'public_chat',
            ...(isSpace ? { creation_content: { type: 'm.space' } } : {}),
        },
    });
}

async function joinRoom(token, roomId) {
    return mx('POST', `/_matrix/client/v3/join/${encodeRoom(roomId)}`, {
        token,
        body: {},
    });
}

async function sendMessage(token, roomId, text) {
    const txnId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    return mx(
        'PUT',
        `/_matrix/client/v3/rooms/${encodeRoom(roomId)}/send/m.room.message/${txnId}`,
        {
            token,
            body: { msgtype: 'm.text', body: text },
        },
    );
}

async function getMessages(token, roomId, limit = 50) {
    return mx('GET', `/_matrix/client/v3/rooms/${encodeRoom(roomId)}/messages`, {
        token,
        query: {
            dir: 'b',
            limit: String(limit),
            filter: JSON.stringify({ types: ['m.room.message'] }),
        },
    });
}

async function sync(token, since) {
    return mx('GET', '/_matrix/client/v3/sync', {
        token,
        query: since ? { since, timeout: '20000' } : { timeout: '0' },
    });
}

async function getProfile(token, userId) {
    return mx('GET', `/_matrix/client/v3/profile/${encodeUser(userId)}`, { token });
}

async function setDisplayName(token, userId, displayname) {
    return mx('PUT', `/_matrix/client/v3/profile/${encodeUser(userId)}/displayname`, {
        token,
        body: { displayname },
    });
}

async function changePassword(token, { localUser, oldPassword, newPassword }) {
    return mx('POST', '/_matrix/client/v3/account/password', {
        token,
        body: {
            new_password: newPassword,
            logout_devices: false,
            auth: {
                type: 'm.login.password',
                identifier: { type: 'm.id.user', user: localUser },
                password: oldPassword,
            },
        },
    });
}

module.exports = {
    mx,
    localpart,
    registerUser,
    loginUser,
    createRoom,
    joinRoom,
    sendMessage,
    getMessages,
    sync,
    getProfile,
    setDisplayName,
    changePassword,
};
