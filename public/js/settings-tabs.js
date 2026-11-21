// Незарегистрированному посетителю доступны настройки внешнего вида,
// но вкладка аккаунта появляется только после подключения Matrix.
export function settingsTabForPage(page, phase) {
    if (['about', 'team', 'news'].includes(page)) return page;
    return phase === 'ready' ? 'account' : 'appearance';
}
