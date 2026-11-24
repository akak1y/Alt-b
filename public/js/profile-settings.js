import { ref, watch } from 'vue';

// Черновик принадлежит конкретному Matrix ID, а не вкладке браузера.
export function useProfileName(state, setProfileName) {
    const nicknameDraft = ref('');
    const nicknameBusy = ref(false);
    const nicknameError = ref('');
    let owner = '';
    let suggested = '';
    let requestId = 0;

    watch(
        () => [state.value.myUserId, state.value.myName],
        ([userId, name]) => {
            if (userId !== owner) {
                owner = userId;
                requestId += 1;
                suggested = name || userId || '';
                nicknameDraft.value = suggested;
                nicknameError.value = '';
                nicknameBusy.value = false;
            } else if (!nicknameDraft.value || nicknameDraft.value === suggested) {
                // Имя может прийти после ID; только нетронутое поле подставляем заново.
                suggested = name || userId || '';
                nicknameDraft.value = suggested;
            }
        },
        { immediate: true },
    );

    async function saveNickname() {
        const userId = state.value.myUserId;
        // Подписка Vue обновляется асинхронно: перед записью дополнительно
        // сравниваем владельца черновика с текущей сессией.
        if (!userId || userId !== owner || nicknameBusy.value) return;
        const currentRequest = ++requestId;
        nicknameError.value = '';
        nicknameBusy.value = true;
        try {
            await setProfileName(nicknameDraft.value);
            if (
                owner === userId &&
                state.value.myUserId === userId &&
                currentRequest === requestId
            ) {
                suggested = state.value.myName;
                nicknameDraft.value = state.value.myName;
            }
        } catch (error) {
            if (owner === userId && state.value.myUserId === userId && currentRequest === requestId)
                nicknameError.value = error.message || 'Не удалось изменить никнейм.';
        } finally {
            if (owner === userId && state.value.myUserId === userId && currentRequest === requestId)
                nicknameBusy.value = false;
        }
    }

    return { nicknameDraft, nicknameBusy, nicknameError, saveNickname };
}
