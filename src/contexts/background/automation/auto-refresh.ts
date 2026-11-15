import type { NetworkSnapshotService } from '../../../application/network/snapshot-service.js';
import type { NetworkOperationQueue } from '../../../application/network/operation-queue.js';
import type { SettingsPort } from '../../../application/automation/ports.js';
import { hasEnabledAutomation } from './enabled.js';
import { ok } from '../../../kernel/result.js';

export interface AutoRefreshLast {
    readonly at: number;
    readonly servers: number;
    readonly error: string | null;
}

export interface AutoRefreshDeps {
    readonly snapshots: Pick<NetworkSnapshotService, 'get'>;
    readonly networkOps: Pick<NetworkOperationQueue, 'enqueue'>;
    readonly settings: SettingsPort;
    readonly clock: { now(): number };
}

export class AutoRefreshCoordinator {
    private running = false;
    private last: AutoRefreshLast | null = null;

    constructor(private readonly deps: AutoRefreshDeps) {}

    isRunning(): boolean {
        return this.running;
    }

    lastRun(): AutoRefreshLast | null {
        return this.last;
    }

    async run(): Promise<void> {
        if (this.running) return;
        this.running = true;
        try {
            const snapshot = await this.deps.snapshots.get(true);
            const servers = snapshot.ok ? snapshot.value.servers.size : 0;
            const error = snapshot.ok ? null : snapshot.error.message;
            this.last = { at: this.deps.clock.now(), servers, error };
        } finally {
            this.running = false;
        }
    }

    async runExclusive(): Promise<{ readonly ok: true } | { readonly ok: false; readonly code: string; readonly message: string }> {
        const current = await this.deps.settings.get();
        if (current.helperMode || !hasEnabledAutomation(current)) return { ok: true };
        const queued = await this.deps.networkOps.enqueue({ owner: 'auto-refresh', reason: 'auto-refresh', priority: 40 }, async () => {
            await this.run();
            return ok(undefined);
        });
        return queued.ok ? { ok: true } : { ok: false, code: queued.error.code, message: queued.error.message };
    }
}
