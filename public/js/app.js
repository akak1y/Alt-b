import { createApp, ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { render } from 'alt-template';
import * as mc from './matrix-client.js';
import { isRegistrationUsername, useInvitations } from './invitations.js';
import { useAppearance } from './appearance.js';
import { useSnakeControls } from './snake-game.js';
import { readImageFile, resizeAvatar } from './profile-avatar.js';
import { useProfileName } from './profile-settings.js';
import { useAssistantFocus, shouldAnimateAssistant } from './assistant-focus.js';
import { settingsTabForPage } from './settings-tabs.js';

// Входная точка интерфейса: Vue связывает шаблон public/index.html с действиями
// из matrix-client.js. Здесь хранятся значения полей и видимые ошибки, но нет
// прямых запросов к Synapse — их выполняет клиент Matrix.
createApp({
    render,
    setup() {
        const invitationManager = useInvitations(mc.invitationRequest);
        const settingsDialog = ref(null);
        const settingsPage = ref('menu');
        const settingsTab = ref('appearance');
        const assistantScene = ref('intro');
        const assistantScan = ref(false);
        let assistantScanTimer = null;
        const assistantGreetings = [
            'Связь установлена',
            'Что на этот раз?',
            'Чем могу помочь?',
            'Я на связи',
            'Готов к новой задаче',
            'Система помощника активна',
            'Чем займёмся сегодня?',
        ];
        const assistantGreeting = ref(assistantGreetings[0]);
        const customAvatar = ref('');
        const avatarError = ref('');
        const snakeCanvas = ref(null);
        const { snakeGame, snakeScore, snakeRunning, startSnake, stopSnake } =
            useSnakeControls(snakeCanvas);
        const changeSnakeDirection = (direction) => snakeGame.setDirection(direction);
        const {
            assistantOpen,
            assistantDialog,
            openAssistantDialog,
            closeAssistantDialog,
            assistantKeys,
        } = useAssistantFocus(() => {
            assistantScan.value = false;
            if (assistantScanTimer) window.clearTimeout(assistantScanTimer);
            assistantScanTimer = null;
            stopSnake();
        });
        function onAssistantKeydown(event) {
            assistantKeys(event);
            if (snakeRunning.value) snakeGame.handleKey(event);
        }
        function avatarStorageKey() {
            return `alt-custom-avatar:${s.value.myUserId || 'guest'}`;
        }
        function loadCustomAvatar() {
            try {
                customAvatar.value = localStorage.getItem(avatarStorageKey()) || '';
            } catch {
                customAvatar.value = '';
            }
        }
        function removeCustomAvatar() {
            // Удаляет аватар только для текущего Matrix-профиля в локальном хранилище.
            customAvatar.value = '';
            avatarError.value = '';
            try {
                localStorage.removeItem(avatarStorageKey());
            } catch {
                // Interface remains usable if browser storage is unavailable.
            }
        }
        async function selectCustomAvatar(event) {
            // Загружает файл один раз, кадрирует и сохраняет его для отображения в интерфейсе.
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            avatarError.value = '';
            try {
                // Загрузка и квадратное кадрирование вынесены в профильный модуль.
                const loaded = await readImageFile(file);
                const dataUrl = resizeAvatar(loaded.image);
                try {
                    localStorage.setItem(avatarStorageKey(), dataUrl);
                    customAvatar.value = dataUrl;
                } catch {
                    avatarError.value = 'Не удалось сохранить аватар в браузере.';
                }
            } catch (error) {
                avatarError.value = error.message || 'Не удалось загрузить аватар.';
            }
        }
        function openAssistant() {
            // Выбирает случайную приветственную реплику и запускает короткий экран вызова.
            assistantScene.value = 'intro';
            assistantGreeting.value =
                assistantGreetings[Math.floor(Math.random() * assistantGreetings.length)];
            void openAssistantDialog();
            // Системный запрет анимации учитывается до создания короткого эффекта.
            if (!shouldAnimateAssistant()) return;
            assistantScan.value = true;
            if (assistantScanTimer) window.clearTimeout(assistantScanTimer);
            assistantScanTimer = window.setTimeout(() => {
                assistantScan.value = false;
                assistantScanTimer = null;
            }, 300);
        }
        function closeAssistant() {
            closeAssistantDialog();
        }
        function selectAssistantScene(scene) {
            assistantScene.value = scene;
            if (scene === 'snake') {
                nextTick(() => {
                    if (
                        assistantOpen.value &&
                        assistantScene.value === 'snake' &&
                        shouldAnimateAssistant()
                    )
                        startSnake();
                });
            } else {
                stopSnake();
            }
        }
        const settingsTitle = computed(
            () =>
                ({
                    menu: 'Настройки',
                    about: 'О проекте',
                    team: 'Разработка',
                    news: 'Новости ALT',
                    faq: 'Справка ALT',
                })[settingsPage.value],
        );
        function openSettings(page = 'menu') {
            // Синхронизирует вкладку окна настроек с выбранной точкой входа.
            settingsPage.value = page;
            settingsTab.value = settingsTabForPage(page, s.value.phase);
            settingsDialog.value.showModal();
        }
        function closeSettings() {
            settingsDialog.value.close();
            stopSnake();
        }
        // Подписка присылает новые снимки состояния при синхронизации и событиях комнат.
        // При удалении компонента подписку снимаем, чтобы не держать лишний обработчик.
        const s = ref(mc.getState());
        const { nicknameDraft, nicknameBusy, nicknameError, saveNickname } = useProfileName(
            s,
            mc.setProfileName,
        );
        watch(
            () => s.value.phase,
            (phase) => {
                if (
                    phase !== 'ready' &&
                    settingsPage.value === 'menu' &&
                    settingsTab.value === 'account'
                )
                    settingsTab.value = 'appearance';
            },
        );
        watch(
            () => s.value.myUserId,
            () => loadCustomAvatar(),
            { immediate: true },
        );
        const appearanceControls = useAppearance(() => s.value.phase === 'idle');
        const unsub = mc.subscribe((v) => {
            s.value = v;
        });
        onUnmounted(unsub);
        onUnmounted(() => {
            snakeGame.destroy();
            if (assistantScanTimer) window.clearTimeout(assistantScanTimer);
        });

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
        const historyPending = ref(false);
        const historyError = ref('');
        const historyNeedsMore = ref(false);
        let historyHasMore = true;
        let historyRequest = null;

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

        watch(
            [() => active.value?.roomId, () => active.value?.messages.length],
            async ([roomId], [previousRoomId]) => {
                const roomChanged = roomId !== previousRoomId;
                if (roomChanged) {
                    historyRequest = null;
                    historyHasMore = true;
                    historyPending.value = false;
                    historyError.value = '';
                    historyNeedsMore.value = false;
                }
                const box = messagesBox.value;
                const follow = box && box.scrollHeight - box.scrollTop - box.clientHeight < 48;
                if (!roomId || (!roomChanged && (!follow || historyPending.value))) return;
                await nextTick();
                if (roomId !== active.value?.roomId || !messagesBox.value) return;
                const currentBox = messagesBox.value;
                currentBox.scrollTop = currentBox.scrollHeight;
                if (roomChanged && currentBox.scrollHeight <= currentBox.clientHeight)
                    void loadOlder();
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
        async function loadOlder() {
            const roomId = active.value?.roomId;
            const box = messagesBox.value;
            if (!roomId || !box || !historyHasMore || historyRequest) return;
            const request = { roomId };
            historyRequest = request;
            historyError.value = '';
            historyNeedsMore.value = false;
            const height = box.scrollHeight;
            const top = box.scrollTop;
            historyPending.value = true;
            try {
                const more = await mc.loadOlder(roomId);
                if (historyRequest !== request) return;
                historyHasMore = more;
            } catch {
                if (historyRequest !== request) return;
                historyError.value = 'Не удалось загрузить предыдущие сообщения.';
            } finally {
                if (historyRequest === request) {
                    historyPending.value = false;
                    await nextTick();
                    if (historyRequest === request) {
                        box.scrollTop = top + box.scrollHeight - height;
                        historyNeedsMore.value =
                            historyHasMore && box.scrollHeight <= box.clientHeight;
                        historyRequest = null;
                    }
                }
            }
        }
        function onMessagesScroll(event) {
            if (event.currentTarget.scrollTop <= 36 && !historyError.value) void loadOlder();
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
            ...appearanceControls,
            settingsDialog,
            settingsPage,
            settingsTab,
            settingsTitle,
            openSettings,
            closeSettings,
            assistantOpen,
            assistantDialog,
            onAssistantKeydown,
            assistantGreeting,
            openAssistant,
            closeAssistant,
            assistantScene,
            assistantScan,
            customAvatar,
            avatarError,
            nicknameDraft,
            nicknameBusy,
            nicknameError,
            saveNickname,
            snakeCanvas,
            snakeScore,
            snakeRunning,
            startSnake,
            stopSnake,
            changeSnakeDirection,
            selectCustomAvatar,
            removeCustomAvatar,
            selectAssistantScene,
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
            onMessagesScroll,
            historyPending,
            historyError,
            historyNeedsMore,
            send,
            doCreateRoom,
            doInvite,
            fmt,
        };
    },
}).mount('#app');
