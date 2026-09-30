const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const watch = process.argv.includes('--watch');

const DIST = path.join(__dirname, 'dist');

const sharedConfig = {
    bundle: true,
    format: 'iife',
    target: ['chrome120'],
    sourcemap: false,
    minify: false,
    legalComments: 'none',
    logLevel: 'info',
    outdir: DIST,
};

const entryPoints = [
    // Modularized entry points — bundled by esbuild
    { in: 'src/auto-job-solver/index.js', out: 'auto-job-solver' },
    { in: 'src/auto-valuable-seller/index.js', out: 'auto-valuable-seller' },
    { in: 'src/background/index.js', out: 'background' },
    { in: 'src/content/index.js', out: 'content' },
    { in: 'src/content-early/index.js', out: 'content-early' },
    { in: 'src/popup/index.js', out: 'popup' },
    { in: 'src/devtools-panel/index.js', out: 'devtools-panel' },
    { in: 'src/devtools-log-viewer/index.js', out: 'devtools-log-viewer' },
];

const staticFiles = [
    // Root config
    'manifest.json',
    'versions.json',

    // HTML / CSS (src/html/ → dist/)
    'src/html/popup.html',
    'src/html/popup.css',
    'src/html/devtools.html',
    'src/html/devtools.js',
    'src/html/devtools-panel.html',
    'src/html/devtools-log-viewer.html',

    // Shared libs — loaded via importScripts / content_scripts (src/libs/ → dist/)
    'src/libs/notepack.min.js',
    'src/libs/msgpack-codec.js',
    'src/libs/console-logger.js',
    'src/libs/errors.js',
    'src/libs/ws-messages.js',

    // Standalone scripts — injected at runtime, can't be bundled (src/standalone/ → dist/)
    'src/standalone/ws-interceptor.js',
    'src/standalone/decrypt-solver.js',
    'src/standalone/ice-wall-solver.js',
    'src/standalone/simple-decrypt-solver.js',
    'src/standalone/daily-hack-solver.js',
];

const staticDirs = [
    'icon',
    'factions',
];

function cleanDist() {
    if (fs.existsSync(DIST)) {
        console.log('Deleting the "dist" folder...');
        fs.rmSync(DIST, { recursive: true, force: true });
        console.log('Re-creating the "dist" folder...');
    } else {
        console.log('Creating the "dist" folder...');
    }
    fs.mkdirSync(DIST, { recursive: true });
}

function copyStaticFiles() {
    const pkgVersion = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version;

    for (const file of staticFiles) {
        const src = path.join(__dirname, file);
        const dest = path.join(DIST, path.basename(file));
        if (!fs.existsSync(src)) continue;

        // Auto update manifest extension version by using "package.json" data
        if (path.basename(file) === 'manifest.json') {
            const manifest = JSON.parse(fs.readFileSync(src, 'utf8'));
            manifest.version = pkgVersion;
            delete manifest._version_note;
            fs.writeFileSync(dest, JSON.stringify(manifest, null, 2) + '\n');
        } else {
            fs.copyFileSync(src, dest);
        }
    }

    for (const dir of staticDirs) {
        const src = path.join(__dirname, dir);
        const dest = path.join(DIST, dir);
        if (fs.existsSync(src)) {
            copyDirSync(src, dest);
        }
    }
}

function copyDirSync(src, dest) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDirSync(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

function syncPackageLockVersion(version) {
    const lockPath = path.join(__dirname, 'package-lock.json');
    if (!fs.existsSync(lockPath)) return;
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    let changed = false;
    if (lock.version !== version) { lock.version = version; changed = true; }
    if (lock.packages && lock.packages[''] && lock.packages[''].version !== version) {
        lock.packages[''].version = version; changed = true;
    }
    if (changed) {
        fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
        console.log(`Synced package-lock.json version to ${version}`);
    }
}

async function build() {
    cleanDist();
    const pkgVersion = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version;
    syncPackageLockVersion(pkgVersion);
    console.log('Copying static files...');
    copyStaticFiles();

    const buildEntries = entryPoints.map(ep => {
        const config = {
            entryPoints: [ep.in],
            outfile: path.join(DIST, ep.out + '.js'),
            ...sharedConfig,
            outdir: undefined,
        };
        // background.js is a service worker — prepend importScripts for shared libs
        if (ep.out === 'background') {
            config.banner = { js: "importScripts('console-logger.js');\nimportScripts('errors.js');\n" };
        }
        return config;
    });

    if (watch) {
        console.log('Starting watch mode...');
        for (const config of buildEntries) {
            const ctx = await esbuild.context(config);
            await ctx.watch();
        }
        console.log('Watching for changes...');
    } else {
        for (const config of buildEntries) {
            await esbuild.build(config);
        }
        console.log('Build complete!');
    }
}

build().catch((err) => {
    console.error('Build failed:', err);
    process.exit(1);
});
