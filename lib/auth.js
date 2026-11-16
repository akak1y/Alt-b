require('dotenv').config();

const jwt = require('jsonwebtoken');
const { User } = require('../models');

async function auth(req, res, next) {
    const header = req.headers.authorization || '';

    if (!header.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'unauthorized', code: 'UNAUTHORIZED' });
    }

    const token = header.slice(7);

    try {
        const payload = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findByPk(payload.id);

        if (!user) {
            return res.status(401).json({ error: 'user not found', code: 'USER_NOT_FOUND' });
        }

        req.user = {
            id: user.id,
            login: user.login,
            matrix_user_id: user.matrix_user_id,
            matrix_token: user.matrix_token,
        };

        return next();
    } catch {
        return res.status(401).json({ error: 'invalid token', code: 'INVALID_TOKEN' });
    }
}

module.exports = auth;
