const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

// Это служебная программа VM, а НЕ часть браузерного клиента.
// Её запускает systemd-таймер от имени alt-deploy; вручную при разработке
// выполнять не нужно. Основные файлы конфигурации службы лежат рядом в ops/.
const directory = '/opt/alt';
const deployedVersionFile = '/var/lib/alt-deploy/deployed-sha';
const workflowRunsUrl =
    'https://api.github.com/repos/akak1y/Alt-b/actions/workflows/check-main.yml/runs';

// Выполняет команду и возвращает её текстовый результат (например, SHA Git).
// При ошибке процесса execFileSync выбросит исключение и остановит обновление.
function command(binary, args) {
    return execFileSync(binary, args, {
        cwd: directory,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'inherit'],
        timeout: 120_000,
    }).trim();
}

// Выполняет команду с выводом в журнал службы: так видны fetch, npm и тесты.
function run(binary, args) {
    execFileSync(binary, args, {
        cwd: directory,
        stdio: 'inherit',
        timeout: 120_000,
    });
}

// Короткий способ запускать читающие команды Git внутри /opt/alt.
function git(...args) {
    return command('/usr/bin/git', args);
}

/**
 * Сверяет ТОЧНЫЙ коммит main с завершённым успешным запуском проверки GitHub.
 * Ветка, событие push и SHA проверяются вместе: чужая ветка либо успех
 * другого коммита не разрешают менять сайт. Пока проверка идёт или GitHub
 * не опубликовал её результат, возвращаем false и ждём следующего таймера.
 * fetchImpl позволяет проверять это правило без обращения к GitHub в тестах.
 */
async function checkGithub(version, fetchImpl = fetch) {
    const url = new URL(workflowRunsUrl);
    url.searchParams.set('branch', 'main');
    url.searchParams.set('event', 'push');
    url.searchParams.set('head_sha', version);
    url.searchParams.set('per_page', '20');

    const response = await fetchImpl(url, {
        headers: {
            Accept: 'application/vnd.github+json',
            'User-Agent': 'alt-auto-update',
        },
        signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 404) {
        console.log('Проверка main ещё не опубликована; сайт не меняется.');
        return false;
    }
    if (!response.ok)
        throw new Error(`Не удалось получить результаты проверки: ${response.status}`);

    const data = await response.json();
    const run = data.workflow_runs?.find(
        (item) => item.head_sha === version && item.head_branch === 'main' && item.event === 'push',
    );
    if (!run || run.status !== 'completed') {
        console.log(`Проверка коммита ${version.slice(0, 7)} ещё не завершена.`);
        return false;
    }
    if (run.conclusion !== 'success') {
        console.log(`Проверка коммита ${version.slice(0, 7)} не прошла: ${run.conclusion}.`);
        return false;
    }
    return true;
}

/**
 * После перезапуска проверяет страницу по HTTPS и наличие собранного клиента.
 * Короткие повторные попытки нужны потому, что процесс сервера запускается
 * не мгновенно. Только успешная проверка позволяет пометить версию установленной.
 */
async function checkSite(
    fetchImpl = fetch,
    wait = () => new Promise((done) => setTimeout(done, 1000)),
) {
    for (let attempt = 0; attempt < 12; attempt += 1) {
        try {
            const response = await fetchImpl('https://alt.creatusest.ru/', {
                signal: AbortSignal.timeout(5_000),
            });
            if (response.ok && (await response.text()).includes('/js/alt.js')) return;
        } catch {
            // Сервису может потребоваться немного времени после перезапуска.
        }
        if (attempt < 11) await wait();
    }
    throw new Error('После обновления сайт не прошёл проверку по HTTPS.');
}

/**
 * Один цикл обновления сайта. При локальных правках в /opt/alt прекращает
 * работу, забирает только main и требует его успешной проверки на GitHub.
 * Затем устанавливает зависимости, повторяет проверки на VM, перезапускает
 * службу и подтверждает ответ сайта. Файл deployed-sha обновляется последним.
 * Важно: автоматического отката после ошибки нет — причина видна в журнале.
 */
async function main() {
    if (git('status', '--porcelain')) {
        throw new Error('В /opt/alt есть несохранённые изменения; обновление остановлено.');
    }

    run('/usr/bin/git', ['fetch', '--no-tags', 'origin', 'main']);
    const version = git('rev-parse', 'refs/remotes/origin/main');
    const current = git('rev-parse', 'HEAD');
    const deployed = fs.readFileSync(deployedVersionFile, 'utf8').trim();

    if (version === current && version === deployed) {
        console.log(`Уже установлена версия ${version.slice(0, 7)}.`);
        return;
    }
    if (version !== current) {
        git('merge-base', '--is-ancestor', current, version);
    }
    if (!(await checkGithub(version))) return;

    if (version !== current) run('/usr/bin/git', ['merge', '--ff-only', version]);
    run('/usr/local/bin/npm', ['ci', '--include=dev', '--no-audit', '--no-fund']);
    run('/usr/local/bin/npm', ['run', 'check']);
    run('/usr/bin/sudo', ['-n', '/usr/bin/systemctl', 'restart', 'alt-client.service']);

    await checkSite();
    fs.writeFileSync(deployedVersionFile, `${version}\n`);
    console.log(`Сайт обновлён до ${version.slice(0, 7)}.`);
}

if (require.main === module) {
    main().catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
}

module.exports = { checkGithub, checkSite };
