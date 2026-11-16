import * as mc from './matrix-client.js';

const { createApp, ref, computed, onMounted, onUnmounted, watch, nextTick } = Vue;

createApp({
    setup() {
        const s = ref(mc.getState());
        const unsub = mc.subscribe((v) => {
            s.value = v;
        });
        onUnmounted(unsub);

        // P1-6: инициализация homeserver из whitelist/URL, флаг подтверждения
        const init = mc.initBaseUrl(new URLSearchParams(window.location.search));
        const baseUrl = ref(init.url);
        const pendingForeign = ref(init.foreign || '');

        const username = ref('');
        const password = ref('');
        const token = ref('');
        const mode = ref('login');
        const busy = ref(false);
        const err = ref('');
        const draft = ref('');
        const messagesBox = ref(null);

        const showCreate = ref(false);
        const newRoomName = ref('');
        const newRoomPublic = ref(false); // P1-7
        const inviteTarget = ref('');

        const active = computed(
            () => s.value.rooms.find((r) => r.roomId === s.value.activeRoomId) || null,
        );
        const joined = computed(() => s.value.rooms.filter((r) => r.membership === 'join'));
        const invited = computed(() => s.value.rooms.filter((r) => r.membership === 'invite'));

        const connLabel = computed(
            () =>
                ({
                    online: 'online',
                    syncing: 'syncing…',
                    reconnecting: 'reconnecting…',
                    offline: 'offline',
                })[s.value.connection] || s.value.connection,
        );

        watch(
            () => active.value?.messages.length,
            () => {
                nextTick(() => {
                    if (messagesBox.value)
                        messagesBox.value.scrollTop = messagesBox.value.scrollHeight;
                });
            },
        );

        function saveHs() {
            const v = baseUrl.value.trim().replace(/\/+$/, '');
            // P1-6: если юзер ввёл адрес вне whitelist — помечаем к подтверждению
            if (!['https://synapse.creatusest.ru'].includes(v)) pendingForeign.value = v;
            else {
                pendingForeign.value = '';
                mc.setBaseUrl(v);
            }
        }

        async function doAuth() {
            // P1-6: явное подтверждение смены сервера ПЕРЕД отправкой логина/пароля
            if (pendingForeign.value) {
                const ok = window.confirm(
                    `Вы подключаетесь к нерозрешённому homeserver: ${pendingForeign.value}\n` +
                        'Логин и пароль будут отправлены туда. Продолжить?',
                );
                if (!ok) return;
                mc.setBaseUrl(pendingForeign.value);
                baseUrl.value = pendingForeign.value;
                pendingForeign.value = '';
            }
            busy.value = true;
            err.value = '';
            try {
                if (mode.value === 'login') {
                    await mc.login({
                        baseUrl: baseUrl.value,
                        username: username.value,
                        password: password.value,
                    });
                } else {
                    await mc.register({
                        baseUrl: baseUrl.value,
                        username: username.value,
                        password: password.value,
                        token: token.value,
                    });
                }
            } catch (e) {
                err.value = e.message || 'auth error';
            } finally {
                busy.value = false;
            }
        }

        function logout() {
            mc.logout();
            username.value = '';
            password.value = '';
            token.value = '';
            err.value = '';
        }
        function select(r) {
            mc.selectRoom(r.roomId);
        }
        function join(r) {
            mc.joinRoom(r.roomId);
        }
        function loadOlder() {
            if (active.value) mc.loadOlder(active.value.roomId);
        }

        async function send() {
            const t = draft.value.trim();
            if (!t || !active.value) return;
            // P1-8: НЕ чистим поле заранее — очистим только после успеха
            try {
                await mc.sendText(active.value.roomId, t);
                draft.value = '';
            } catch (e) {
                err.value = e.message;
                // черновик остаётся в поле
            }
        }

        async function doCreateRoom() {
            const name = newRoomName.value.trim();
            if (!name) return;
            try {
                await mc.createRoom(name, newRoomPublic.value); // P1-7
                newRoomName.value = '';
                newRoomPublic.value = false;
                showCreate.value = false;
            } catch (e) {
                err.value = e.message;
            }
        }

        async function doInvite() {
            const id = inviteTarget.value.trim();
            if (!id || !active.value) return;
            try {
                await mc.inviteUser(active.value.roomId, id);
                inviteTarget.value = '';
            } catch (e) {
                err.value = e.message;
            }
        }

        const fmt = (ts) => (ts ? new Date(ts).toLocaleString() : '');

        // P0-2/P0-3: восстановление сессии при загрузке
        onMounted(async () => {
            const r = await mc.restoreSession();
            if (r === 'restored' || r === 'network') baseUrl.value = mc.getState().baseUrl;
            nextTick(() => {
                if (messagesBox.value) messagesBox.value.scrollTop = messagesBox.value.scrollHeight;
            });
        });

        return {
            s,
            baseUrl,
            username,
            password,
            token,
            mode,
            busy,
            err,
            draft,
            messagesBox,
            showCreate,
            newRoomName,
            newRoomPublic,
            inviteTarget,
            pendingForeign,
            active,
            joined,
            invited,
            connLabel,
            saveHs,
            doAuth,
            logout,
            select,
            join,
            loadOlder,
            send,
            doCreateRoom,
            doInvite,
            fmt,
        };
    },
}).mount('#app');
