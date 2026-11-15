import type { ItemCatalog, InventorySnapshot } from '../../domains/loadout/model.js';
import type { GameError } from '../game/ports.js';
import type { Result } from '../../kernel/result.js';

export interface LoadoutRuntime {
    readonly catalog: ItemCatalog;
    readonly inventory: InventorySnapshot;
}

export interface LoadoutRuntimePort {
    get(): Promise<Result<LoadoutRuntime, GameError>>;
}

export interface LoadoutApplyPort {
    equipHardware(id: string): Promise<Result<void, GameError>>;
    equipSoftware(id: string): Promise<Result<void, GameError>>;
    unequipSoftware(id: string): Promise<Result<void, GameError>>;
}
