import { createApp, ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { render } from 'alt-template';
import * as mc from './matrix-client.js';

createApp({
    render,
    setup() {
        const s = ref(mc.getState());
        const unsub = mc.subscribe((v) => {
            s.value = v;
        });
        onUnmounted(unsub);

        const username = ref('');
        const password = ref('');
        const registerUsername = ref('');
        const registerPassword = ref('');
        const logoFailed = ref(false);
        const inviteUrl = new URL(window.location.href);
        const invitation =
            inviteUrl.searchParams.get('registration_token') || inviteUrl.searchParams.get('token');
        const token = ref(invitation || '');
        if (invitation) {
            inviteUrl.searchParams.delete('registration_token');
            inviteUrl.searchParams.delete('token');
            // Не оставляем код приглашения в адресной строке и истории браузера.
            window.history.replaceState(null, '', inviteUrl);
        }
        const busy = ref(false);
        const err = ref('');
        const draft = ref('');
        const messagesBox = ref(null);

        const showCreate = ref(false);
        const newRoomName = ref('');
        const newRoomPublic = ref(false);
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

        async function doAuth(kind) {
            if (busy.value) return;
            busy.value = true;
            err.value = '';
            try {
                if (kind === 'login') {
                    await mc.login({ username: username.value, password: password.value });
                } else {
                    await mc.register({
                        username: registerUsername.value,
                        password: registerPassword.value,
                        token: token.value,
                    });
                }
            } catch (e) {
                err.value = e.message || 'auth error';
            } finally {
                busy.value = false;
            }
        }

        const doLogin = () => doAuth('login');
        const doRegister = () => doAuth('register');

        function logout() {
            mc.logout();
            username.value = '';
            password.value = '';
            registerUsername.value = '';
            registerPassword.value = '';
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
            try {
                await mc.sendText(active.value.roomId, t);
                draft.value = '';
            } catch (e) {
                err.value = e.message;
            }
        }

        async function doCreateRoom() {
            const name = newRoomName.value.trim();
            if (!name) return;
            try {
                await mc.createRoom(name, newRoomPublic.value);
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

        onMounted(async () => {
            await mc.restoreSession();
            nextTick(() => {
                if (messagesBox.value) messagesBox.value.scrollTop = messagesBox.value.scrollHeight;
            });
        });

        return {
            s,
            username,
            password,
            registerUsername,
            registerPassword,
            logoFailed,
            token,
            busy,
            err,
            draft,
            messagesBox,
            showCreate,
            newRoomName,
            newRoomPublic,
            inviteTarget,
            active,
            joined,
            invited,
            connLabel,
            doLogin,
            doRegister,
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
