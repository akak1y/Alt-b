// @vitest-environment jsdom
import { createApp, effectScope, h, nextTick, ref } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useProfileName } from '../public/js/profile-settings.js';
import { useAssistantFocus, shouldAnimateAssistant } from '../public/js/assistant-focus.js';
import { useSnakeControls } from '../public/js/snake-game.js';
import { settingsTabForPage } from '../public/js/settings-tabs.js';

const scopes = [];
const apps = [];
afterEach(() => {
    scopes.splice(0).forEach((scope) => scope.stop());
    apps.splice(0).forEach(({ app, root }) => {
        app.unmount();
        root.remove();
    });
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

function profile(initial, save) {
    const scope = effectScope();
    scopes.push(scope);
    const state = ref(initial);
    const controls = scope.run(() => useProfileName(state, save));
    return { state, ...controls };
}

describe('настройки', () => {
    it('показывает внешний вид до входа, аккаунт после входа и сохраняет остальные разделы', () => {
        expect(settingsTabForPage('menu', 'idle')).toBe('appearance');
        expect(settingsTabForPage('menu', 'syncing')).toBe('appearance');
        expect(settingsTabForPage('menu', 'ready')).toBe('account');
        expect(settingsTabForPage('news', 'idle')).toBe('news');
        expect(settingsTabForPage('team', 'ready')).toBe('team');
    });
});

describe('редактирование никнейма', () => {
    it('при смене ID сбрасывает черновик и ошибку, затем сохраняет имя только нового пользователя', async () => {
        const save = vi.fn(async () => {});
        const ui = profile({ myUserId: '@first:matrix', myName: 'Первый' }, save);
        ui.nicknameDraft.value = 'Несохранённое имя';
        ui.nicknameError.value = 'Сетевая ошибка';
        ui.state.value = { myUserId: '@second:matrix', myName: 'Второй' };
        await nextTick();
        expect(ui.nicknameDraft.value).toBe('Второй');
        expect(ui.nicknameError.value).toBe('');
        await ui.saveNickname();
        expect(save).toHaveBeenCalledTimes(1);
        expect(save).toHaveBeenCalledWith('Второй');
    });

    it('не затирает введённый текст при обычной синхронизации, но принимает запоздавшее имя нового ID', async () => {
        const ui = profile({ myUserId: '@first:matrix', myName: '' }, vi.fn());
        ui.state.value = { myUserId: '@second:matrix', myName: '' };
        await nextTick();
        expect(ui.nicknameDraft.value).toBe('@second:matrix');
        ui.state.value = { myUserId: '@second:matrix', myName: 'С сервера' };
        await nextTick();
        expect(ui.nicknameDraft.value).toBe('С сервера');
        ui.nicknameDraft.value = 'Мой черновик';
        ui.state.value = { myUserId: '@second:matrix', myName: 'Новое имя на сервере' };
        await nextTick();
        expect(ui.nicknameDraft.value).toBe('Мой черновик');
    });

    it('не отправляет имя старого пользователя при смене аккаунта до обработки подписки', async () => {
        const save = vi.fn();
        const ui = profile({ myUserId: '@first:matrix', myName: 'Первый' }, save);
        ui.state.value = { myUserId: '@second:matrix', myName: 'Второй' };
        await ui.saveNickname();
        expect(save).not.toHaveBeenCalled();
        await nextTick();
        expect(ui.nicknameDraft.value).toBe('Второй');
    });

    it('не возвращает старую ошибку и имя после ответа от прежней сессии', async () => {
        let fail;
        const ui = profile(
            { myUserId: '@first:matrix', myName: 'Первый' },
            () =>
                new Promise((resolve, reject) => {
                    fail = reject;
                }),
        );
        const pending = ui.saveNickname();
        expect(ui.nicknameBusy.value).toBe(true);
        ui.state.value = { myUserId: '@second:matrix', myName: 'Второй' };
        await nextTick();
        fail(new Error('Ошибка старой сессии'));
        await pending;
        expect(ui.nicknameDraft.value).toBe('Второй');
        expect(ui.nicknameBusy.value).toBe(false);
        expect(ui.nicknameError.value).toBe('');
    });
});

describe('помощник с клавиатуры', () => {
    function mountAssistant() {
        const root = globalThis.document.createElement('div');
        globalThis.document.body.append(root);
        let ui;
        const app = createApp({
            setup() {
                ui = useAssistantFocus(vi.fn());
                return () =>
                    h('div', [
                        h('button', { id: 'opener', onClick: ui.openAssistantDialog }, 'Открыть'),
                        ui.assistantOpen.value
                            ? h(
                                  'section',
                                  { ref: ui.assistantDialog, onKeydown: ui.assistantKeys },
                                  [
                                      h(
                                          'button',
                                          { id: 'first', onClick: ui.closeAssistantDialog },
                                          'Закрыть',
                                      ),
                                      h('button', { id: 'last' }, 'Далее'),
                                  ],
                              )
                            : null,
                        h('button', { id: 'outside' }, 'Вне окна'),
                    ]);
            },
        });
        app.mount(root);
        apps.push({ app, root });
        return { root, ui };
    }

    it('переносит и удерживает фокус, закрывается по Escape и возвращает фокус', async () => {
        const { root, ui } = mountAssistant();
        root.querySelector('#opener').focus();
        root.querySelector('#opener').click();
        await nextTick();
        expect(globalThis.document.activeElement.id).toBe('first');
        root.querySelector('#last').focus();
        root.querySelector('#last').dispatchEvent(
            new globalThis.KeyboardEvent('keydown', {
                key: 'Tab',
                bubbles: true,
                cancelable: true,
            }),
        );
        expect(globalThis.document.activeElement.id).toBe('first');
        root.querySelector('#first').dispatchEvent(
            new globalThis.KeyboardEvent('keydown', {
                key: 'Tab',
                shiftKey: true,
                bubbles: true,
                cancelable: true,
            }),
        );
        expect(globalThis.document.activeElement.id).toBe('last');
        root.querySelector('#outside').focus();
        expect(globalThis.document.activeElement.id).toBe('first');
        root.querySelector('#first').dispatchEvent(
            new globalThis.KeyboardEvent('keydown', {
                key: 'Escape',
                bubbles: true,
                cancelable: true,
            }),
        );
        await nextTick();
        expect(ui.assistantOpen.value).toBe(false);
        expect(globalThis.document.activeElement.id).toBe('opener');
    });

    it('не запускает декоративное движение при системном ограничении', () => {
        vi.stubGlobal(
            'matchMedia',
            vi.fn(() => ({ matches: true })),
        );
        expect(shouldAnimateAssistant()).toBe(false);
        vi.stubGlobal(
            'matchMedia',
            vi.fn(() => ({ matches: false })),
        );
        expect(shouldAnimateAssistant()).toBe(true);
    });
});

describe('состояние змейки', () => {
    it('запускает и перезапускает один таймер, останавливается вручную, при столкновении и закрытии', async () => {
        vi.useFakeTimers();
        const canvas = {
            width: 360,
            height: 360,
            getContext: () => ({
                fillRect() {},
                beginPath() {},
                moveTo() {},
                lineTo() {},
                stroke() {},
            }),
        };
        const ui = useSnakeControls(ref(canvas));
        ui.startSnake();
        expect(ui.snakeRunning.value).toBe(true);
        expect(vi.getTimerCount()).toBe(1);
        await vi.advanceTimersByTimeAsync(110);
        expect(ui.snakeScore.value).toBe(0);
        ui.startSnake();
        expect(ui.snakeRunning.value).toBe(true);
        expect(vi.getTimerCount()).toBe(1);
        ui.stopSnake();
        expect(ui.snakeRunning.value).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
        ui.startSnake();
        await vi.advanceTimersByTimeAsync(9 * 110);
        expect(ui.snakeRunning.value).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
        ui.startSnake();
        ui.snakeGame.destroy(); // Закрытие помощника / удаление компонента.
        expect(ui.snakeRunning.value).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });
});
