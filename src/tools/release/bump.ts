import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

interface PackageJson {
    readonly version: string;
    readonly cor3Fork?: {
        readonly label?: string;
        readonly releaseLabel?: string;
        readonly build?: number;
    };
}

/**
 * Increments `cor3Fork.build` in package.json. Local artifacts derive their
 * `version_name` from this value in build.js; releases use the tag version
 * without the local counter.
 */
async function main(): Promise<void> {
    const path = resolve(process.cwd(), 'package.json');
    const pkg = JSON.parse(await readFile(path, 'utf8')) as PackageJson;
    const current = pkg.cor3Fork?.build ?? 0;
    const next = current + 1;
    const updated = {
        ...pkg,
        cor3Fork: {
            ...pkg.cor3Fork,
            build: next,
        },
    };
    await writeFile(path, JSON.stringify(updated, null, 4) + '\n', 'utf8');
    const label = pkg.cor3Fork?.releaseLabel ?? pkg.cor3Fork?.label;
    console.log(`Build ${label ? `${pkg.version}-${label}.${next}` : next} (was ${current})`);
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
