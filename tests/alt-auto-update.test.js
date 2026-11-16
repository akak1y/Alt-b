import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const { checkGithub, checkSite } = createRequire(import.meta.url)('../ops/alt-auto-update.js');
const version = 'a'.repeat(40);

function fakeGithub(runs, status = 200) {
    return vi.fn(async () => ({
        ok: status === 200,
        status,
        json: async () => ({ workflow_runs: runs }),
    }));
}

describe('проверка коммита перед обновлением сайта', () => {
    it('разрешает только успешно проверенный коммит main', async () => {
        const fetchImpl = fakeGithub([
            {
                head_sha: version,
                head_branch: 'main',
                event: 'push',
                status: 'completed',
                conclusion: 'success',
            },
        ]);
        expect(await checkGithub(version, fetchImpl)).toBe(true);
        const url = new URL(fetchImpl.mock.calls[0][0]);
        expect(url.pathname).toContain('/workflows/check-main.yml/runs');
        expect(url.searchParams.get('head_sha')).toBe(version);
        expect(url.searchParams.get('branch')).toBe('main');
    });

    it('не обновляет сайт для другого коммита, ветки или незавершённой проверки', async () => {
        const runs = [
            {
                head_sha: 'b'.repeat(40),
                head_branch: 'main',
                event: 'push',
                status: 'completed',
                conclusion: 'success',
            },
            {
                head_sha: version,
                head_branch: 'feature',
                event: 'push',
                status: 'completed',
                conclusion: 'success',
            },
            {
                head_sha: version,
                head_branch: 'main',
                event: 'push',
                status: 'in_progress',
                conclusion: null,
            },
        ];
        expect(await checkGithub(version, fakeGithub(runs))).toBe(false);
    });

    it('не обновляет сайт после проваленной проверки или до публикации проверки', async () => {
        const failed = {
            head_sha: version,
            head_branch: 'main',
            event: 'push',
            status: 'completed',
            conclusion: 'failure',
        };
        expect(await checkGithub(version, fakeGithub([failed]))).toBe(false);
        expect(await checkGithub(version, fakeGithub([], 404))).toBe(false);
    });
});

describe('проверка сайта после перезапуска', () => {
    it('дожидается запуска сервера после временной ошибки', async () => {
        const fetchImpl = vi
            .fn()
            .mockResolvedValueOnce({ ok: false })
            .mockResolvedValueOnce({ ok: true, text: async () => '<script src="/js/alt.js">' });
        const wait = vi.fn(async () => {});
        await checkSite(fetchImpl, wait);
        expect(fetchImpl).toHaveBeenCalledTimes(2);
        expect(wait).toHaveBeenCalledTimes(1);
    });
});
