const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const V2 = __dirname;
const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');
const pkg = JSON.parse(fs.readFileSync(path.join(V2, 'package.json'), 'utf8'));
const fork = pkg.cor3Fork || null;
// CI/release runs can override the build counter without editing package.json.
// Local builds append the committed counter to the release label.
const buildOverride = process.env.COR3_BUILD === undefined ? null : Number(process.env.COR3_BUILD);
if (buildOverride !== null && (!Number.isInteger(buildOverride) || buildOverride < 1)) {
    console.error('COR3_BUILD must be a positive integer');
    process.exit(1);
}
const buildNumber = buildOverride ?? fork?.build ?? 1;
const releaseLabel = typeof fork?.releaseLabel === 'string' ? fork.releaseLabel : null;
const computedVersionName = releaseLabel
    ? `${pkg.version}-${releaseLabel}.${buildNumber}`
    : pkg.version;
const versionName = (process.env.COR3_VERSION_NAME || '').trim() || computedVersionName;

function cleanDist() {
    if (fs.existsSync(DIST)) fs.rmSync(DIST, { recursive: true, force: true });
    fs.mkdirSync(DIST, { recursive: true });
}

function copyFile(relative, destination) {
    const src = path.join(V2, relative);
    if (!fs.existsSync(src)) return;
    const dest = path.join(DIST, destination || path.basename(relative));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
}

function copyRootFile(relative, destination) {
    const src = path.join(ROOT, relative);
    if (!fs.existsSync(src)) return;
    const dest = path.join(DIST, destination || path.basename(relative));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
}

function copyDir(src, dest) {
    if (!fs.existsSync(src)) return;
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const from = path.join(src, entry.name);
        const to = path.join(dest, entry.name);
        if (entry.isDirectory()) copyDir(from, to);
        else fs.copyFileSync(from, to);
    }
}

function writeManifest() {
    const manifest = JSON.parse(fs.readFileSync(path.join(V2, 'manifest.json'), 'utf8'));
    manifest.version = pkg.version;
    manifest.version_name = versionName;
    fs.writeFileSync(path.join(DIST, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
}

async function build() {
    cleanDist();
    writeManifest();
    copyFile('src/html/popup.html');
    copyFile('src/html/sidepanel.html');
    copyFile('src/html/popup.css');
    copyFile('src/html/devtools.html');
    copyFile('src/html/devtools-panel.html');
    copyFile('src/html/devtools-log-viewer.html');
    copyFile('src/html/devtools.css');
    copyRootFile('src/libs/notepack.min.js');
    copyRootFile('src/libs/msgpack-codec.js');
    copyRootFile('catalog/item-catalog.json');
    copyDir(path.join(ROOT, 'icon'), path.join(DIST, 'icon'));
    copyDir(path.join(ROOT, 'factions'), path.join(DIST, 'factions'));

    const common = {
        bundle: true,
        format: 'iife',
        target: ['chrome120'],
        sourcemap: false,
        minify: process.env.MINIFY === '1',
        legalComments: 'none',
        logLevel: 'info',
        jsx: 'automatic',
        jsxImportSource: 'preact',
        outdir: DIST,
    };

    await esbuild.build({
        ...common,
        entryPoints: [path.join(V2, 'src/contexts/background/index.ts')],
        outfile: path.join(DIST, 'background.js'),
        outdir: undefined,
    });

    await esbuild.build({
        ...common,
        entryPoints: [path.join(V2, 'src/contexts/main-world/index.ts')],
        outfile: path.join(DIST, 'main-world.js'),
        outdir: undefined,
    });

    await esbuild.build({
        ...common,
        entryPoints: [path.join(V2, 'src/contexts/content/index.ts')],
        outfile: path.join(DIST, 'content.js'),
        outdir: undefined,
    });

    await esbuild.build({
        ...common,
        entryPoints: [path.join(V2, 'src/contexts/popup/index.tsx')],
        outfile: path.join(DIST, 'popup.js'),
        outdir: undefined,
    });

    await esbuild.build({
        ...common,
        entryPoints: [path.join(V2, 'src/contexts/sidepanel/index.tsx')],
        outfile: path.join(DIST, 'sidepanel.js'),
        outdir: undefined,
    });

    await esbuild.build({
        ...common,
        entryPoints: [path.join(V2, 'src/contexts/devtools/index.ts')],
        outfile: path.join(DIST, 'devtools.js'),
        outdir: undefined,
    });

    await esbuild.build({
        ...common,
        entryPoints: [path.join(V2, 'src/contexts/devtools/panel.tsx')],
        outfile: path.join(DIST, 'devtools-panel.js'),
        outdir: undefined,
    });

    await esbuild.build({
        ...common,
        entryPoints: [path.join(V2, 'src/contexts/devtools/log-viewer.tsx')],
        outfile: path.join(DIST, 'devtools-log-viewer.js'),
        outdir: undefined,
    });

    console.log(`Built ${versionName} into ${DIST}`);
}

build().catch((err) => {
    console.error('v2 build failed:', err);
    process.exit(1);
});
