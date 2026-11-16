const path = require('node:path');
const express = require('express');

const app = express();

// Сохраняем ограничения браузера: клиент обращается к Synapse напрямую.
const ALLOWED_CONNECT = [
    "'self'",
    'https://synapse.creatusest.ru',
    'http://localhost:8008',
    'http://localhost:3000',
];
const ALLOWED_SCRIPT = ["'self'"];

app.use((req, res, next) => {
    res.setHeader(
        'Content-Security-Policy',
        [
            "default-src 'self'",
            `script-src ${ALLOWED_SCRIPT.join(' ')}`,
            `connect-src ${ALLOWED_CONNECT.join(' ')}`,
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data:",
            "frame-ancestors 'none'",
            "base-uri 'self'",
            "form-action 'self'",
        ].join('; '),
    );
    next();
});

app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res) => res.status(404).send('Not found'));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Alt client at http://localhost:${port}`));
