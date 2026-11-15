import type { CatalogSource } from '../../contracts/catalog-source.js';
import type { RawLoadout } from '../../contracts/loadout.js';
import { parseItemCatalog } from '../../contracts/catalog.js';
import type { ItemCatalog } from '../../domains/loadout/model.js';
import { mapRawHardware, mapRawSoftware } from '../loadout/raw-mapper.js';

export interface CatalogDiff {
    readonly addedHardware: readonly string[];
    readonly removedHardware: readonly string[];
    readonly changedHardware: readonly string[];
    readonly addedSoftware: readonly string[];
    readonly removedSoftware: readonly string[];
    readonly changedSoftware: readonly string[];
}

/**
 * Wraps a raw loadout capture (the same `ownedHardware` / `ownedSoftware`
 * payload returned by `V2_LOADOUT_GET`) into a catalog source. A maxed account
 * produces the most complete catalog; a normal account only contains items it
 * owns.
 */
export function catalogSourceFromLoadout(
    raw: RawLoadout,
    metadata: { readonly catalogVersion: string; readonly gameVersion: string; readonly capturedAt?: string },
): CatalogSource {
    return {
        catalogVersion: metadata.catalogVersion,
        gameVersion: metadata.gameVersion,
        source: 'raw-loadout-capture',
        ...(metadata.capturedAt ? { capturedAt: metadata.capturedAt } : {}),
        hardware: raw.ownedHardware ?? [],
        software: raw.ownedSoftware ?? [],
    };
}

/**
 * Combines the shipped static catalog with the runtime catalog built from the
 * player's owned items. Runtime definitions win on id conflicts because they
 * carry the player's current item data; static-only definitions are added so
 * the optimizer can reason about items the player does not own yet.
 */
export function mergeCatalogs(runtime: ItemCatalog, staticCatalog: ItemCatalog | null): ItemCatalog {
    if (!staticCatalog) return runtime;
    const hardware = new Map(staticCatalog.hardware.map((item) => [item.id, item] as const));
    for (const item of runtime.hardware) hardware.set(item.id, item);
    const software = new Map(staticCatalog.software.map((item) => [item.id, item] as const));
    for (const item of runtime.software) software.set(item.id, item);
    return {
        catalogVersion: staticCatalog.catalogVersion,
        gameVersion: staticCatalog.gameVersion,
        hardware: [...hardware.values()],
        software: [...software.values()],
    };
}

export function buildCatalog(source: CatalogSource): ItemCatalog {
    return parseItemCatalog({
        catalogVersion: source.catalogVersion,
        gameVersion: source.gameVersion,
        hardware: source.hardware.map(mapRawHardware).filter((item): item is NonNullable<typeof item> => item !== null),
        software: source.software.map(mapRawSoftware).filter((item) => item.abilities.length > 0),
    }) as unknown as ItemCatalog;
}

function stable(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object') {
        const result: Record<string, unknown> = {};
        for (const key of Object.keys(value as Record<string, unknown>).sort()) {
            result[key] = stable((value as Record<string, unknown>)[key]);
        }
        return result;
    }
    return value;
}

export function canonicalJson(value: unknown): string {
    return JSON.stringify(stable(value));
}

function byId<T extends { readonly id: string }>(items: readonly T[]): Map<string, T> {
    return new Map(items.map((item) => [item.id, item]));
}

function diffPart<T extends { readonly id: string }>(before: readonly T[], after: readonly T[]): {
    added: string[];
    removed: string[];
    changed: string[];
} {
    const oldById = byId(before);
    const newById = byId(after);
    const added: string[] = [];
    const removed: string[] = [];
    const changed: string[] = [];
    for (const id of newById.keys()) if (!oldById.has(id)) added.push(id);
    for (const id of oldById.keys()) if (!newById.has(id)) removed.push(id);
    for (const [id, next] of newById) {
        const previous = oldById.get(id);
        if (previous && canonicalJson(previous) !== canonicalJson(next)) changed.push(id);
    }
    return { added: added.sort(), removed: removed.sort(), changed: changed.sort() };
}

export function diffCatalogs(before: ItemCatalog, after: ItemCatalog): CatalogDiff {
    const hardware = diffPart(before.hardware, after.hardware);
    const software = diffPart(before.software, after.software);
    return {
        addedHardware: hardware.added,
        removedHardware: hardware.removed,
        changedHardware: hardware.changed,
        addedSoftware: software.added,
        removedSoftware: software.removed,
        changedSoftware: software.changed,
    };
}
