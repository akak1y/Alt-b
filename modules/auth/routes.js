require('dotenv').config();

const express = require('express');
const jwt = require('jsonwebtoken');
const { User } = require('../../models');
const matrix = require('../../lib/matrix');
const logger = require('../../lib/logger');

const router = express.Router();

const LOGIN_RE = /^[a-zA-Z0-9._-]{3,32}$/;

router.post('/register', async (req, res) => {
    try {
        const login = String(req.body?.login || '').trim();
        const password = String(req.body?.password || '');

        if (!login || !password) {
            return res
                .status(400)
                .json({ error: 'login and password required', code: 'BAD_REQUEST' });
        }

        if (!LOGIN_RE.test(login)) {
            return res
                .status(400)
                .json({ error: 'invalid login (a-z, 0-9, . _ -)', code: 'BAD_REQUEST' });
        }

        if (password.length < 8) {
            return res
                .status(400)
                .json({ error: 'password must be at least 8 characters', code: 'BAD_REQUEST' });
        }

        const existing = await User.findOne({ where: { login } });

        if (existing) {
            return res.status(409).json({ error: 'login already exists', code: 'CONFLICT' });
        }

        const reg = await matrix.registerUser(
            login.toLowerCase(),
            password,
            process.env.MATRIX_REG_TOKEN,
        );

        const user = await User.create({
            login,
            matrix_user_id: reg.user_id,
            matrix_token: reg.access_token,
            settings: {},
        });

        const token = jwt.sign({ id: user.id, login }, process.env.JWT_SECRET, { expiresIn: '7d' });

        return res.json({ token, user: { id: user.id, login } });
    } catch (err) {
        if (err.matrix?.errcode === 'M_USER_IN_USE') {
            return res.status(409).json({ error: 'login already exists', code: 'CONFLICT' });
        }

        logger.error('register failed', err);
        return res.status(500).json({ error: 'server error', code: 'INTERNAL' });
    }
});

router.post('/login', async (req, res) => {
    try {
        const login = String(req.body?.login || '').trim();
        const password = String(req.body?.password || '');

        if (!login || !password) {
            return res
                .status(400)
                .json({ error: 'login and password required', code: 'BAD_REQUEST' });
        }

        const user = await User.findOne({ where: { login } });

        if (!user) {
            return res.status(401).json({ error: 'invalid credentials', code: 'UNAUTHORIZED' });
        }

        const log = await matrix.loginUser(login.toLowerCase(), password);

        user.matrix_token = log.access_token;
        await user.save();

        const token = jwt.sign({ id: user.id, login }, process.env.JWT_SECRET, { expiresIn: '7d' });

        return res.json({ token, user: { id: user.id, login } });
    } catch (err) {
        if (err.matrix?.errcode === 'M_FORBIDDEN') {
            return res.status(401).json({ error: 'invalid credentials', code: 'UNAUTHORIZED' });
        }

        logger.error('login failed', err);
        return res.status(500).json({ error: 'server error', code: 'INTERNAL' });
    }
});

module.exports = router;
