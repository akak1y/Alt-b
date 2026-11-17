import { ref, computed, onUnmounted, nextTick } from 'vue';

export const isRegistrationUsername = (name) => /^[a-z0-9._=+/-]+$/.test(name);

// Окно использует только пользовательскую сессию. Административный ключ
// существует исключительно в lib/invitations.js на сервере.
export function useInvitations(request) {
    const invitationsOpen = ref(false);
    const invitationsBusy = ref(false);
    const invitationsError = ref('');
    const invitationsNotice = ref('');
    const invitations = ref([]);
    const invitationHours = ref(24);
    const invitationUses = ref(1);
    const invitationUsername = ref('');
    let createdUsername = '';
    const invitationFilter = ref('active');
    const createdInvitation = ref(null);
    const invitationClose = ref(null);
    const clock = ref(Date.now());
    let offset = 0;
    let timer;
    let opener;
    let generation = 0;

    function invitationStatus(item) {
        if (item.uses_allowed === 0) return 'invalid';
        if (item.expiry_time !== null && item.expiry_time <= clock.value) return 'expired';
        if (item.uses_allowed !== null && item.completed + item.pending >= item.uses_allowed)
            return 'exhausted';
        return 'active';
    }
    const invitationStatusLabel = (item) =>
        ({
            active: 'Активно',
            expired: 'Истекло',
            exhausted: 'Лимит использован',
            invalid: 'Недействительно',
        })[invitationStatus(item)];
    const visibleInvitations = computed(() =>
        invitations.value.filter(
            (item) =>
                (invitationStatus(item) === 'active') === (invitationFilter.value === 'active'),
        ),
    );
    const invitationExpiry = (item) =>
        item.expiry_time === null ? 'Без срока' : new Date(item.expiry_time).toLocaleString();

    async function action(fn) {
        if (invitationsBusy.value) return;
        const current = generation;
        invitationsBusy.value = true;
        invitationsError.value = '';
        invitationsNotice.value = '';
        try {
            await fn(() => current === generation);
        } catch (error) {
            if (current === generation) invitationsError.value = error.message;
        } finally {
            if (current === generation) invitationsBusy.value = false;
        }
    }
    async function loadInvitations() {
        await action(async (valid) => {
            const data = await request('/api/invitations');
            if (!valid()) return;
            offset = data.server_time - Date.now();
            clock.value = data.server_time;
            invitations.value = data.invitations;
            if (createdInvitation.value)
                createdInvitation.value =
                    data.invitations.find((item) => item.token === createdInvitation.value.token) ||
                    null;
        });
    }
    async function openInvitations() {
        opener = document.activeElement;
        invitationsOpen.value = true;
        timer = setInterval(() => {
            clock.value = Date.now() + offset;
        }, 1000);
        await nextTick();
        invitationClose.value?.focus();
        await loadInvitations();
    }
    function closeInvitations() {
        generation += 1;
        clearInterval(timer);
        invitationsOpen.value = false;
        invitationsBusy.value = false;
        invitations.value = [];
        createdInvitation.value = null;
        createdUsername = '';
        invitationUsername.value = '';
        invitationsError.value = '';
        invitationsNotice.value = '';
        opener?.focus();
    }
    onUnmounted(() => clearInterval(timer));

    async function createInvitation() {
        await action(async (valid) => {
            const username = invitationUses.value === 1 ? invitationUsername.value.trim() : '';
            if (username && !isRegistrationUsername(username))
                throw new Error('Введите допустимый логин для личного приглашения.');
            const data = await request('/api/invitations', {
                method: 'POST',
                body: JSON.stringify({ hours: invitationHours.value, uses: invitationUses.value }),
            });
            if (!valid()) return;
            createdUsername = username;
            createdInvitation.value = data.invitation;
            invitationUsername.value = '';
            invitations.value = [data.invitation, ...invitations.value];
            invitationFilter.value = 'active';
        });
    }
    function invitationLink(item) {
        if (!createdUsername || item.token !== createdInvitation.value?.token) return item.link;
        const link = new URL(item.link);
        link.hash = new URLSearchParams({ registration_username: createdUsername }).toString();
        return link.href;
    }
    async function revokeInvitation(item) {
        await action(async (valid) => {
            const data = await request(
                `/api/invitations/${encodeURIComponent(item.token)}/revoke`,
                { method: 'POST', body: '{}' },
            );
            if (!valid()) return;
            invitations.value = invitations.value.map((entry) =>
                entry.token === item.token ? data.invitation : entry,
            );
            if (createdInvitation.value?.token === item.token)
                createdInvitation.value = data.invitation;
            invitationsNotice.value =
                'Приглашение отозвано. Оно сохранено в списке недействительных.';
        });
    }
    async function copyInvitation(item) {
        await action(async (valid) => {
            // Перед копированием проверяем актуальность, в том числе pending
            // и отзыв из другого административного инструмента.
            const data = await request(`/api/invitations/${encodeURIComponent(item.token)}`);
            if (!valid()) return;
            invitations.value = invitations.value.map((entry) =>
                entry.token === item.token ? data.invitation : entry,
            );
            if (createdInvitation.value?.token === item.token)
                createdInvitation.value = data.invitation;
            if (
                data.invitation.status !== 'active' ||
                invitationStatus(data.invitation) !== 'active'
            )
                throw new Error('Приглашение уже недействительно. Обновите список.');
            try {
                await navigator.clipboard.writeText(invitationLink(data.invitation));
            } catch {
                throw new Error('Браузер не разрешил копирование. Выделите ссылку вручную.');
            }
            if (valid()) invitationsNotice.value = 'Ссылка скопирована.';
        });
    }
    // Удерживаем клавиатурный фокус внутри открытого окна.
    function invitationKeys(event) {
        if (event.key === 'Escape') {
            event.preventDefault();
            closeInvitations();
        }
        if (event.key !== 'Tab') return;
        const controls = [
            ...event.currentTarget.querySelectorAll('button:not(:disabled), input, select, [href]'),
        ];
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
        }
    }
    return {
        invitationsOpen,
        invitationsBusy,
        invitationsError,
        invitationsNotice,
        invitationHours,
        invitationUses,
        invitationUsername,
        invitationLink,
        invitationFilter,
        createdInvitation,
        invitationClose,
        visibleInvitations,
        invitationStatus,
        invitationStatusLabel,
        invitationExpiry,
        openInvitations,
        closeInvitations,
        loadInvitations,
        createInvitation,
        revokeInvitation,
        copyInvitation,
        invitationKeys,
    };
}
