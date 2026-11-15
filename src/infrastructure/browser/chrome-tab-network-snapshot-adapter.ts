import type { NetworkSnapshotSource } from '../../application/network/snapshot-service.js';
import type { NetworkSnapshot } from '../../domains/network/model.js';
import type { GameError } from '../../application/game/ports.js';
import { err, ok, type Result } from '../../kernel/result.js';
import { mapRawNetworkToSnapshot } from '../game-ws/network-map-mapper.js';
import type { ChromeTabNetworkMapAdapter } from './chrome-tab-network-map-adapter.js';

export class ChromeTabNetworkSnapshotAdapter implements NetworkSnapshotSource {
    constructor(
        private readonly maps: Pick<ChromeTabNetworkMapAdapter, 'getMap'>,
        private readonly clock: { now(): number } = { now: () => Date.now() },
    ) {}

    async getSnapshot(): Promise<Result<NetworkSnapshot, GameError>> {
        const result = await this.maps.getMap();
        if (!result.ok) return result;
        try {
            return ok(mapRawNetworkToSnapshot(result.value, this.clock.now()));
        } catch (error) {
            return err({
                code: 'GAME_MAP_INVALID',
                message: error instanceof Error ? error.message : String(error),
            });
        }
    }
}
