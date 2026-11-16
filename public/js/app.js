import { createApp, ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { render } from 'alt-template';
import * as mc from './matrix-client.js';

// Входная точка интерфейса: Vue связывает шаблон public/index.html с действиями
// из matrix-client.js. Здесь хранятся значения полей и видимые ошибки, но нет
// прямых запросов к Synapse — их выполняет клиент Matrix.
createApp({
    render,
    setup() {
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

        // Панель помощника: открыта ли, переписка, набор ответа и поле ввода.
        const assistantOpen = ref(false);
        const assistantDraft = ref('');
        const assistantTyping = ref(false);
        const assistantBox = ref(null);
        let assistantSeq = 0;
        const nowTime = () => new Date().toLocaleTimeString();
        const assistantMessages = ref([
            {
                id: ++assistantSeq,
                from: 'bot',
                text: 'Привет! Я помощник Alt. Выберите команду или напишите вопрос:',
                commands: ['Как создать комнату?', 'Как пригласить друга?', 'Что такое E2EE?'],
                time: nowTime(),
            },
        ]);

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

        // Сворачивание списка комнат в сайдбаре.
        const roomsCollapsed = ref(false);

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

        // Переписка помощника тоже прокручивается к последнему сообщению.
        watch(
            () => assistantMessages.value.length + (assistantTyping.value ? 1 : 0),
            () => {
                nextTick(() => {
                    if (assistantBox.value)
                        assistantBox.value.scrollTop = assistantBox.value.scrollHeight;
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
            try {
                await mc.createRoom(name, newRoomPublic.value);
                newRoomName.value = '';
                newRoomPublic.value = false;
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

        // Простые ответы помощника по ключевым словам; работают локально,
        // без обращения к серверу — это подсказки по интерфейсу Alt.
        function assistantAnswer(text) {
            const t = text.toLowerCase();
            if (t.includes('комнат') && (t.includes('создат') || t.includes('нов')))
                return 'Нажмите «＋ Новая комната» в списке слева, введите название и при желании отметьте «публичная», затем «Создать».';
            if (t.includes('приглас') || t.includes('друг'))
                return 'Откройте комнату, в строке под полем ввода укажите полный ID вида @user:example.org и нажмите «Пригласить».';
            if (t.includes('e2ee') || t.includes('шифр'))
                return 'E2EE — сквозное шифрование. Alt пока его не поддерживает: такие комнаты помечены 🔒, переписка в них недоступна.';
            if (t.includes('истор'))
                return 'Кнопка «История» в шапке чата подгружает более старые сообщения открытой комнаты.';
            if (t.includes('выход') || t.includes('выйти'))
                return 'Кнопка выхода находится внизу сайдбара, рядом с вашим именем.';
            return 'Пока я умею отвечать про интерфейс Alt. Спросите про комнаты, приглашения, шифрование или историю.';
        }

        /** Добавляет реплику пользователя и ответ помощника с короткой задержкой. */
        function askAssistant(text) {
            const q = (text || '').trim();
            if (!q || assistantTyping.value) return;
            assistantMessages.value.push({
                id: ++assistantSeq,
                from: 'user',
                text: q,
                time: nowTime(),
            });
            assistantDraft.value = '';
            assistantTyping.value = true;
            setTimeout(() => {
                assistantTyping.value = false;
                assistantMessages.value.push({
                    id: ++assistantSeq,
                    from: 'bot',
                    text: assistantAnswer(q),
                    time: nowTime(),
                });
            }, 700);
        }

        const sendAssistant = () => askAssistant(assistantDraft.value);

        // Дата события в миллисекундах отображается по настройкам браузера.
        const fmt = (ts) => (ts ? new Date(ts).toLocaleString() : '');

        // При первом открытии страницы пробуем восстановить сохранённый вход.
        // При отсутствии сессии остаётся экран авторизации.
        onMounted(async () => {
            await mc.restoreSession();
            nextTick(() => {
                if (messagesBox.value) messagesBox.value.scrollTop = messagesBox.value.scrollHeight;
            });
        });

        // Только возвращённые значения доступны выражениям в public/index.html.
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
            roomsCollapsed,
            assistantOpen,
            assistantDraft,
            assistantTyping,
            assistantBox,
            assistantMessages,
            askAssistant,
            sendAssistant,
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
