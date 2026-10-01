require('dotenv').config();

const path = require('path');
const http = require('http');
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');

const sequelize = require('./db');
const { User, SpaceMember, Channel, Message } = require('./models');
const authRoutes = require('./routes/auth');
const spaceRoutes = require('./routes/spaces');
const channelRoutes = require('./routes/channels');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: '*',
    },
});

const roomName = (channelId) => `channel:${channelId}`;

const reply = (callback, data) => {
    if (typeof callback === 'function') {
        callback(data);
    }
};

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
    res.json({ ok: true });
});

app.use('/api/auth', authRoutes);
app.use('/api/spaces', spaceRoutes);
app.use('/api/channels', channelRoutes);

io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;

    if (!token) {
        return next(new Error('unauthorized'));
    }

    try {
        const payload = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findByPk(payload.id);

        if (!user) {
            return next(new Error('user not found'));
        }

        socket.user = { id: user.id, login: user.login };
        return next();
    } catch {
        return next(new Error('invalid token'));
    }
});

io.on('connection', (socket) => {
    socket.data.channelId = null;

    console.log('socket connected:', socket.user?.login);

    socket.on('channel:join', async (payload, callback) => {
        try {
            const channelId = Number(payload?.channelId);

            if (!channelId) {
                return reply(callback, { error: 'channelId required' });
            }

            const channel = await Channel.findByPk(channelId);

            if (!channel) {
                return reply(callback, { error: 'channel not found' });
            }

            const member = await SpaceMember.findOne({
                where: { space_id: channel.space_id, user_id: socket.user.id },
            });

            if (!member) {
                return reply(callback, { error: 'not a member' });
            }

            if (socket.data.channelId) {
                socket.leave(roomName(socket.data.channelId));
            }

            socket.data.channelId = channelId;
            socket.join(roomName(channelId));

            return reply(callback, { ok: true });
        } catch (err) {
            console.error(err);
            return reply(callback, { error: 'server error' });
        }
    });

    socket.on('message:create', async (payload, callback) => {
        try {
            const content = String(payload?.content || '').trim();
            const channelId = Number(payload?.channelId);

            if (!content) {
                return reply(callback, { error: 'content required' });
            }

            if (!channelId) {
                return reply(callback, { error: 'channelId required' });
            }

            const channel = await Channel.findByPk(channelId);

            if (!channel) {
                return reply(callback, { error: 'channel not found' });
            }

            const member = await SpaceMember.findOne({
                where: { space_id: channel.space_id, user_id: socket.user.id },
            });

            if (!member) {
                return reply(callback, { error: 'not a member' });
            }

            const created = await Message.create({
                user_id: socket.user.id,
                channel_id: channelId,
                content,
            });

            const message = await Message.findByPk(created.id, {
                include: [{ model: User, attributes: ['login'] }],
            });

            const payloadMessage = {
                id: message.id,
                content: message.content,
                created_at: message.created_at,
                login: message.user?.login,
                channel_id: message.channel_id,
            };

            io.to(roomName(channelId)).emit('message:created', payloadMessage);

            return reply(callback, { ok: true, message: payloadMessage });
        } catch (err) {
            console.error(err);
            return reply(callback, { error: 'server error' });
        }
    });

    socket.on('disconnect', () => {
        console.log('socket disconnected:', socket.user?.login);
    });
});

const port = process.env.PORT || 3000;

async function init() {
    try {
        await sequelize.authenticate();
        console.log('Database connected');

        await sequelize.sync();
        console.log('Database synced');

        server.listen(port, () => {
            console.log(`Server started on http://localhost:${port}`);
        });
    } catch (err) {
        console.error('Startup error:', err);
        process.exit(1);
    }
}

init();
