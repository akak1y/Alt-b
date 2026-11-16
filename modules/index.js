const auth = require('./auth/routes');
const spaces = require('./spaces/routes');
const channels = require('./channels/routes');
const profile = require('./profile/routes');

// Новый модуль = новая папка + одна строка здесь. Ядро (server.js) не трогаем.
module.exports = [
    { name: 'auth', router: auth },
    { name: 'spaces', router: spaces },
    { name: 'channels', router: channels },
    { name: 'profile', router: profile },
];
