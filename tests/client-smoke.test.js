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

    it('на низком экране прокручивает слой помощника, оставляя доступной кнопку закрытия', () => {
        const css = readFileSync('public/css/auth-matrix.css', 'utf8');
        const start = css.indexOf('@media (max-height: 560px)');
        const end = css.indexOf('body.alt-calm .message', start);
        const dom = new JSDOM('<style></style>');
        try {
            dom.window.document.querySelector('style').textContent = css.slice(start, end);
            const [media] = dom.window.document.styleSheets[0].cssRules;
            expect(media.conditionText).toBe('(max-height: 560px)');
            const overlay = [...media.cssRules].find(
                (rule) => rule.selectorText === '.assistant-overlay',
            );
            expect(overlay.style.display).toBe('block');
            expect(overlay.style.getPropertyValue('overflow-y')).toBe('auto');
            const panel = [...media.cssRules].find(
                (rule) => rule.selectorText === '.assistant-overlay .assistant-novel',
            );
            expect(panel.style.height).toBe('540px');
        } finally {
            dom.window.close();
        }
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
            const footer = dom.window.document.querySelector('footer.auth-status');
            expect(footer.querySelector('.auth-status-brand').textContent).toContain('ALT');
            expect(footer.querySelector('.auth-status-mode').textContent).toBe('Matrix');
            expect(footer.querySelector('.auth-status-controls').textContent).toContain('Сбой');
            expect(footer.querySelector('.auth-status-controls').textContent).toContain('Авто');
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

    it('оставляет тёмный фон на устройстве с малым объёмом памяти', async () => {
        const html = readFileSync('public/index.html', 'utf8');
        const bundle = readFileSync('public/js/alt.js', 'utf8');
        const dom = new JSDOM(html, { url: 'http://localhost:3000/', runScripts: 'outside-only' });
        try {
            const { document, navigator } = dom.window;
            Object.defineProperty(navigator, 'deviceMemory', { value: 2 });
            dom.window.CanvasRenderingContext2D = function () {
                throw new Error('Canvas should stay disabled');
            };
            dom.window.eval(bundle);
            const footer = document.querySelector('footer.auth-status');
            expect(footer.querySelector('.auth-status-mode').textContent).toBe('Тёмный фон');
            expect(footer.querySelector('[role="status"]').textContent).toBe('');
            for (const button of footer.querySelectorAll('.auth-status-controls button')) {
                button.click();
                await Promise.resolve();
                expect(footer.querySelector('[role="status"]').textContent).toContain(
                    'мало памяти',
                );
                expect(document.querySelector('#matrix-bg')).toBeNull();
            }
            expect(footer.querySelector('.auth-status-controls').textContent).toContain('Сбой');
            expect(footer.querySelector('.auth-status-controls').textContent).toContain('Авто');
        } finally {
            dom.window.close();
        }
    });

    it('до входа открывает непустые настройки внешнего вида, а не вкладку аккаунта', async () => {
        const dom = new JSDOM(readFileSync('public/index.html', 'utf8'), {
            url: 'http://localhost:3000/',
            runScripts: 'outside-only',
        });
        try {
            dom.window.HTMLDialogElement.prototype.showModal = function () {
                this.setAttribute('open', '');
            };
            dom.window.eval(readFileSync('public/js/alt.js', 'utf8'));
            dom.window.document.querySelector('.auth-rail .rail-menu').click();
            await Promise.resolve();
            const settings = dom.window.document.querySelector('.settings-panel');
            expect(settings.open).toBe(true);
            expect(settings.querySelector('.settings-section h3').textContent).toBe('Внешний вид');
            expect(settings.querySelector('.settings-tabs').textContent).not.toContain('Аккаунт');
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
