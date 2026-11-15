import type { CatalogSource } from '../../contracts/catalog-source.js';
import type { ItemCatalog } from '../../domains/loadout/model.js';
import { canonicalJson } from '../../application/catalog/catalog.js';

export interface CatalogManifest {
    readonly catalogVersion: string;
    readonly gameVersion: string;
    readonly source: string;
    readonly capturedAt?: string;
    readonly checksum: string;
    readonly generatedAt: string;
    readonly hardwareCount: number;
    readonly softwareCount: number;
}

export async function catalogChecksum(catalog: ItemCatalog): Promise<string> {
    const bytes = new TextEncoder().encode(canonicalJson(catalog));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function buildCatalogManifest(
    catalog: ItemCatalog,
    source: CatalogSource,
    generatedAt = new Date().toISOString(),
): Promise<CatalogManifest> {
    return {
        catalogVersion: catalog.catalogVersion,
        gameVersion: catalog.gameVersion,
        source: source.source,
        ...(source.capturedAt ? { capturedAt: source.capturedAt } : {}),
        checksum: await catalogChecksum(catalog),
        generatedAt,
        hardwareCount: catalog.hardware.length,
        softwareCount: catalog.software.length,
    };
}
