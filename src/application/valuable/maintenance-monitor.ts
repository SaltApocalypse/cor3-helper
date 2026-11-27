/**
 * In-memory signal for `network-map` / `sai` maintenance events.
 *
 * The game emits a maintenance event when a server enters maintenance. The
 * valuable force loop uses the signal to stop immediately instead of waiting
 * for the next map refresh. A map refresh remains the fallback when the event
 * does not carry a server id.
 */
export interface MaintenanceSignalPort {
    record(serverId: string): void;
    hasStarted(serverId: string): boolean;
    waitForStarted(serverId: string, timeoutMs: number): Promise<boolean>;
    clear(serverId?: string): void;
}

interface MaintenanceWaiter {
    readonly resolve: (started: boolean) => void;
    readonly timer: ReturnType<typeof setTimeout>;
}

export class MaintenanceMonitor implements MaintenanceSignalPort {
    private readonly started = new Map<string, number>();
    private readonly waiters = new Map<string, Set<MaintenanceWaiter>>();

    private isFresh(serverId: string): boolean {
        const at = this.started.get(serverId);
        if (at === undefined) return false;
        if (Date.now() - at <= 6 * 60 * 60_000) return true;
        this.started.delete(serverId);
        return false;
    }

    record(serverId: string): void {
        if (!serverId) return;
        this.started.set(serverId, Date.now());
        const waiters = this.waiters.get(serverId);
        if (!waiters) return;
        this.waiters.delete(serverId);
        for (const waiter of waiters) {
            clearTimeout(waiter.timer);
            waiter.resolve(true);
        }
    }

    hasStarted(serverId: string): boolean {
        return this.isFresh(serverId);
    }

    waitForStarted(serverId: string, timeoutMs: number): Promise<boolean> {
        if (this.isFresh(serverId)) return Promise.resolve(true);
        return new Promise((resolve) => {
            const waiter: MaintenanceWaiter = {
                resolve,
                timer: setTimeout(() => {
                    const waiters = this.waiters.get(serverId);
                    waiters?.delete(waiter);
                    if (waiters?.size === 0) this.waiters.delete(serverId);
                    resolve(false);
                }, Math.max(1, timeoutMs)),
            };
            const waiters = this.waiters.get(serverId) ?? new Set<MaintenanceWaiter>();
            waiters.add(waiter);
            this.waiters.set(serverId, waiters);
        });
    }

    clear(serverId?: string): void {
        if (serverId) {
            this.started.delete(serverId);
            const waiters = this.waiters.get(serverId);
            this.waiters.delete(serverId);
            if (waiters) {
                for (const waiter of waiters) {
                    clearTimeout(waiter.timer);
                    waiter.resolve(false);
                }
            }
            return;
        }
        for (const waiters of this.waiters.values()) {
            for (const waiter of waiters) {
                clearTimeout(waiter.timer);
                waiter.resolve(false);
            }
        }
        this.waiters.clear();
        this.started.clear();
    }
}
