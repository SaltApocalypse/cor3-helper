import { parseItemCatalog } from '../../contracts/catalog.js';
import type { ItemCatalog } from '../../domains/loadout/model.js';

/**
 * Optional shipped catalog artifact. The build copies `catalog/item-catalog.json`
 * when present. The runtime inventory payload remains the source of ownership;
 * the static catalog supplies definitions for items the player does not own yet.
 */
let cached: Promise<ItemCatalog | null> | null = null;

export function loadStaticCatalog(fetchImpl: typeof fetch = fetch): Promise<ItemCatalog | null> {
    if (cached) return cached;
    cached = (async () => {
        try {
            const response = await fetchImpl(chrome.runtime.getURL('item-catalog.json'), { cache: 'no-store' });
            if (!response.ok) return null;
            const parsed = parseItemCatalog(await response.json());
            return parsed.hardware.length > 0 || parsed.software.length > 0 ? parsed as unknown as ItemCatalog : null;
        } catch {
            return null;
        }
    })();
    return cached ?? Promise.resolve(null);
}
