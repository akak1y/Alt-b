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

        let socket = null;

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

            socket.emit(
                'message:create',
                { channelId: currentChannel.value.id, content: text },
                (response) => {
                    if (response?.error) {
                        alert(response.error);
                        return;
                    }

                    content.value = '';
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

            socket.on('message:created', (message) => {
                if (currentChannel.value && message.channel_id === currentChannel.value.id) {
                    messages.value.push(message);
                    scrollDown();
                }
            });
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
        };
    },
}).mount('#app');
