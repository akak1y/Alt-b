import * as mc from './matrix-client.js';

const { createApp, ref, computed, onMounted, onUnmounted, watch, nextTick } = Vue;

createApp({
  setup() {
    const s = ref(mc.getState());
    const unsub = mc.subscribe((v) => { s.value = v; });
    onUnmounted(unsub);

    // ─── FIX #1: homeserver из конфигурации, редактируемое поле ───
    const baseUrl = ref(mc.DEFAULT_BASE_URL);
    const username = ref('');
    const password = ref('');
    const token = ref('');
    const mode = ref('login'); // login | register
    const busy = ref(false);
    const err = ref('');
    const draft = ref('');
    const messagesBox = ref(null);

    // ─── FIX #6: создание комнаты / приглашение ───
    const showCreate = ref(false);
    const newRoomName = ref('');
    const inviteTarget = ref('');

    const active = computed(() =>
      s.value.rooms.find((r) => r.roomId === s.value.activeRoomId) || null
    );
    const joined = computed(() => s.value.rooms.filter((r) => r.membership === 'join'));
    const invited = computed(() => s.value.rooms.filter((r) => r.membership === 'invite'));

    const connLabel = computed(() =>
      ({
        online: 'online',
        syncing: 'syncing…',
        reconnecting: 'reconnecting…',
        offline: 'offline',
      }[s.value.connection] || s.value.connection)
    );

    watch(
      () => active.value?.messages.length,
      () => {
        nextTick(() => {
          if (messagesBox.value) messagesBox.value.scrollTop = messagesBox.value.scrollHeight;
        });
      }
    );

    // ─── FIX #1: сохранить homeserver при смене ───
    function saveHs() {
      mc.setBaseUrl(baseUrl.value);
    }

    async function doAuth() {
      busy.value = true;
      err.value = '';
      saveHs();
      try {
        if (mode.value === 'login') {
          await mc.login({ baseUrl: baseUrl.value, username: username.value, password: password.value });
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

    function select(r) { mc.selectRoom(r.roomId); }
    function join(r) { mc.joinRoom(r.roomId); }
    function loadOlder() { if (active.value) mc.loadOlder(active.value.roomId); }

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

    // ─── FIX #6: создать комнату ───
    async function doCreateRoom() {
      const name = newRoomName.value.trim();
      if (!name) return;
      try {
        await mc.createRoom(name);
        newRoomName.value = '';
        showCreate.value = false;
        // sync подхватит новую комнату
      } catch (e) {
        err.value = e.message;
      }
    }

    // ─── FIX #6: пригласить по Matrix ID ───
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

    // ─── FIX #3: восстановить сессию при загрузке ───
    onMounted(async () => {
      const restored = await mc.restoreSession();
      if (restored) {
        baseUrl.value = mc.getState().baseUrl;
      }
      nextTick(() => {
        if (messagesBox.value) messagesBox.value.scrollTop = messagesBox.value.scrollHeight;
      });
    });

    return {
      s, baseUrl, username, password, token, mode, busy, err, draft, messagesBox,
      showCreate, newRoomName, inviteTarget,
      active, joined, invited, connLabel,
      saveHs, doAuth, logout, select, join, loadOlder, send,
      doCreateRoom, doInvite, fmt,
    };
  },
}).mount('#app');