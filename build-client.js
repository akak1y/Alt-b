const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { compile } = require('@vue/compiler-dom');
const esbuild = require('esbuild');

// Эта программа выполняется при npm run build, а не в браузере.
// Из разметки #app заранее собираем шаблон Vue: браузеру не нужен компилятор.
const html = fs.readFileSync(path.join(__dirname, 'public/index.html'), 'utf8');
const dom = new JSDOM(html);
const template = dom.window.document.querySelector('#app').innerHTML;
dom.window.close();

const compiled = compile(template, { mode: 'module', prefixIdentifiers: true });
const cryptoEntry = require.resolve('@matrix-org/matrix-sdk-crypto-wasm', {
    paths: [path.dirname(require.resolve('matrix-js-sdk'))],
});
const wasmPath = 'pkg/matrix_sdk_crypto_wasm_bg.wasm';
const wasmOutput = path.join(__dirname, 'public/js', wasmPath);

// Объединяем app.js, matrix-client.js и Matrix SDK в public/js/alt.js.
// Этот файл генерируется заново и не хранится в Git — редактируйте исходники.
esbuild
    .build({
        entryPoints: [path.join(__dirname, 'public/js/app.js')],
        outfile: path.join(__dirname, 'public/js/alt.js'),
        bundle: true,
        platform: 'browser',
        format: 'iife',
        target: 'es2022',
        minify: true,
        // WASM-обёртка SDK разрешает URL относительно import.meta.url. Бандл IIFE
        // берёт URL из тега script до отложенной загрузки Rust Crypto.
        banner: {
            js: "const altBundleUrl = document.currentScript?.src || new URL('/js/alt.js', document.baseURI).href;",
        },
        define: {
            'import.meta.url': 'altBundleUrl',
            __VUE_OPTIONS_API__: 'true',
            __VUE_PROD_DEVTOOLS__: 'false',
            __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
        },
        plugins: [
            {
                name: 'alt-template',
                setup(build) {
                    // Псевдомодуль alt-template в app.js получает уже
                    // подготовленный код шаблона, а не отдельный файл.
                    build.onResolve({ filter: /^alt-template$/ }, () => ({
                        path: 'alt-template',
                        namespace: 'alt-template',
                    }));
                    build.onLoad({ filter: /.*/, namespace: 'alt-template' }, () => ({
                        contents: compiled.code,
                        loader: 'js',
                        resolveDir: __dirname,
                    }));
                },
            },
        ],
    })
    .then(() => {
        fs.mkdirSync(path.dirname(wasmOutput), { recursive: true });
        fs.copyFileSync(path.join(path.dirname(cryptoEntry), wasmPath), wasmOutput);
    })
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
