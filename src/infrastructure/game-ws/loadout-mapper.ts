import type { RawLoadout } from '../../contracts/loadout.js';
import { mapRawHardware, mapRawSoftware } from '../../application/loadout/raw-mapper.js';
import type { ItemCatalog, InventorySnapshot } from '../../domains/loadout/model.js';

function equippedId(value: unknown): string | null {
    if (!value || typeof value !== 'object') return null;
    const candidate = value as { id?: unknown };
    return typeof candidate.id === 'string' ? candidate.id : null;
}

export function mapRawLoadout(raw: RawLoadout, capturedAt = Date.now()): { catalog: ItemCatalog; inventory: InventorySnapshot } {
    const hardware = (raw.ownedHardware ?? []).map(mapRawHardware).filter((item): item is NonNullable<typeof item> => item !== null);
    const software = (raw.ownedSoftware ?? []).map(mapRawSoftware).filter((item) => item.abilities.length > 0);
    const equippedHardware: InventorySnapshot['equippedHardware'] = {};
    for (const slot of ['cpu', 'gpu', 'ram', 'psu'] as const) {
        const id = equippedId(raw.equippedHardware?.[slot]);
        if (id) equippedHardware[slot] = id;
    }
    return {
        catalog: {
            catalogVersion: 'runtime',
            gameVersion: 'unknown',
            hardware,
            software,
        },
        inventory: {
            ownedHardwareIds: new Set(hardware.map((item) => item.id)),
            ownedSoftwareIds: new Set(software.map((item) => item.id)),
            equippedHardware,
            equippedSoftwareIds: (raw.equippedSoftware ?? []).map((item) => item.id),
            capturedAt,
        },
    };
}
