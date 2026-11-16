import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';

describe('собранный веб-клиент', () => {
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
            expect(dom.window.document.querySelector('.auth-box .primary').textContent).toBe(
                'Войти',
            );
            expect(dom.window.document.querySelector('.auth-box .err')).toBeNull();
            expect(dom.window.document.querySelector('.auth-box').textContent).not.toContain(
                'Сервер:',
            );
            expect(dom.window.document.querySelector('.hs-line')).toBeNull();
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
            expect(dom.window.document.querySelector('.auth-box .primary').textContent).toBe(
                'Зарегистрироваться',
            );
            expect(
                dom.window.document.querySelector('input[placeholder="registration token"]').value,
            ).toBe('CODE');
            expect(dom.window.location.search).toBe('?other=1');
        } finally {
            dom.window.close();
        }
    });
});
