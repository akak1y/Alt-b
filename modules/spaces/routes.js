const express = require('express');
const { Space, Channel, SpaceMember } = require('../../models');
const auth = require('../../lib/auth');
const matrix = require('../../lib/matrix');
const logger = require('../../lib/logger');

const router = express.Router();

router.get('/', auth, async (req, res) => {
    try {
        const spaces = await Space.findAll({ order: [['created_at', 'ASC']] });
        const memberships = await SpaceMember.findAll({ where: { user_id: req.user.id } });

        const memberMap = {};
        memberships.forEach((m) => {
            memberMap[m.space_room_id] = m.role;
        });

        return res.json(
            spaces.map((s) => ({
                id: s.room_id,
                name: s.name,
                owner_id: s.owner_id,
                settings: s.settings || {},
                isMember: Boolean(memberMap[s.room_id]),
                role: memberMap[s.room_id] || null,
            })),
        );
    } catch (err) {
        logger.error('spaces list failed', err);
        return res.status(500).json({ error: 'server error', code: 'INTERNAL' });
    }
});

router.post('/', auth, async (req, res) => {
    try {
        const name = String(req.body?.name || '').trim();

        if (!name) {
            return res.status(400).json({ error: 'name required', code: 'BAD_REQUEST' });
        }

        const spaceRoom = await matrix.createRoom(req.user.matrix_token, { name, isSpace: true });
        const channelRoom = await matrix.createRoom(req.user.matrix_token, { name: 'общий' });

        await Space.create({
            room_id: spaceRoom.room_id,
            name,
            owner_id: req.user.id,
            settings: {},
        });
        await Channel.create({
            room_id: channelRoom.room_id,
            space_room_id: spaceRoom.room_id,
            name: 'общий',
            settings: {},
        });
        await SpaceMember.create({
            space_room_id: spaceRoom.room_id,
            user_id: req.user.id,
            role: 'owner',
        });

        return res.json({
            space: {
                id: spaceRoom.room_id,
                name,
                owner_id: req.user.id,
                settings: {},
                isMember: true,
                role: 'owner',
            },
            channel: { id: channelRoom.room_id, name: 'общий', type: 'text', settings: {} },
        });
    } catch (err) {
        logger.error('space create failed', err);
        return res.status(500).json({ error: 'server error', code: 'INTERNAL' });
    }
});

router.post('/:id/join', auth, async (req, res) => {
    try {
        const spaceRoomId = req.params.id;
        const space = await Space.findByPk(spaceRoomId);

        if (!space) {
            return res.status(404).json({ error: 'space not found', code: 'NOT_FOUND' });
        }

        await matrix.joinRoom(req.user.matrix_token, spaceRoomId);

        const channels = await Channel.findAll({ where: { space_room_id: spaceRoomId } });

        for (const channel of channels) {
            await matrix.joinRoom(req.user.matrix_token, channel.room_id);
        }

        await SpaceMember.findOrCreate({
            where: { space_room_id: spaceRoomId, user_id: req.user.id },
            defaults: { role: 'member' },
        });

        return res.json({ ok: true, role: 'member' });
    } catch (err) {
        logger.error('space join failed', err);
        return res.status(500).json({ error: 'server error', code: 'INTERNAL' });
    }
});

router.get('/:id/channels', auth, async (req, res) => {
    try {
        const spaceRoomId = req.params.id;

        const member = await SpaceMember.findOne({
            where: { space_room_id: spaceRoomId, user_id: req.user.id },
        });

        if (!member) {
            return res.status(403).json({ error: 'not a member', code: 'FORBIDDEN' });
        }

        const channels = await Channel.findAll({
            where: { space_room_id: spaceRoomId },
            order: [['created_at', 'ASC']],
        });

        return res.json(
            channels.map((c) => ({
                id: c.room_id,
                space_id: c.space_room_id,
                name: c.name,
                type: 'text',
                settings: c.settings || {},
            })),
        );
    } catch (err) {
        logger.error('channels list failed', err);
        return res.status(500).json({ error: 'server error', code: 'INTERNAL' });
    }
});

router.post('/:id/channels', auth, async (req, res) => {
    try {
        const spaceRoomId = req.params.id;
        const name = String(req.body?.name || '').trim();

        if (!name) {
            return res.status(400).json({ error: 'name required', code: 'BAD_REQUEST' });
        }

        const member = await SpaceMember.findOne({
            where: { space_room_id: spaceRoomId, user_id: req.user.id },
        });

        if (!member) {
            return res.status(403).json({ error: 'not a member', code: 'FORBIDDEN' });
        }

        const room = await matrix.createRoom(req.user.matrix_token, { name });

        await Channel.create({
            room_id: room.room_id,
            space_room_id: spaceRoomId,
            name,
            settings: {},
        });

        return res.json({
            id: room.room_id,
            space_id: spaceRoomId,
            name,
            type: 'text',
            settings: {},
        });
    } catch (err) {
        logger.error('channel create failed', err);
        return res.status(500).json({ error: 'server error', code: 'INTERNAL' });
    }
});

module.exports = router;
