const express = require('express');
const { User } = require('../../models');
const auth = require('../../lib/auth');
const matrix = require('../../lib/matrix');
const { badRequest, unauthorized } = require('../../lib/errors');

const router = express.Router();

// Гибрид профиля (архитектурная заметка):
// display_name -> Matrix profile API (нативный источник);
// email / phone и любой будущий кастом (тема, фильтры, макросы, анимации)
// -> users.settings (чёрный ящик). Matrix 3pid требует внешней верификации
// (SMTP/SMS), которой в учебном контуре нет, поэтому email/phone не через 3pid.
// Смена пароля -> Matrix account/password с logout_devices:false, чтобы
// текущий access-токен (и sync-цикл) не отзывался.

const shape = (user, mxProfile) => {
    const s = user.settings || {};
    return {
        login: user.login,
        display_name: mxProfile?.displayname || user.login,
        avatar_url: mxProfile?.avatar_url || null,
        email: s.email || '',
        phone: s.phone || '',
        settings: s,
    };
};

router.get('/', auth, async (req, res, next) => {
    try {
        const [mxProfile, user] = await Promise.all([
            matrix.getProfile(req.user.matrix_token, req.user.matrix_user_id),
            User.findByPk(req.user.id),
        ]);

        return res.json(shape(user, mxProfile));
    } catch (err) {
        return next(err);
    }
});

router.put('/', auth, async (req, res, next) => {
    try {
        const body = req.body || {};
        const displayName = String(body.display_name || '').trim();
        const user = await User.findByPk(req.user.id);

        if (displayName) {
            await matrix.setDisplayName(
                req.user.matrix_token,
                req.user.matrix_user_id,
                displayName,
            );
        }

        const s = { ...(user.settings || {}) };

        if (body.email !== undefined) s.email = String(body.email || '').trim();
        if (body.phone !== undefined) s.phone = String(body.phone || '').trim();
        if (body.settings && typeof body.settings === 'object') Object.assign(s, body.settings);

        user.settings = s;
        await user.save();

        const mxProfile = await matrix.getProfile(req.user.matrix_token, req.user.matrix_user_id);

        return res.json(shape(user, mxProfile));
    } catch (err) {
        return next(err);
    }
});

router.post('/password', auth, async (req, res, next) => {
    try {
        const oldPassword = String(req.body?.old_password || '');
        const newPassword = String(req.body?.new_password || '');

        if (!oldPassword || !newPassword) throw badRequest('old and new password required');
        if (newPassword.length < 8) throw badRequest('new password must be at least 8 characters');

        await matrix.changePassword(req.user.matrix_token, {
            localUser: matrix.localpart(req.user.matrix_user_id),
            oldPassword,
            newPassword,
        });

        return res.json({ ok: true });
    } catch (err) {
        if (err.matrix?.errcode === 'M_FORBIDDEN' || err.status === 401) {
            return next(unauthorized('invalid current password'));
        }
        return next(err);
    }
});

module.exports = router;
