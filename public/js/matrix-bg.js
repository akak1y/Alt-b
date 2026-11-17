// Адаптация Canvas-фона Gubga из design2 (ff69257).
export function createMatrixBackground() {
    const canvas = document.createElement('canvas');
    canvas.id = 'matrix-bg';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.prepend(canvas);

    const vig = document.createElement('div');
    vig.id = 'matrix-vignette';
    vig.setAttribute('aria-hidden', 'true');
    canvas.after(vig);

    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!ctx) {
        canvas.remove();
        vig.remove();
        return;
    }

    const rand = (a, b) => a + Math.random() * (b - a);
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

    const TIERS = [
        { name: 'НИЗКОЕ', res: 0.5, fps: 24, stripes: 56, floor: 12, cols: 6, glow: false },
        { name: 'СРЕДНЕЕ', res: 0.7, fps: 30, stripes: 84, floor: 16, cols: 8, glow: true },
        { name: 'ВЫСОКОЕ', res: 1.0, fps: 30, stripes: 120, floor: 20, cols: 10, glow: true },
    ];

    const PAL = ['#ff2222', '#22ff55', '#2244ff', '#ff22cc', '#22e6ff', '#ffffff', '#ff8822'];
    const RGB = PAL.map((h) => [
        parseInt(h.slice(1, 3), 16),
        parseInt(h.slice(3, 5), 16),
        parseInt(h.slice(5, 7), 16),
    ]);
    const PICK = [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 4, 4, 5, 6];
    const pick = () => PICK[(Math.random() * PICK.length) | 0];

    const STEPS = 12;
    const CORE = RGB.map((c) =>
        Array.from({ length: STEPS }, (_, s) => `rgba(${c[0]},${c[1]},${c[2]},${(s + 1) / STEPS})`),
    );
    const GLOW = RGB.map((c) =>
        Array.from(
            { length: STEPS },
            (_, s) => `rgba(${c[0]},${c[1]},${c[2]},${(((s + 1) / STEPS) * 0.22).toFixed(3)})`,
        ),
    );
    const WHITE = Array.from({ length: STEPS }, (_, s) => `rgba(240,246,255,${(s + 1) / STEPS})`);
    const q = (a) => clamp((a * STEPS) | 0, 0, STEPS - 1);

    const GLYPHS = 'アィウェオカキクケコサシスセソタチツテトナニヌネノ0123456789ABCDEF#$%&';

    let W = 0,
        H = 0,
        scale = 0.7;
    let qualityMode = 'auto';
    let tier = 1;
    let level = 0;
    let auth = true;
    let dim = 1,
        targetDim = 1;
    let time = 0,
        lastFrame = 0;
    let burstUntil = -1,
        nextBurst = 1.2;
    let running = false,
        raf = 0;
    let ema = 8,
        upStreak = 0,
        fpsWindow = 0;

    const params = { speed: 1, glow: 1, density: 1 };
    const SPEED = [0.7, 1.7, 3.1];

    const stripes = Array.from({ length: 120 }, () => ({
        side: Math.random() < 0.5 ? -1 : 1,
        x: 1 + Math.random() * 0.5,
        z: rand(0.4, 16),
        top: -(0.2 + Math.random() * 0.4),
        bot: 0.15 + Math.random() * 0.5,
        w: 0.012 + Math.random() * 0.02,
        c: pick(),
    }));
    const floor = Array.from({ length: 20 }, (_, i) => ({ z: 0.4 + i * 0.78, wide: i % 6 === 0 }));
    const rays = Array.from({ length: 12 }, (_, i) => ({
        t: i / 11,
        ph: rand(0, 6.28),
        amp: rand(8, 30),
    }));
    const cols = Array.from({ length: 10 }, () => ({
        x: Math.random(),
        y: rand(-200, 1200),
        sp: rand(18, 70),
        a: rand(0.05, 0.13),
        c: Math.random() < 0.6 ? 1 : 4,
        cv: document.createElement('canvas'),
        next: rand(0, 0.8),
    }));

    const lay = document.createElement('canvas');
    const layCtx = lay.getContext('2d');
    const core = document.createElement('canvas');
    core.width = core.height = 128;
    {
        const c = core.getContext('2d');
        const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
        g.addColorStop(0, 'rgba(255,255,255,0.85)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = g;
        c.fillRect(0, 0, 128, 128);
    }

    function regenStrip(col) {
        col.cv.width = 16;
        col.cv.height = 112;
        const c = col.cv.getContext('2d');
        c.font = '12px monospace';
        c.fillStyle = `rgb(${RGB[col.c][0]},${RGB[col.c][1]},${RGB[col.c][2]})`;
        for (let j = 0; j < 7; j++) {
            c.fillText(GLYPHS[(Math.random() * GLYPHS.length) | 0], 2, 12 + j * 14);
        }
        col.next = time + rand(0.35, 0.8);
    }

    function buildLayer() {
        lay.width = canvas.width;
        lay.height = canvas.height;
        layCtx.setTransform(scale, 0, 0, scale, 0, 0);
        layCtx.clearRect(0, 0, W, H);
        layCtx.setLineDash([5, 9]);
        layCtx.lineWidth = 1.2;
        layCtx.strokeStyle = 'rgba(235,240,255,0.5)';
        const cx = W / 2,
            cy = H * 0.46;
        for (const r of rays) {
            let ex, ey;
            if (r.t < 0.15) {
                ex = -30;
                ey = H * (0.08 + (0.5 * r.t) / 0.15);
            } else if (r.t > 0.85) {
                ex = W + 30;
                ey = H * (0.08 + (0.5 * (1 - r.t)) / 0.15);
            } else {
                ex = W * (0.02 + 0.96 * r.t);
                ey = -30;
            }
            const wob = Math.sin(r.ph) * r.amp;
            layCtx.beginPath();
            layCtx.moveTo(cx, cy);
            layCtx.quadraticCurveTo((cx + ex) / 2 + wob, (cy + ey) / 2 - wob, ex, ey);
            layCtx.stroke();
        }
        layCtx.beginPath();
        layCtx.moveTo(W * 0.52, H * 0.1);
        layCtx.quadraticCurveTo(W * 0.78, H * 0.02, W * 1.05, H * 0.34);
        layCtx.stroke();
        layCtx.beginPath();
        layCtx.moveTo(W * 0.3, H * 0.02);
        layCtx.quadraticCurveTo(W * 0.44, H * 0.22, W * 0.52, H * 0.46);
        layCtx.stroke();
        layCtx.setLineDash([]);
    }

    function resize() {
        W = window.innerWidth;
        H = window.innerHeight;
        scale = TIERS[auth ? tier : 0].res;
        canvas.width = Math.max(2, Math.round(W * scale));
        canvas.height = Math.max(2, Math.round(H * scale));
        buildLayer();
        for (const c of cols) regenStrip(c);
        if (!running) render(0);
    }

    function render(dt) {
        const T = TIERS[auth ? tier : 0];
        const nStripes = clamp(Math.round(T.stripes * params.density), 8, stripes.length);
        const nFloor = clamp(Math.round(T.floor * params.density), 4, floor.length);
        const nCols = clamp(Math.round(T.cols * params.density), 2, cols.length);
        const bursting = time < burstUntil;
        const speed = SPEED[level] * params.speed * (bursting ? 1.6 : 1);

        for (let i = 0; i < nStripes; i++) {
            const s = stripes[i];
            s.z -= speed * dt;
            if (s.z < 0.35) {
                s.z = rand(15, 18);
                s.c = pick();
                s.x = 1 + Math.random() * 0.5;
                s.top = -(0.2 + Math.random() * 0.4);
                s.bot = 0.15 + Math.random() * 0.5;
            }
        }
        for (let i = 0; i < nFloor; i++) {
            const f = floor[i];
            f.z -= speed * dt;
            if (f.z < 0.4) f.z += 20 * 0.78;
        }
        for (let i = 0; i < nCols; i++) {
            const c = cols[i];
            c.y += c.sp * dt * (level === 0 ? 0.4 : 1) * params.speed;
            if (c.y > H + 140) {
                c.y = -140;
                c.x = Math.random();
            }
            if (time > c.next) regenStrip(c);
        }

        if (level > 0 && time > nextBurst) {
            burstUntil = time + rand(0.1, 0.16 + 0.14 * level);
            nextBurst = time + (level === 2 ? rand(0.4, 0.9) : rand(1.4, 3.2));
        }

        ctx.setTransform(scale, 0, 0, scale, 0, 0);
        if (bursting) ctx.translate(rand(-3, 3) * level, rand(-2, 2) * level);
        ctx.fillStyle = '#04060f';
        ctx.fillRect(-12, -12, W + 24, H + 24);

        const cx = W / 2,
            cy = H * 0.46,
            f = H * 0.95;

        for (let i = 0; i < nCols; i++) {
            const c = cols[i];
            ctx.globalAlpha = clamp(c.a * (bursting ? 2.6 : 1) * dim, 0, 1);
            ctx.drawImage(c.cv, c.x * W, c.y, 16, 112);
        }
        ctx.globalAlpha = 1;

        for (let i = 0; i < nFloor; i++) {
            const fl = floor[i];
            const y = cy + (0.62 * f) / fl.z;
            if (y > H + 40) continue;
            const hw = (0.62 * f) / fl.z;
            const a = clamp(1.4 / fl.z, 0.12, 0.9) * dim;
            ctx.fillStyle = WHITE[q(a)];
            ctx.fillRect(cx - hw, y, hw * 2, clamp(3.2 / fl.z, 1, 5));
            if (fl.wide) {
                ctx.globalAlpha = 0.22;
                ctx.fillRect(0, y, W, 1);
                ctx.globalAlpha = 1;
            }
        }

        for (let i = 0; i < nStripes; i++) {
            const s = stripes[i];
            const x = cx + (s.side * s.x * f) / s.z;
            if (x < -60 || x > W + 60) continue;
            const yT = cy + (s.top * f) / s.z;
            const yB = cy + (s.bot * f) / s.z;
            const w = Math.max(1.2, (s.w * f) / s.z);
            const a = clamp(2.2 / s.z, 0.25, 1) * dim;
            const step = q(a);
            if (T.glow && params.glow > 0.05 && a > 0.45) {
                ctx.globalAlpha = clamp(params.glow, 0, 2);
                ctx.fillStyle = GLOW[s.c][step];
                ctx.fillRect(x - w * 1.8, yT, w * 3.6, yB - yT);
                ctx.globalAlpha = 1;
            }
            ctx.fillStyle = CORE[s.c][step];
            ctx.fillRect(x - w / 2, yT, w, yB - yT);
        }

        ctx.globalAlpha = dim;
        ctx.drawImage(lay, 0, 0, W, H);
        ctx.globalAlpha = clamp(0.9 * dim * params.glow, 0, 1);
        ctx.drawImage(core, cx - 60, cy - 60, 120, 120);
        ctx.globalAlpha = 1;

        if (bursting) {
            const n = level === 2 ? 4 : 2;
            for (let i = 0; i < n; i++) {
                const sh = rand(4, Math.min(26, Math.max(4, H * 0.3)));
                const sy = rand(0, Math.max(1, H - sh));
                const dx = rand(-26, 26) * level;
                const syDev = clamp(Math.floor(sy * scale), 0, canvas.height - 1);
                const shDev = clamp(Math.round(sh * scale), 1, canvas.height - syDev);
                ctx.drawImage(
                    canvas,
                    0,
                    syDev,
                    canvas.width,
                    shDev,
                    dx,
                    syDev / scale,
                    W,
                    shDev / scale,
                );
            }
            const shift = rand(4, 12) * level;
            ctx.fillStyle = `rgba(255,0,70,${0.07 * level})`;
            ctx.fillRect(-shift, 0, W * 0.14, H);
            ctx.fillStyle = `rgba(0,230,255,${0.07 * level})`;
            ctx.fillRect(W * 0.86 + shift, 0, W * 0.14, H);
            for (let k = 0; k < 2; k++) {
                const c = cols[(Math.random() * nCols) | 0];
                ctx.globalAlpha = 0.45;
                ctx.drawImage(c.cv, rand(0, W - 16), rand(0, Math.max(1, H - 112)), 16, 112);
                ctx.globalAlpha = 1;
            }
            if (tier > 0 && auth) {
                ctx.globalCompositeOperation = 'difference';
                ctx.fillStyle = 'rgba(255,255,255,0.9)';
                ctx.fillRect(
                    rand(0, Math.max(1, W - 160)),
                    rand(0, Math.max(1, H - 20)),
                    rand(40, 160),
                    rand(6, 18),
                );
                ctx.globalCompositeOperation = 'source-over';
            }
        }

        if (dim < 0.999) {
            ctx.fillStyle = `rgba(4,6,15,${((1 - dim) * 0.82).toFixed(3)})`;
            ctx.fillRect(-12, -12, W + 24, H + 24);
        }
    }

    const interval = () => 1000 / (auth ? TIERS[tier].fps : 18);

    function loop(now) {
        raf = requestAnimationFrame(loop);
        if (now - lastFrame < interval() - 0.5) return;
        const dt = clamp((now - lastFrame) / 1000, 0, 0.1);
        lastFrame = now;
        time += dt;
        dim += (targetDim - dim) * Math.min(1, dt * 3);

        const t0 = performance.now();
        render(dt);
        ema = ema * 0.9 + (performance.now() - t0) * 0.1;

        if (now - fpsWindow >= 1000) {
            fpsWindow = now;
            if (qualityMode === 'auto' && auth) {
                if (ema > 11 && tier > 0) {
                    upStreak = 0;
                    setTier(tier - 1);
                } else if (ema < 4.5 && tier < 2) {
                    if (++upStreak >= 3) {
                        upStreak = 0;
                        setTier(tier + 1);
                    }
                } else {
                    upStreak = 0;
                }
            }
        }
    }

    function setTier(t) {
        tier = clamp(t | 0, 0, 2);
        resize();
    }

    function start() {
        if (running) return;
        running = true;
        lastFrame = performance.now();
        fpsWindow = lastFrame;
        raf = requestAnimationFrame(loop);
    }
    function stop() {
        running = false;
        cancelAnimationFrame(raf);
    }
    function staticFrame() {
        stop();
        dim = targetDim;
        render(0);
    }

    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    let animations = true;
    let resizeFrame = 0;

    function applyMotion() {
        canvas.dataset.motion = !animations || reducedMotion?.matches ? 'static' : 'animated';
        if (document.hidden) {
            stop();
        } else if (!animations || reducedMotion?.matches) {
            staticFrame();
        } else {
            start();
        }
    }

    function queueResize() {
        if (resizeFrame) return;
        resizeFrame = requestAnimationFrame(() => {
            resizeFrame = 0;
            resize();
        });
    }

    reducedMotion?.addEventListener('change', applyMotion);
    document.addEventListener('visibilitychange', applyMotion);
    window.addEventListener('resize', queueResize);

    return {
        update(prefs, isAuth) {
            const layoutChanged = auth !== isAuth;
            auth = isAuth;
            targetDim = auth ? 1 : 0.5;
            animations = prefs.anim;
            level = prefs.fx;
            qualityMode = prefs.quality === 'auto' ? 'auto' : 'manual';
            params.speed = prefs.speed;
            params.glow = prefs.glow;
            params.density = prefs.density;
            const nextTier =
                qualityMode === 'auto' ? (window.innerWidth < 700 ? 0 : 1) : prefs.quality;
            if (!W || layoutChanged || nextTier !== tier) setTier(nextTier);
            applyMotion();
        },
        destroy() {
            stop();
            cancelAnimationFrame(resizeFrame);
            window.removeEventListener('resize', queueResize);
            document.removeEventListener('visibilitychange', applyMotion);
            reducedMotion?.removeEventListener('change', applyMotion);
            canvas.remove();
            vig.remove();
        },
    };
}
