const express = require('express');
const { Channel, Message, User, SpaceMember } = require('../models');
const auth = require('../auth');

const router = express.Router();

async function resolveMemberChannel(userId, channelId) {
    const channel = await Channel.findByPk(channelId);

    if (!channel) {
        return { error: 'channel not found', status: 404 };
    }

    const member = await SpaceMember.findOne({
        where: { space_id: channel.space_id, user_id: userId },
    });

    if (!member) {
        return { error: 'not a member', status: 403 };
    }

    return { channel };
}

router.get('/:id/messages', auth, async (req, res) => {
    try {
        const check = await resolveMemberChannel(req.user.id, Number(req.params.id));

        if (check.error) {
            return res.status(check.status).json({ error: check.error });
        }

        const messages = await Message.findAll({
            where: { channel_id: check.channel.id },
            include: [{ model: User, attributes: ['login'] }],
            order: [['id', 'DESC']],
            limit: 50,
        });

        return res.json(
            messages.reverse().map((m) => ({
                id: m.id,
                content: m.content,
                created_at: m.created_at,
                login: m.user?.login,
                channel_id: m.channel_id,
            })),
        );
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'server error' });
    }
});

router.post('/:id/messages', auth, async (req, res) => {
    try {
        const check = await resolveMemberChannel(req.user.id, Number(req.params.id));

        if (check.error) {
            return res.status(check.status).json({ error: check.error });
        }

        const content = String(req.body?.content || '').trim();

        if (!content) {
            return res.status(400).json({ error: 'content required' });
        }

        const created = await Message.create({
            user_id: req.user.id,
            channel_id: check.channel.id,
            content,
        });

        const message = await Message.findByPk(created.id, {
            include: [{ model: User, attributes: ['login'] }],
        });

        return res.json({
            id: message.id,
            content: message.content,
            created_at: message.created_at,
            login: message.user?.login,
            channel_id: message.channel_id,
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'server error' });
    }
});

module.exports = router;
