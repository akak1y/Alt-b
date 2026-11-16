const express = require('express');
const auth = require('../../lib/auth');
const matrix = require('../../lib/matrix');
const { getMemberChannel } = require('../../lib/access');
const logger = require('../../lib/logger');

const router = express.Router();

router.get('/:id/messages', auth, async (req, res) => {
    try {
        const check = await getMemberChannel(req.user.id, req.params.id);

        if (check.error) {
            return res.status(check.status).json({ error: check.error, code: 'FORBIDDEN' });
        }

        const data = await matrix.getMessages(req.user.matrix_token, check.channel.room_id);

        const messages = (data.chunk || [])
            .filter((e) => e.type === 'm.room.message' && e.content?.body)
            .map((e) => ({
                id: e.event_id,
                content: e.content.body,
                created_at: new Date(e.origin_server_ts),
                login: matrix.localpart(e.sender),
                channel_id: check.channel.room_id,
            }))
            .reverse();

        return res.json(messages);
    } catch (err) {
        logger.error('messages read failed', err);
        return res.status(500).json({ error: 'server error', code: 'INTERNAL' });
    }
});

router.post('/:id/messages', auth, async (req, res) => {
    try {
        const check = await getMemberChannel(req.user.id, req.params.id);

        if (check.error) {
            return res.status(check.status).json({ error: check.error, code: 'FORBIDDEN' });
        }

        const content = String(req.body?.content || '').trim();

        if (!content) {
            return res.status(400).json({ error: 'content required', code: 'BAD_REQUEST' });
        }

        const result = await matrix.sendMessage(
            req.user.matrix_token,
            check.channel.room_id,
            content,
        );

        return res.json({
            id: result.event_id,
            content,
            created_at: new Date(),
            login: req.user.login,
            channel_id: check.channel.room_id,
        });
    } catch (err) {
        logger.error('message send failed', err);
        return res.status(500).json({ error: 'server error', code: 'INTERNAL' });
    }
});

module.exports = router;
