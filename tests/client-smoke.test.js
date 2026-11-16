import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';

describe('собранный веб-клиент', () => {
    it('оформляет существующие части интерфейса и узкие экраны', () => {
        const css = readFileSync('public/css/style.css', 'utf8');
        for (const selector of [
            '.auth-box',
            '.chat-app',
            '.sidebar',
            '.channel-item',
            '.chat-header',
            '.messages-area',
            '.message.sent',
            '.message.received',
            '.chat-input-area',
            '.invite-row',
            '.assistant-panel',
            '.section-toggle',
        ]) {
            expect(css).toContain(selector);
        }
        expect(css).toContain('backdrop-filter: blur(');
        expect(css).toContain('@media (max-width: 700px)');
        expect(css).toContain('prefers-reduced-motion: reduce');
        expect(css).toContain('background-size: 28px 28px');
        expect(css).toContain("url('/fonts/share-tech-mono.ttf')");
        expect(statSync('public/fonts/share-tech-mono.ttf').size).toBeGreaterThan(0);
        expect(statSync('public/assets/alt-logo.png').size).toBeGreaterThan(0);
        expect(statSync('public/assets/skull.png').size).toBeGreaterThan(0);
    });

    it('запускает Vue и показывает форму входа', () => {
        const html = readFileSync('public/index.html', 'utf8');
        const bundle = readFileSync('public/js/alt.js', 'utf8');
        const dom = new JSDOM(html, {
            url: 'http://localhost:3000/',
            runScripts: 'outside-only',
        });
        try {
            dom.window.eval(bundle);
            expect(dom.window.document.querySelector('#app .auth-box')).not.toBeNull();
            expect(dom.window.document.querySelector('.auth-logo').getAttribute('src')).toBe(
                '/assets/alt-logo.png',
            );
            expect(dom.window.document.querySelector('.auth-box h2').textContent).toBe('Вход');
            expect(dom.window.document.querySelector('.auth-box .primary').textContent).toBe(
                'ВХОД',
            );
            expect(dom.window.document.querySelector('.auth-panel .err')).toBeNull();
            expect(dom.window.document.querySelector('.auth-box').tagName).toBe('FORM');
            expect(dom.window.document.querySelectorAll('.auth-box')).toHaveLength(2);
            expect(dom.window.document.querySelector('.auth-box .primary').type).toBe('submit');
            expect(dom.window.document.querySelector('label[for="auth-password"]')).not.toBeNull();
            expect(dom.window.document.querySelector('.auth-panel').textContent).not.toContain(
                'Сервер:',
            );
            expect(dom.window.document.querySelector('.hs-line')).toBeNull();
            const login = dom.window.document.querySelector('#auth-username');
            const register = dom.window.document.querySelector('#register-username');
            login.value = 'alice';
            login.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
            expect(register.value).toBe('');
        } finally {
            dom.window.close();
        }
    });

    it('открывает регистрацию по ссылке с кодом, не оставляя код в адресной строке', () => {
        const html = readFileSync('public/index.html', 'utf8');
        const bundle = readFileSync('public/js/alt.js', 'utf8');
        const dom = new JSDOM(html, {
            url: 'http://localhost:3000/?registration_token=CODE&other=1',
            runScripts: 'outside-only',
        });
        try {
            dom.window.eval(bundle);
            expect(dom.window.document.querySelector('.auth-register .primary').textContent).toBe(
                'РЕГИСТРАЦИЯ',
            );
            expect(dom.window.document.querySelector('#auth-token').value).toBe('CODE');
            expect(dom.window.location.search).toBe('?other=1');
        } finally {
            dom.window.close();
        }
    });
});
