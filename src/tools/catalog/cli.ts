import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { catalogSourceSchema } from '../../contracts/catalog-source.js';
import { parseItemCatalog } from '../../contracts/catalog.js';
import type { ItemCatalog } from '../../domains/loadout/model.js';
import { buildCatalog, catalogSourceFromLoadout, diffCatalogs } from '../../application/catalog/catalog.js';
import { buildCatalogManifest, catalogChecksum } from './manifest.js';
import { rawLoadoutSchema } from '../../contracts/loadout.js';

function usage(): never {
    console.error(`Usage:
  catalog build --input <raw-source.json> --output <catalog.json> [--manifest <manifest.json>]
  catalog from-loadout --input <raw-loadout.json> --output <catalog.json> [--catalog-version <v>] [--game-version <v>]
  catalog validate <catalog.json>
  catalog diff <before.json> <after.json>
  catalog checksum <catalog.json>`);
    process.exit(1);
}

async function readJson(path: string): Promise<unknown> {
    return JSON.parse(await readFile(resolve(path), 'utf8')) as unknown;
}

async function writeJson(path: string, value: unknown): Promise<void> {
    const target = resolve(path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function option(args: readonly string[], name: string): string | null {
    const index = args.indexOf(name);
    if (index < 0) return null;
    return args[index + 1] ?? null;
}

async function build(args: readonly string[]): Promise<void> {
    const input = option(args, '--input');
    const output = option(args, '--output');
    if (!input || !output) usage();
    const source = catalogSourceSchema.parse(await readJson(input));
    const catalog = buildCatalog(source);
    const manifestPath = option(args, '--manifest') ?? `${output}.manifest.json`;
    const manifest = await buildCatalogManifest(catalog, source);
    await writeJson(output, catalog);
    await writeJson(manifestPath, manifest);
    console.log(`Built ${catalog.hardware.length} hardware / ${catalog.software.length} software definitions`);
    console.log(`Checksum ${manifest.checksum}`);
}

async function fromLoadout(args: readonly string[]): Promise<void> {
    const input = option(args, '--input');
    const output = option(args, '--output');
    if (!input || !output) usage();
    const raw = rawLoadoutSchema.parse(await readJson(input));
    const capturedAt = new Date().toISOString();
    const source = catalogSourceFromLoadout(raw, {
        catalogVersion: option(args, '--catalog-version') ?? `runtime-${capturedAt.slice(0, 10)}`,
        gameVersion: option(args, '--game-version') ?? 'unknown',
        capturedAt,
    });
    const catalog = buildCatalog(source);
    const manifestPath = option(args, '--manifest') ?? `${output}.manifest.json`;
    const manifest = await buildCatalogManifest(catalog, source);
    await writeJson(output, catalog);
    await writeJson(manifestPath, manifest);
    console.log(`Built ${catalog.hardware.length} hardware / ${catalog.software.length} software definitions from a loadout capture`);
    console.log(`Checksum ${manifest.checksum}`);
}

async function validate(args: readonly string[]): Promise<void> {
    const input = args[0];
    if (!input) usage();
    const catalog = parseItemCatalog(await readJson(input)) as unknown as ItemCatalog;
    console.log(`Valid catalog: ${catalog.catalogVersion} (${catalog.gameVersion})`);
    console.log(`${catalog.hardware.length} hardware, ${catalog.software.length} software`);
}

async function diff(args: readonly string[]): Promise<void> {
    const beforePath = args[0];
    const afterPath = args[1];
    if (!beforePath || !afterPath) usage();
    const before = parseItemCatalog(await readJson(beforePath)) as unknown as ItemCatalog;
    const after = parseItemCatalog(await readJson(afterPath)) as unknown as ItemCatalog;
    console.log(JSON.stringify(diffCatalogs(before, after), null, 2));
}

async function checksum(args: readonly string[]): Promise<void> {
    const input = args[0];
    if (!input) usage();
    const catalog = parseItemCatalog(await readJson(input)) as unknown as ItemCatalog;
    console.log(await catalogChecksum(catalog));
}

async function main(): Promise<void> {
    const [command, ...args] = process.argv.slice(2);
    switch (command) {
        case 'build': await build(args); return;
        case 'from-loadout': await fromLoadout(args); return;
        case 'validate': await validate(args); return;
        case 'diff': await diff(args); return;
        case 'checksum': await checksum(args); return;
        default: usage();
    }
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
