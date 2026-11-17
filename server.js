const path = require('node:path');
const express = require('express');
const { createInvitationsRouter } = require('./lib/invitations');

// Сервер Alt раздаёт готовые файлы из public/; вход и переписка выполняются
// в браузере напрямую через Synapse. Только управление регистрационными
// приглашениями проходит через защищённый серверный API.
const app = express();

// Сохраняем ограничения браузера: клиент обращается к Synapse напрямую.
const ALLOWED_CONNECT = [
    "'self'",
    'https://synapse.creatusest.ru',
    'http://localhost:8008',
    'http://localhost:3000',
];
const ALLOWED_SCRIPT = ["'self'"];

// На каждый ответ накладываем ограничения браузера: свои скрипты/шрифты,
// соединение только с разрешёнными адресами и запрет встраивания в iframe.
app.use((req, res, next) => {
    res.setHeader(
        'Content-Security-Policy',
        [
            "default-src 'self'",
            `script-src ${ALLOWED_SCRIPT.join(' ')}`,
            `connect-src ${ALLOWED_CONNECT.join(' ')}`,
            "style-src 'self' 'unsafe-inline'",
            "font-src 'self'",
            "img-src 'self' data:",
            "frame-ancestors 'none'",
            "base-uri 'self'",
            "form-action 'self'",
        ].join('; '),
    );
    next();
});

app.use('/api/invitations', createInvitationsRouter());

// Отдаём index.html, стили, изображения и собранный public/js/alt.js.
app.use(express.static(path.join(__dirname, 'public')));
// Если файла нет, возвращаем 404 вместо страницы клиента.
app.use((req, res) => res.status(404).send('Not found'));

// PORT задаёт порт запуска; без него используется 3000 (обычно за Caddy).
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Alt client at http://localhost:${port}`));
