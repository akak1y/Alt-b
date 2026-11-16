const { createApp, ref, onMounted, nextTick } = Vue;

createApp({
    setup() {
        const login = ref('');
        const password = ref('');
        const content = ref('');
        const status = ref('Not authenticated');
        const currentLogin = ref('');

        const spaces = ref([]);
        const channels = ref([]);
        const messages = ref([]);

        const currentSpaceId = ref(null);
        const currentChannel = ref(null);
        const messagesBox = ref(null);

        const showSettings = ref(false);
        const profile = ref({ display_name: '', email: '', phone: '' });
        const profileStatus = ref('');
        const pw = ref({ old: '', new1: '', new2: '' });
        const pwStatus = ref('');

        let socket = null;
        let pendingSeq = 0;

        const getToken = () => localStorage.getItem('token');

        const api = async (url, options = {}) => {
            const res = await fetch(url, {
                ...options,
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${getToken()}`,
                    ...(options.headers || {}),
                },
            });

            const data = await res.json().catch(() => ({}));

            if (!res.ok) {
                const err = new Error(data.error || 'request error');
                err.status = res.status;
                throw err;
            }

            return data;
        };

        const scrollDown = () => {
            nextTick(() => {
                if (messagesBox.value) {
                    messagesBox.value.scrollTop = messagesBox.value.scrollHeight;
                }
            });
        };

        const formatTime = (value) => {
            return value ? new Date(value).toLocaleString() : '';
        };

        const avatarColor = (value) => {
            const str = String(value || '?');
            let hash = 0;

            for (let i = 0; i < str.length; i += 1) {
                hash = (hash * 31 + str.charCodeAt(i)) % 360;
            }

            return `hsl(${hash}, 40%, 55%)`;
        };

        const avatarLetter = (value) => {
            return String(value || '?')
                .charAt(0)
                .toUpperCase();
        };

        const loadSpaces = async () => {
            spaces.value = await api('/api/spaces');
        };

        const loadChannels = async (spaceId) => {
            channels.value = await api(`/api/spaces/${spaceId}/channels`);
        };

        const loadMessages = async (channelId) => {
            messages.value = await api(`/api/channels/${channelId}/messages`);
            scrollDown();
        };

        const selectSpace = async (space) => {
            if (!space.isMember) {
                return;
            }

            currentSpaceId.value = space.id;
            currentChannel.value = null;
            messages.value = [];
            await loadChannels(space.id);
        };

        const selectChannel = (channel) => {
            currentChannel.value = channel;
            messages.value = [];
            loadMessages(channel.id);

            socket.emit('channel:join', { channelId: channel.id }, (response) => {
                if (response?.error) {
                    alert(response.error);
                }
            });
        };

        const createSpace = async () => {
            const name = prompt('Название сервера');

            if (!name || !name.trim()) {
                return;
            }

            const data = await api('/api/spaces', {
                method: 'POST',
                body: JSON.stringify({ name: name.trim() }),
            });

            await loadSpaces();
            const space = spaces.value.find((s) => s.id === data.space.id);

            if (space) {
                await selectSpace(space);
            }
        };

        const createChannel = async () => {
            const name = prompt('Название чата');

            if (!name || !name.trim()) {
                return;
            }

            await api(`/api/spaces/${currentSpaceId.value}/channels`, {
                method: 'POST',
                body: JSON.stringify({ name: name.trim() }),
            });

            await loadChannels(currentSpaceId.value);
        };

        const joinSpace = async (space) => {
            await api(`/api/spaces/${space.id}/join`, { method: 'POST' });
            await loadSpaces();

            const updated = spaces.value.find((s) => s.id === space.id);

            if (updated) {
                await selectSpace(updated);
            }
        };

        const send = () => {
            const text = content.value.trim();

            if (!text || !currentChannel.value) {
                return;
            }

            if (!socket || !socket.connected) {
                alert('Socket not connected');
                return;
            }

            // optimistic UI: показываем сразу, до подтверждения сервера
            const tmpId = 'tmp-' + ++pendingSeq;
            messages.value.push({
                id: tmpId,
                content: text,
                created_at: new Date(),
                login: currentLogin.value,
                pending: true,
            });
            scrollDown();
            content.value = '';

            socket.emit(
                'message:create',
                { channelId: currentChannel.value.id, content: text },
                (response) => {
                    if (response?.error) {
                        const i = messages.value.findIndex((m) => m.id === tmpId);
                        if (i >= 0) {
                            messages.value.splice(i, 1);
                        }
                        alert(response.error);
                        return;
                    }

                    if (response?.eventId) {
                        const m = messages.value.find((x) => x.id === tmpId);
                        if (m) {
                            m.id = response.eventId;
                            m.pending = false;
                        }
                    }
                },
            );
        };

        const connectSocket = () => {
            socket = io({
                auth: {
                    token: getToken(),
                },
            });

            socket.on('connect', () => {
                status.value = 'Socket connected';
            });

            socket.on('connect_error', (err) => {
                status.value = `Socket error: ${err.message}`;
            });

            socket.on('message:created', (msg) => {
                if (!currentChannel.value || msg.channel_id !== currentChannel.value.id) {
                    return;
                }

                // убираем optimistic-дубли того же автора и текста
                messages.value = messages.value.filter(
                    (m) => !(m.pending && m.login === msg.login && m.content === msg.content),
                );

                if (!messages.value.some((m) => m.id === msg.id)) {
                    messages.value.push(msg);
                }

                scrollDown();
            });
        };

        const openSettings = async () => {
            showSettings.value = true;
            profileStatus.value = '';
            pwStatus.value = '';

            try {
                profile.value = await api('/api/profile');
            } catch {
                profileStatus.value = 'не удалось загрузить профиль';
            }
        };

        const closeSettings = () => {
            showSettings.value = false;
        };

        const saveProfile = async () => {
            profileStatus.value = 'сохраняю...';

            try {
                profile.value = await api('/api/profile', {
                    method: 'PUT',
                    body: JSON.stringify({
                        display_name: profile.value.display_name,
                        email: profile.value.email,
                        phone: profile.value.phone,
                    }),
                });
                profileStatus.value = 'сохранено';
            } catch (err) {
                profileStatus.value = err.message || 'ошибка';
            }
        };

        const changePassword = async () => {
            pwStatus.value = '';

            if (pw.value.new1 !== pw.value.new2) {
                pwStatus.value = 'пароли не совпадают';
                return;
            }

            try {
                await api('/api/profile/password', {
                    method: 'POST',
                    body: JSON.stringify({
                        old_password: pw.value.old,
                        new_password: pw.value.new1,
                    }),
                });
                pwStatus.value = 'пароль изменён';
                pw.value = { old: '', new1: '', new2: '' };
            } catch (err) {
                pwStatus.value = err.message || 'ошибка';
            }
        };

        const register = async () => {
            try {
                const res = await fetch('/api/auth/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ login: login.value.trim(), password: password.value }),
                });

                const data = await res.json();

                if (!res.ok) {
                    alert(data.error || 'Register error');
                    return;
                }

                localStorage.setItem('token', data.token);
                localStorage.setItem('userLogin', data.user.login);
                location.reload();
            } catch {
                alert('Network error');
            }
        };

        const loginUser = async () => {
            try {
                const res = await fetch('/api/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ login: login.value.trim(), password: password.value }),
                });

                const data = await res.json();

                if (!res.ok) {
                    alert(data.error || 'Login error');
                    return;
                }

                localStorage.setItem('token', data.token);
                localStorage.setItem('userLogin', data.user.login);
                location.reload();
            } catch {
                alert('Network error');
            }
        };

        const logout = () => {
            localStorage.removeItem('token');
            localStorage.removeItem('userLogin');
            location.reload();
        };

        onMounted(async () => {
            const token = getToken();

            if (!token) {
                return;
            }

            currentLogin.value = localStorage.getItem('userLogin') || 'unknown';
            status.value = 'Token found';
            connectSocket();

            try {
                await loadSpaces();
            } catch (err) {
                if (err.status === 401) {
                    logout();
                }
            }
        });

        return {
            login,
            password,
            content,
            status,
            currentLogin,
            spaces,
            channels,
            messages,
            currentSpaceId,
            currentChannel,
            messagesBox,
            showSettings,
            profile,
            profileStatus,
            pw,
            pwStatus,
            register,
            loginUser,
            logout,
            selectSpace,
            selectChannel,
            createSpace,
            createChannel,
            joinSpace,
            send,
            formatTime,
            avatarColor,
            avatarLetter,
            openSettings,
            closeSettings,
            saveProfile,
            changePassword,
        };
    },
}).mount('#app');
