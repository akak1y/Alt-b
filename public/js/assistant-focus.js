import { ref, nextTick, onUnmounted } from 'vue';

const FOCUSABLE =
    'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

export const shouldAnimateAssistant = () =>
    !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Окно остаётся поверх прежнего интерфейса, но работает с клавиатурой как диалог.
export function useAssistantFocus(onClose) {
    const assistantOpen = ref(false);
    const assistantDialog = ref(null);
    let opener = null;

    function keepFocus(event) {
        if (assistantOpen.value && !assistantDialog.value?.contains(event.target)) {
            assistantDialog.value?.querySelector(FOCUSABLE)?.focus();
        }
    }
    async function openAssistantDialog() {
        opener = document.activeElement;
        assistantOpen.value = true;
        document.addEventListener('focusin', keepFocus);
        await nextTick();
        assistantDialog.value?.querySelector(FOCUSABLE)?.focus();
    }
    function closeAssistantDialog() {
        if (!assistantOpen.value) return;
        assistantOpen.value = false;
        document.removeEventListener('focusin', keepFocus);
        onClose();
        nextTick(() => opener?.focus());
    }
    function assistantKeys(event) {
        if (event.key === 'Escape') {
            event.preventDefault();
            closeAssistantDialog();
        }
        if (event.key !== 'Tab') return;
        const controls = [...(assistantDialog.value?.querySelectorAll(FOCUSABLE) || [])];
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (!first) {
            event.preventDefault();
            assistantDialog.value?.focus();
        } else if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }
    onUnmounted(() => document.removeEventListener('focusin', keepFocus));
    return {
        assistantOpen,
        assistantDialog,
        openAssistantDialog,
        closeAssistantDialog,
        assistantKeys,
    };
}
