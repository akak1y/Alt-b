import { onUnmounted, ref, watch } from 'vue';
import { createMatrixBackground } from './matrix-bg.js';

const KEY = 'alt-ui-prefs';
const backgrounds = ['auto', 'dark', 'light', 'matrix'];
const defaults = { bg: 'auto', anim: true, fx: 1, quality: 'auto', speed: 1, glow: 1, density: 1 };
const level = (value) => (Number.isInteger(value) && value >= 0 && value <= 2 ? value : null);
const factor = (value) => (typeof value === 'number' && value >= 0 && value <= 3 ? value : 1);

export function useAppearance(isAuth) {
    let saved;
    try {
        saved = JSON.parse(localStorage.getItem(KEY));
    } catch {
        // The interface can still run when browser storage is unavailable.
    }
    const appearance = ref({
        bg: backgrounds.includes(saved?.bg) ? saved.bg : defaults.bg,
        anim: saved?.anim !== false,
        fx: level(saved?.fx) ?? defaults.fx,
        quality: level(saved?.quality) ?? defaults.quality,
        speed: factor(saved?.speed),
        glow: factor(saved?.glow),
        density: factor(saved?.density),
    });
    let background;
    watch(
        [appearance, isAuth],
        ([prefs, auth]) => {
            const light = prefs.bg === 'light';
            const matrix = prefs.bg === 'matrix' || (prefs.bg === 'auto' && auth);
            document.documentElement.dataset.theme = light ? 'light' : 'dark';
            document.body.classList.toggle('bg-light', light);
            document.body.classList.toggle('alt-calm', !prefs.anim);
            if (matrix && typeof window.CanvasRenderingContext2D === 'function') {
                if (background === undefined) background = createMatrixBackground() ?? null;
                background?.update(prefs, auth);
            } else {
                background?.destroy();
                background = undefined;
            }
            document.body.classList.toggle('bg-matrix', Boolean(background));
            try {
                localStorage.setItem(KEY, JSON.stringify(prefs));
            } catch {
                // Preferences remain active for this page.
            }
        },
        { deep: true, immediate: true },
    );
    onUnmounted(() => background?.destroy());
    return appearance;
}
