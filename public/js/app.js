import * as mc from './matrix-client.js';

const { createApp, ref, computed, onMounted, onUnmounted, watch, nextTick } = Vue;

createApp({
    setup() {
        const s = ref(mc.getState());
        const unsub = mc.subscribe((v) => {
            s.value = v;
        });
        onUnmounted(unsub);

        const baseUrl = ref('http://localhost:8008');
        const username = ref('');
        const password = ref('');
        const token = ref('');
        const mode = ref('login'); // login | register
        const busy = ref(false);
        const err = ref('');
        const draft = ref('');
        const messagesBox = ref(null);

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

        async function doAuth() {
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
            draft.value = '';
            try {
                await mc.sendText(active.value.roomId, t);
            } catch (e) {
                err.value = e.message;
            }
        }

        const fmt = (ts) => (ts ? new Date(ts).toLocaleString() : '');

        onMounted(() => {
            if (s.value.phase === 'ready') messagesBox.value?.scrollTo(0, 1e9);
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
            active,
            joined,
            invited,
            connLabel,
            doAuth,
            logout,
            select,
            join,
            loadOlder,
            send,
            fmt,
        };
    },
}).mount('#app');
