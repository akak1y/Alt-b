import { computed, onUnmounted, ref, watch } from 'vue';
import { createMatrixBackground } from './matrix-bg.js';

const KEY = 'alt-ui-prefs';
const backgrounds = ['auto', 'dark', 'light', 'matrix'];
const defaults = {
    bg: 'auto',
    anim: true,
    fx: 1,
    quality: 'auto',
    speed: 1,
    glow: 1,
    density: 1,
    stripes: true,
};
const level = (value) => (Number.isInteger(value) && value >= 0 && value <= 2 ? value : null);
const factor = (value) => (typeof value === 'number' && value >= 0 && value <= 3 ? value : 1);
const qualityLevels = ['auto', 0, 1, 2];
const qualityLabels = ['Авто', 'Низкое', 'Среднее', 'Высокое'];
const formatScale = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });

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
        stripes: saved?.stripes !== false,
    });
    const memory = navigator.deviceMemory;
    const resourceLimit = ref(
        memory > 0 && memory <= 2
            ? 'Для анимированного фона мало памяти. Включена тёмная тема.'
            : '',
    );
    const backgroundWarning = ref('');
    const activeBackground = computed(() => {
        const mode =
            appearance.value.bg === 'auto' ? (isAuth() ? 'matrix' : 'dark') : appearance.value.bg;
        return mode === 'matrix' && resourceLimit.value ? 'dark' : mode;
    });
    const backgroundLabel = computed(
        () =>
            ({ dark: 'Тёмный фон', light: 'Светлый фон', matrix: 'Matrix' })[
                activeBackground.value
            ],
    );
    const effectLabel = computed(() => ['Спокойно', 'Сбой', 'Хаос'][appearance.value.fx]);
    const qualityLabel = computed(
        () => qualityLabels[qualityLevels.indexOf(appearance.value.quality)],
    );
    const renderStats = ref('');

    function reportBackgroundLimit() {
        backgroundWarning.value = resourceLimit.value;
    }

    function selectBackground() {
        backgroundWarning.value = '';
        if (appearance.value.bg === 'matrix' || (appearance.value.bg === 'auto' && isAuth())) {
            reportBackgroundLimit();
        }
    }

    function enableLoginBackground() {
        if (resourceLimit.value) {
            if (activeBackground.value === 'light') appearance.value.bg = 'auto';
            reportBackgroundLimit();
            return false;
        }
        if (activeBackground.value !== 'matrix') appearance.value.bg = 'auto';
        return true;
    }

    function cycleLoginEffect() {
        if (enableLoginBackground()) appearance.value.fx = (appearance.value.fx + 1) % 3;
    }

    function cycleLoginQuality() {
        if (!enableLoginBackground()) return;
        const index = qualityLevels.indexOf(appearance.value.quality);
        appearance.value.quality = qualityLevels[(index + 1) % qualityLevels.length];
    }

    function resetAppearance() {
        appearance.value = { ...defaults };
    }

    let background;
    watch(
        [appearance, isAuth, activeBackground],
        ([prefs, auth, mode]) => {
            const light = mode === 'light';
            document.documentElement.dataset.theme = light ? 'light' : 'dark';
            document.body.classList.toggle('bg-light', light);
            document.body.classList.toggle('alt-calm', !prefs.anim || Boolean(resourceLimit.value));
            document.body.classList.toggle('fx-glitch', prefs.fx === 1);
            document.body.classList.toggle('fx-chaos', prefs.fx === 2);
            document.body.classList.toggle('fx-stripes', prefs.stripes);
            if (mode === 'matrix' && typeof window.CanvasRenderingContext2D === 'function') {
                background ??= createMatrixBackground({
                    lowAutoQuality: !(memory > 2),
                    onRenderStats(stats) {
                        renderStats.value = stats
                            ? `${stats.fps} FPS · ${stats.quality} · ${formatScale.format(stats.scale)}×`
                            : '';
                    },
                    onBudgetExceeded() {
                        resourceLimit.value =
                            'Фон отключён из-за высокой нагрузки. Включена тёмная тема.';
                        reportBackgroundLimit();
                    },
                });
                if (!background) {
                    resourceLimit.value = 'Анимированный фон недоступен. Включена тёмная тема.';
                    reportBackgroundLimit();
                }
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
    return {
        appearance,
        backgroundLabel,
        backgroundWarning,
        cycleLoginEffect,
        cycleLoginQuality,
        effectLabel,
        qualityLabel,
        resetAppearance,
        renderStats,
        reportBackgroundLimit,
        selectBackground,
    };
}
