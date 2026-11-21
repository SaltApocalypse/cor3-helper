import type { AutomationLogger } from '../../application/automation/ports.js';
import type { UpdateCheckService } from '../../application/update/update-check-service.js';

export const UPDATE_CHECK_STARTUP_TTL_MS = 6 * 60 * 60_000;

export interface UpdateCheckLifecycleRuntime {
    readonly onInstalled: {
        addListener(listener: (details: { readonly reason: string }) => void): void;
        removeListener?(listener: (details: { readonly reason: string }) => void): void;
    };
    readonly onStartup: {
        addListener(listener: () => void): void;
        removeListener?(listener: () => void): void;
    };
}

export interface UpdateCheckLifecycleDeps {
    readonly runtime: UpdateCheckLifecycleRuntime;
    readonly service: Pick<UpdateCheckService, 'check'>;
    readonly logger: Pick<AutomationLogger, 'info' | 'warn'>;
    readonly startupTtlMs?: number;
}

const registeredRuntimes = new WeakSet<object>();

/**
 * Registers the two Chrome lifecycle entry points exactly once per runtime and
 * never blocks startup: the network check runs in the background and failures
 * are only logged.
 */
export function registerUpdateCheckLifecycle(deps: UpdateCheckLifecycleDeps): () => void {
    if (registeredRuntimes.has(deps.runtime)) return () => undefined;
    registeredRuntimes.add(deps.runtime);
    const ttl = deps.startupTtlMs ?? UPDATE_CHECK_STARTUP_TTL_MS;

    const run = (reason: 'install' | 'update' | 'startup'): void => {
        void deps.service.check(reason === 'startup'
            ? { force: false, maxAgeMs: ttl }
            : { force: true })
            .catch((error: unknown) => {
                deps.logger.warn('update-check', 'Background update check failed', {
                    reason,
                    message: error instanceof Error ? error.message : String(error),
                });
            });
    };

    const onInstalled = (details: { readonly reason: string }): void => {
        if (details.reason !== 'install' && details.reason !== 'update') return;
        deps.logger.info('update-check', 'Extension lifecycle update check started', { reason: details.reason });
        run(details.reason);
    };
    const onStartup = (): void => {
        deps.logger.info('update-check', 'Browser startup update check scheduled');
        run('startup');
    };

    deps.runtime.onInstalled.addListener(onInstalled);
    deps.runtime.onStartup.addListener(onStartup);

    return () => {
        deps.runtime.onInstalled.removeListener?.(onInstalled);
        deps.runtime.onStartup.removeListener?.(onStartup);
        registeredRuntimes.delete(deps.runtime);
    };
}
