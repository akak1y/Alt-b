require('dotenv').config();

const path = require('path');
const http = require('http');
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');

const sequelize = require('./db');
const { User } = require('./models');
const matrix = require('./lib/matrix');
const { getMemberChannel } = require('./lib/access');
const { AppError } = require('./lib/errors');
const logger = require('./lib/logger');
const modules = require('./modules');

const app = express();
const server = http.createServer(app);

const io = new Server(server, { cors: { origin: '*' } });

const reply = (callback, data) => {
    if (typeof callback === 'function') callback(data);
};

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => res.json({ ok: true }));

// модульный реестр: каждый модуль сам объявляет свой префикс /api/<name>
modules.forEach((m) => app.use(`/api/${m.name}`, m.router));

app.use((req, res) => res.status(404).json({ error: 'not found', code: 'NOT_FOUND' }));

// единый обработчик ошибок: AppError -> {error, code, details}; прочее -> INTERNAL
// + структурированный лог (фундамент под ассистента)
app.use((err, req, res, next) => {
    if (err instanceof AppError) {
        logger.error(err.code, { message: err.message, details: err.details, path: req.path });
        return res
            .status(err.httpStatus)
            .json({ error: err.message, code: err.code, details: err.details });
    }

    logger.error('INTERNAL', { message: err.message, stack: err.stack, path: req.path });
    return res.status(500).json({ error: 'server error', code: 'INTERNAL' });
});

io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;

    if (!token) return next(new Error('unauthorized'));

    try {
        const payload = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findByPk(payload.id);

        if (!user) return next(new Error('user not found'));

        socket.user = { id: user.id, login: user.login };
        socket.userRow = user;
        return next();
    } catch {
        return next(new Error('invalid token'));
    }
});

const startSyncLoop = (socket) => {
    const matrixToken = socket.userRow.matrix_token;

    (async () => {
        try {
            const first = await matrix.sync(matrixToken, null);
            let since = first.next_batch;

            while (socket.connected && !socket.data.syncStop) {
                let data;

                try {
                    data = await matrix.sync(matrixToken, since);
                } catch {
                    await new Promise((r) => setTimeout(r, 2000));
                    continue;
                }

                since = data.next_batch;
                const joined = data.rooms?.join || {};

                for (const [roomId, room] of Object.entries(joined)) {
                    for (const ev of room.timeline?.events || []) {
                        if (ev.type !== 'm.room.message' || !ev.content?.body) continue;

                        socket.emit('message:created', {
                            id: ev.event_id,
                            content: ev.content.body,
                            created_at: new Date(ev.origin_server_ts),
                            login: matrix.localpart(ev.sender),
                            channel_id: roomId,
                        });
                    }
                }
            }
        } catch (err) {
            logger.error('SYNC_LOOP', { message: err.message, user: socket.user?.login });
        }
    })();
};

io.on('connection', (socket) => {
    socket.data.channelId = null;
    socket.data.syncStop = false;

    logger.info('socket connected', { user: socket.user?.login });
    startSyncLoop(socket);

    socket.on('channel:join', async (payload, callback) => {
        try {
            const channelId = String(payload?.channelId || '');
            if (!channelId) return reply(callback, { error: 'channelId required' });

            const check = await getMemberChannel(socket.user.id, channelId);
            if (check.error) return reply(callback, { error: check.error });

            socket.data.channelId = channelId;
            return reply(callback, { ok: true });
        } catch (err) {
            logger.error('CHANNEL_JOIN', { message: err.message });
            return reply(callback, { error: 'server error' });
        }
    });

    socket.on('message:create', async (payload, callback) => {
        try {
            const content = String(payload?.content || '').trim();
            const channelId = String(payload?.channelId || '');

            if (!content) return reply(callback, { error: 'content required' });
            if (!channelId) return reply(callback, { error: 'channelId required' });

            const check = await getMemberChannel(socket.user.id, channelId);
            if (check.error) return reply(callback, { error: check.error });

            const result = await matrix.sendMessage(
                socket.userRow.matrix_token,
                channelId,
                content,
            );
            return reply(callback, { ok: true, eventId: result.event_id });
        } catch (err) {
            logger.error('MESSAGE_CREATE', { message: err.message });
            return reply(callback, { error: 'server error' });
        }
    });

    socket.on('disconnect', () => {
        socket.data.syncStop = true;
        logger.info('socket disconnected', { user: socket.user?.login });
    });
});

const port = process.env.PORT || 3000;

async function init() {
    try {
        await sequelize.authenticate();
        logger.info('database connected');

        await sequelize.sync();
        logger.info('database synced');

        server.listen(port, () =>
            logger.info('server started', { url: `http://localhost:${port}` }),
        );
    } catch (err) {
        logger.error('STARTUP', { message: err.message });
        process.exit(1);
    }
}

init();
