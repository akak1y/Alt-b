import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';

describe('собранный веб-клиент', () => {
    it('размещает WebAssembly Rust Crypto рядом с бандлом', () => {
        const wasm = readFileSync('public/js/pkg/matrix_sdk_crypto_wasm_bg.wasm');
        expect(WebAssembly.validate(wasm)).toBe(true);
    });

    it('оформляет существующие части интерфейса и узкие экраны', () => {
        const css = readFileSync('public/css/style.css', 'utf8');
        const authCss = readFileSync('public/css/auth-matrix.css', 'utf8');
        expect(authCss).toContain('.auth-box');
        expect(readFileSync('public/index.html', 'utf8')).toContain('/css/auth-matrix.css');
        for (const selector of [
            '.chat-app',
            '.sidebar',
            '.channel-item',
            '.chat-header',
            '.messages-area',
            '.message.sent',
            '.message.received',
            '.chat-input-area',
            '.invite-row',
        ]) {
            expect(css).toContain(selector);
        }
        expect(css).toContain('backdrop-filter: blur(');
        expect(css).toContain('@media (max-width: 700px)');
        expect(css).toContain('prefers-reduced-motion: reduce');
        expect(css).toContain('background-size: 32px 32px');
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
            expect(
                Array.from(dom.window.document.querySelectorAll('.auth-rail button'), (button) =>
                    button.textContent.trim(),
                ).slice(0, 2),
            ).toEqual(['О проекте', 'Разработка']);
            expect(dom.window.document.querySelector('.settings-links')).toBeNull();
            expect(dom.window.document.querySelector('.rail-fx').textContent).toContain('Сбой');
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

    it('по личной ссылке показывает только поле пароля в выбранной регистрации', () => {
        const html = readFileSync('public/index.html', 'utf8');
        const bundle = readFileSync('public/js/alt.js', 'utf8');
        const dom = new JSDOM(html, {
            url: 'http://localhost:3000/?registration_token=CODE#registration_username=alice',
            runScripts: 'outside-only',
        });
        try {
            dom.window.eval(bundle);
            const { document, location } = dom.window;
            expect(document.querySelector('.auth-choice button:last-child').ariaPressed).toBe(
                'true',
            );
            expect(document.querySelector('.personal-invitation strong').textContent).toBe('alice');
            expect(
                Array.from(document.querySelectorAll('.auth-register input'), (i) => i.type),
            ).toEqual(['password']);
            expect(location.search + location.hash).toBe('');
        } finally {
            dom.window.close();
        }
    });
});
