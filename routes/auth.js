require('dotenv').config();

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User } = require('../models');

const router = express.Router();

router.post('/register', async (req, res) => {
    try {
        const login = String(req.body?.login || '').trim();
        const password = String(req.body?.password || '');

        if (!login || !password) {
            return res.status(400).json({ error: 'login and password required' });
        }

        if (login.length < 3) {
            return res.status(400).json({ error: 'login too short' });
        }

        if (login.length > 32) {
            return res.status(400).json({ error: 'login too long' });
        }

        if (password.length < 6) {
            return res.status(400).json({ error: 'password too short' });
        }

        const existingUser = await User.findOne({ where: { login } });

        if (existingUser) {
            return res.status(409).json({ error: 'login already exists' });
        }

        const passwordHash = await bcrypt.hash(password, 10);

        const user = await User.create({
            login,
            password_hash: passwordHash,
        });

        const token = jwt.sign(
            {
                id: user.id,
                login: user.login,
            },
            process.env.JWT_SECRET,
            { expiresIn: '7d' },
        );

        return res.json({
            token,
            user: {
                id: user.id,
                login: user.login,
            },
        });
    } catch (err) {
        if (err.name === 'SequelizeUniqueConstraintError') {
            return res.status(409).json({ error: 'login already exists' });
        }

        console.error(err);
        return res.status(500).json({ error: 'server error' });
    }
});

router.post('/login', async (req, res) => {
    try {
        const login = String(req.body?.login || '').trim();
        const password = String(req.body?.password || '');

        if (!login || !password) {
            return res.status(400).json({ error: 'login and password required' });
        }

        const user = await User.findOne({ where: { login } });

        if (!user) {
            return res.status(401).json({ error: 'invalid credentials' });
        }

        const ok = await bcrypt.compare(password, user.password_hash);

        if (!ok) {
            return res.status(401).json({ error: 'invalid credentials' });
        }

        const token = jwt.sign(
            {
                id: user.id,
                login: user.login,
            },
            process.env.JWT_SECRET,
            { expiresIn: '7d' },
        );

        return res.json({
            token,
            user: {
                id: user.id,
                login: user.login,
            },
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'server error' });
    }
});

module.exports = router;
