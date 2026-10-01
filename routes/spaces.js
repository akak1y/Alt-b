const express = require('express');
const sequelize = require('../db');
const { Space, SpaceMember, Channel } = require('../models');
const auth = require('../auth');

const router = express.Router();

router.get('/', auth, async (req, res) => {
    try {
        const spaces = await Space.findAll({ order: [['id', 'ASC']] });
        const memberships = await SpaceMember.findAll({ where: { user_id: req.user.id } });

        const memberMap = {};
        memberships.forEach((m) => {
            memberMap[m.space_id] = m.role;
        });

        const result = spaces.map((s) => ({
            id: s.id,
            name: s.name,
            owner_id: s.owner_id,
            isMember: Boolean(memberMap[s.id]),
            role: memberMap[s.id] || null,
        }));

        return res.json(result);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'server error' });
    }
});

router.post('/', auth, async (req, res) => {
    const transaction = await sequelize.transaction();

    try {
        const name = String(req.body?.name || '').trim();

        if (!name) {
            await transaction.rollback();
            return res.status(400).json({ error: 'name required' });
        }

        const space = await Space.create({ name, owner_id: req.user.id }, { transaction });
        await SpaceMember.create(
            { space_id: space.id, user_id: req.user.id, role: 'owner' },
            { transaction },
        );
        const channel = await Channel.create(
            { space_id: space.id, name: 'общий', type: 'text' },
            { transaction },
        );

        await transaction.commit();

        return res.json({
            space: {
                id: space.id,
                name: space.name,
                owner_id: space.owner_id,
                isMember: true,
                role: 'owner',
            },
            channel: { id: channel.id, name: channel.name, type: channel.type },
        });
    } catch (err) {
        await transaction.rollback();
        console.error(err);
        return res.status(500).json({ error: 'server error' });
    }
});

router.post('/:id/join', auth, async (req, res) => {
    try {
        const spaceId = Number(req.params.id);
        const space = await Space.findByPk(spaceId);

        if (!space) {
            return res.status(404).json({ error: 'space not found' });
        }

        const existing = await SpaceMember.findOne({
            where: { space_id: spaceId, user_id: req.user.id },
        });

        if (existing) {
            return res.json({ ok: true, role: existing.role });
        }

        await SpaceMember.create({ space_id: spaceId, user_id: req.user.id, role: 'member' });
        return res.json({ ok: true, role: 'member' });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'server error' });
    }
});

router.get('/:id/channels', auth, async (req, res) => {
    try {
        const spaceId = Number(req.params.id);
        const member = await SpaceMember.findOne({
            where: { space_id: spaceId, user_id: req.user.id },
        });

        if (!member) {
            return res.status(403).json({ error: 'not a member' });
        }

        const channels = await Channel.findAll({
            where: { space_id: spaceId },
            order: [['id', 'ASC']],
        });

        return res.json(
            channels.map((c) => ({ id: c.id, space_id: c.space_id, name: c.name, type: c.type })),
        );
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'server error' });
    }
});

router.post('/:id/channels', auth, async (req, res) => {
    try {
        const spaceId = Number(req.params.id);
        const name = String(req.body?.name || '').trim();

        if (!name) {
            return res.status(400).json({ error: 'name required' });
        }

        const member = await SpaceMember.findOne({
            where: { space_id: spaceId, user_id: req.user.id },
        });

        if (!member) {
            return res.status(403).json({ error: 'not a member' });
        }

        const channel = await Channel.create({ space_id: spaceId, name, type: 'text' });

        return res.json({
            id: channel.id,
            space_id: channel.space_id,
            name: channel.name,
            type: channel.type,
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'server error' });
    }
});

module.exports = router;
