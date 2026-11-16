const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { compile } = require('@vue/compiler-dom');
const esbuild = require('esbuild');

const html = fs.readFileSync(path.join(__dirname, 'public/index.html'), 'utf8');
const dom = new JSDOM(html);
const template = dom.window.document.querySelector('#app').innerHTML;
dom.window.close();

const compiled = compile(template, { mode: 'module', prefixIdentifiers: true });

esbuild
    .build({
        entryPoints: [path.join(__dirname, 'public/js/app.js')],
        outfile: path.join(__dirname, 'public/js/alt.js'),
        bundle: true,
        platform: 'browser',
        format: 'iife',
        target: 'es2022',
        minify: true,
        define: {
            __VUE_OPTIONS_API__: 'true',
            __VUE_PROD_DEVTOOLS__: 'false',
            __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
        },
        plugins: [
            {
                name: 'alt-template',
                setup(build) {
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
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
