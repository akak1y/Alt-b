import { ref, watch } from 'vue';

const KEY = 'alt-ui-prefs';
const defaults = { bg: 'dark', anim: true };

export function useAppearance() {
    let saved;
    try {
        saved = JSON.parse(localStorage.getItem(KEY));
    } catch {
        // The interface can still run when browser storage is unavailable.
    }
    const appearance = ref({
        bg: saved?.bg === 'light' ? 'light' : defaults.bg,
        anim: saved?.anim !== false,
    });
    watch(
        appearance,
        (prefs) => {
            document.documentElement.dataset.theme = prefs.bg === 'light' ? 'light' : 'dark';
            document.body.classList.toggle('bg-light', prefs.bg === 'light');
            document.body.classList.toggle('alt-calm', !prefs.anim);
            try {
                localStorage.setItem(KEY, JSON.stringify(prefs));
            } catch {
                // Preferences remain active for this page.
            }
        },
        { deep: true, immediate: true },
    );
    return appearance;
}
