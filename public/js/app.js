import { createApp, ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { render } from 'alt-template';
import * as mc from './matrix-client.js';
import { isRegistrationUsername, useInvitations } from './invitations.js';
import { useAppearance } from './appearance.js';

// Входная точка интерфейса: Vue связывает шаблон public/index.html с действиями
// из matrix-client.js. Здесь хранятся значения полей и видимые ошибки, но нет
// прямых запросов к Synapse — их выполняет клиент Matrix.
createApp({
    render,
    setup() {
        const invitationManager = useInvitations(mc.invitationRequest);
        const appearance = useAppearance();
        const settingsDialog = ref(null);
        const settingsPage = ref('menu');
        function openSettings() {
            settingsPage.value = 'menu';
            settingsDialog.value.showModal();
        }
        function closeSettings() {
            settingsDialog.value.close();
        }
        // Подписка присылает новые снимки состояния при синхронизации и событиях комнат.
        // При удалении компонента подписку снимаем, чтобы не держать лишний обработчик.
        const s = ref(mc.getState());
        const unsub = mc.subscribe((v) => {
            s.value = v;
        });
        onUnmounted(unsub);

        // Поля входа и регистрации разделены: введённый пароль не переносится
        // из одной формы в другую.
        const username = ref('');
        const password = ref('');
        const registerUsername = ref('');
        const registerPassword = ref('');
        const logoFailed = ref(false);
        const inviteUrl = new URL(window.location.href);
        // Ссылка с регистрационным кодом заранее заполняет поле регистрации.
        // Это код регистрации пользователя, а не приглашение в комнату.
        const invitation =
            inviteUrl.searchParams.get('registration_token') || inviteUrl.searchParams.get('token');
        const inviteFragment = new URLSearchParams(inviteUrl.hash.slice(1));
        const suggestedLogin = inviteFragment.get('registration_username') || '';
        const personalLogin =
            invitation && isRegistrationUsername(suggestedLogin) ? suggestedLogin : '';
        const registration = ref(Boolean(invitation));
        registerUsername.value = personalLogin;
        const token = ref(invitation || '');
        if (invitation) {
            inviteUrl.searchParams.delete('registration_token');
            inviteUrl.searchParams.delete('token');
            if (inviteFragment.has('registration_username')) {
                inviteFragment.delete('registration_username');
                inviteUrl.hash = inviteFragment.toString();
            }
            // Не оставляем код приглашения в адресной строке и истории браузера.
            window.history.replaceState(null, '', inviteUrl);
        }
        const busy = ref(false);
        const err = ref('');
        const draft = ref('');
        const messagesBox = ref(null);

        function showAuthForm(showRegistration) {
            registration.value = showRegistration;
            err.value = '';
        }

        const showCreate = ref(false);
        const roomsCollapsed = ref(false);
        const newRoomName = ref('');
        const newRoomPublic = ref(false);
        const newRoomEncrypted = ref(false);
        const inviteTarget = ref('');

        // Состояние комнат приходит из matrix-client.js. Эти списки только
        // готовят данные для шаблона, не изменяя комнаты на сервере.
        const active = computed(
            () => s.value.rooms.find((r) => r.roomId === s.value.activeRoomId) || null,
        );
        const joined = computed(() => s.value.rooms.filter((r) => r.membership === 'join'));
        const invited = computed(() => s.value.rooms.filter((r) => r.membership === 'invite'));

        // Перевод технического состояния соединения в короткую подпись.
        const connLabel = computed(
            () =>
                ({
                    online: 'online',
                    syncing: 'syncing…',
                    reconnecting: 'reconnecting…',
                    offline: 'offline',
                })[s.value.connection] || s.value.connection,
        );

        // После появления нового сообщения прокручиваем видимую переписку вниз.
        // nextTick ждёт, пока Vue добавит сообщение в HTML.
        watch(
            () => active.value?.messages.length,
            () => {
                nextTick(() => {
                    if (messagesBox.value)
                        messagesBox.value.scrollTop = messagesBox.value.scrollHeight;
                });
            },
        );

        /**
         * Запускает вход или регистрацию по нажатию соответствующей кнопки.
         * kind = 'login' берёт поля входа; kind = 'register' берёт отдельные
         * поля регистрации и код из ссылки/формы. Пока запрос выполняется,
         * busy запрещает повторную отправку; ошибка показывается в шаблоне.
         * Работа с сессией и Synapse находится в matrix-client.js.
         */
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

        // Два обработчика нужны двум отдельным формам в public/index.html.
        // Они вызывают общую логику с разным набором полей.
        const doLogin = () => doAuth('login');
        const doRegister = () => doAuth('register');

        // Очищает видимые поля после выхода; сохранённую сессию удаляет mc.logout.
        function logout() {
            invitationManager.closeInvitations();
            if (settingsDialog.value.open) closeSettings();
            mc.logout();
            username.value = '';
            password.value = '';
            registerUsername.value = '';
            registerPassword.value = '';
            token.value = '';
            err.value = '';
        }
        // Выбор комнаты меняет только открытую переписку в интерфейсе.
        function select(r) {
            mc.selectRoom(r.roomId);
        }
        function backToRooms() {
            roomsCollapsed.value = false;
            mc.selectRoom(null);
        }
        // Принятие приглашения в комнату отправляется на Synapse через SDK.
        function join(r) {
            mc.joinRoom(r.roomId);
        }
        // Просит предыдущие события только для выбранной комнаты.
        function loadOlder() {
            if (active.value) mc.loadOlder(active.value.roomId);
        }

        /** Отправляет непустой текст в открытую комнату и очищает поле после успеха. */
        async function send() {
            const t = draft.value.trim();
            if (!t || !active.value) return;
            err.value = '';
            try {
                await mc.sendText(active.value.roomId, t);
                draft.value = '';
            } catch (e) {
                err.value = e.message;
            }
        }

        /** Создаёт комнату по имени и признаку «публичная» из формы слева. */
        async function doCreateRoom() {
            const name = newRoomName.value.trim();
            if (!name) return;
            err.value = '';
            try {
                await mc.createRoom(name, newRoomPublic.value, newRoomEncrypted.value);
                newRoomName.value = '';
                newRoomPublic.value = false;
                newRoomEncrypted.value = false;
                showCreate.value = false;
            } catch (e) {
                err.value = e.message;
            }
        }

        /** Приглашает Matrix-пользователя в открытую комнату по его полному ID. */
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

        // Дата события в миллисекундах отображается по настройкам браузера.
        const fmt = (ts) => (ts ? new Date(ts).toLocaleString() : '');

        // При первом открытии страницы пробуем восстановить сохранённый вход.
        // При отсутствии сессии остаётся экран авторизации.
        onMounted(async () => {
            busy.value = true;
            try {
                await mc.restoreSession();
            } catch (e) {
                err.value = e.message;
            } finally {
                busy.value = false;
            }
            nextTick(() => {
                if (messagesBox.value) messagesBox.value.scrollTop = messagesBox.value.scrollHeight;
            });
        });

        // Только возвращённые значения доступны выражениям в public/index.html.
        return {
            ...invitationManager,
            s,
            username,
            password,
            registerUsername,
            registerPassword,
            logoFailed,
            token,
            registration,
            personalLogin,
            showAuthForm,
            appearance,
            settingsDialog,
            settingsPage,
            openSettings,
            closeSettings,
            busy,
            err,
            draft,
            messagesBox,
            showCreate,
            roomsCollapsed,
            newRoomName,
            newRoomPublic,
            newRoomEncrypted,
            inviteTarget,
            active,
            joined,
            invited,
            connLabel,
            doLogin,
            doRegister,
            logout,
            select,
            backToRooms,
            join,
            loadOlder,
            send,
            doCreateRoom,
            doInvite,
            fmt,
        };
    },
}).mount('#app');
