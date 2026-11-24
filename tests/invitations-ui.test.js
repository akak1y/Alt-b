// @vitest-environment jsdom
import { createApp, h, nextTick } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useInvitations } from '../public/js/invitations.js';

const apps = [];
const item = (extra = {}) => ({
    token: 'CODE',
    link: 'https://alt.creatusest.ru/?registration_token=CODE',
    status: 'active',
    uses_allowed: 1,
    completed: 0,
    pending: 0,
    expiry_time: Date.now() + 60_000,
    ...extra,
});
function mount(request) {
    let manager;
    const root = globalThis.document.createElement('div');
    globalThis.document.body.append(root);
    const app = createApp({
        setup() {
            manager = useInvitations(request);
            return () => h('div');
        },
    });
    app.mount(root);
    apps.push({ app, root });
    return manager;
}
afterEach(() => {
    for (const { app, root } of apps.splice(0)) {
        app.unmount();
        root.remove();
    }
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('окно регистрационных приглашений', () => {
    it('использует значения по умолчанию, создаёт ссылку и переносит отзыв в недействительные', async () => {
        const request = vi
            .fn()
            .mockResolvedValueOnce({
                invitations: [item({ token: 'OLD', expiry_time: Date.now() - 1 })],
                server_time: Date.now(),
            })
            .mockResolvedValueOnce({ invitation: item() })
            .mockResolvedValueOnce({ invitation: item({ uses_allowed: 0, status: 'invalid' }) });
        const ui = mount(request);
        await ui.openInvitations();
        expect(ui.invitationHours.value).toBe(24);
        expect(ui.invitationUses.value).toBe(1);
        expect(ui.visibleInvitations.value).toHaveLength(0);
        await ui.createInvitation();
        expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({ hours: 24, uses: 1 });
        expect(ui.createdInvitation.value.link).toContain('registration_token=CODE');
        expect(ui.visibleInvitations.value).toHaveLength(1);
        await ui.revokeInvitation(ui.createdInvitation.value);
        expect(ui.visibleInvitations.value).toHaveLength(0);
        ui.invitationFilter.value = 'invalid';
        expect(ui.visibleInvitations.value).toHaveLength(2);
        expect(ui.invitationStatus(ui.createdInvitation.value)).toBe('invalid');
        ui.closeInvitations();
        expect(ui.createdInvitation.value).toBeNull();
    });
    it('истечение срока обновляется без перезагрузки страницы', async () => {
        vi.useFakeTimers();
        const ui = mount(async () => ({
            invitations: [item({ expiry_time: Date.now() + 1000 })],
            server_time: Date.now(),
        }));
        await ui.openInvitations();
        expect(ui.visibleInvitations.value).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(2000);
        expect(ui.visibleInvitations.value).toHaveLength(0);
        ui.invitationFilter.value = 'invalid';
        expect(ui.invitationStatusLabel(ui.visibleInvitations.value[0])).toBe('Истекло');
    });
    it('перед копированием проверяет отзыв и не копирует недействительный код', async () => {
        const writeText = vi.fn();
        vi.stubGlobal('navigator', { clipboard: { writeText } });
        const ui = mount(async () => ({
            invitation: item({ uses_allowed: 0, status: 'invalid' }),
        }));
        await ui.copyInvitation(item());
        expect(writeText).not.toHaveBeenCalled();
        expect(ui.invitationsError.value).toContain('недействительно');
    });
    it('копирует только подтверждённое действующее приглашение', async () => {
        const writeText = vi.fn(async () => {});
        vi.stubGlobal('navigator', { clipboard: { writeText } });
        const ui = mount(async () => ({ invitation: item() }));
        await ui.copyInvitation(item());
        expect(writeText).toHaveBeenCalledWith(item().link);
        expect(ui.invitationsNotice.value).toBe('Ссылка скопирована.');
    });
    it('добавляет логин к личной ссылке на клиенте и сохраняет проверку статуса', async () => {
        const writeText = vi.fn(async () => {});
        vi.stubGlobal('navigator', { clipboard: { writeText } });
        const request = vi.fn(async () => ({ invitation: item() }));
        const ui = mount(request);
        ui.invitationUsername.value = 'alice';
        await ui.createInvitation();
        expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ hours: 24, uses: 1 });
        await ui.copyInvitation(ui.createdInvitation.value);
        expect(request).toHaveBeenLastCalledWith('/api/invitations/CODE');
        const link = new URL(writeText.mock.calls[0][0]);
        expect(link.searchParams.get('registration_token')).toBe('CODE');
        expect(link.hash).toBe('#registration_username=alice');
    });
    it('показывает отказ в правах и позволяет закрыть окно', async () => {
        const ui = mount(async () => {
            throw new Error('У вас нет права управлять приглашениями.');
        });
        await ui.openInvitations();
        expect(ui.invitationsError.value).toContain('нет права');
        expect(ui.invitationsBusy.value).toBe(false);
        ui.closeInvitations();
        expect(ui.invitationsOpen.value).toBe(false);
    });
    it('закрытие окна не даёт позднему ответу вернуть список и ссылки', async () => {
        let finish;
        const ui = mount(
            () =>
                new Promise((resolve) => {
                    finish = resolve;
                }),
        );
        const opening = ui.openInvitations();
        await nextTick();
        ui.closeInvitations();
        finish({ invitations: [item()], server_time: Date.now() });
        await opening;
        expect(ui.visibleInvitations.value).toHaveLength(0);
        expect(ui.invitationsOpen.value).toBe(false);
    });
});
