import type { Result } from '../../kernel/result.js';
import type { StorageReadResult } from '../../contracts/storage-health.js';
import type {
    UpdateCheckError,
    UpdateCheckResult,
    UpdateCheckSuccess,
} from '../../contracts/update-check.js';

export interface UpdateCheckPort {
    check(currentVersion: string): Promise<Result<UpdateCheckSuccess, UpdateCheckError>>;
}

export interface UpdateCheckCachePort {
    read(): Promise<StorageReadResult<UpdateCheckResult>>;
    save(result: UpdateCheckResult): Promise<void>;
}

export interface UpdateCheckServiceDeps {
    readonly checker: UpdateCheckPort;
    readonly store: UpdateCheckCachePort;
    readonly currentVersion: () => string;
    readonly now?: () => number;
}

export interface UpdateCheckOptions {
    readonly force?: boolean;
    /** Skip a recent non-failed cached result. Ignored when force is true. */
    readonly maxAgeMs?: number;
}

function successFromCache(result: UpdateCheckResult): UpdateCheckSuccess | null {
    if (result.lastSuccess) return result.lastSuccess;
    if (result.status === 'failed' || !result.latestVersion || !result.releaseUrl) return null;
    return {
        status: result.status,
        currentVersion: result.currentVersion,
        latestVersion: result.latestVersion,
        releaseUrl: result.releaseUrl,
        checkedAt: result.checkedAt,
        source: 'cache',
    };
}

function failure(
    currentVersion: string,
    checkedAt: number,
    error: UpdateCheckError,
    lastSuccess: UpdateCheckSuccess | null,
): UpdateCheckResult {
    return {
        status: 'failed',
        currentVersion,
        checkedAt,
        error,
        lastSuccess,
    };
}

/**
 * Owns one update-check flow: read previous success, call the single-source
 * checker, preserve `lastSuccess`, persist the result, and dedupe concurrent
 * calls. No lifecycle or UI wiring lives here.
 */
export class UpdateCheckService {
    private inFlight: Promise<UpdateCheckResult> | null = null;
    private readonly now: () => number;

    constructor(private readonly deps: UpdateCheckServiceDeps) {
        this.now = deps.now ?? (() => Date.now());
    }

    /** Reads the cache only. It never performs a network request. */
    async getStatus(): Promise<UpdateCheckResult | null> {
        const read = await this.deps.store.read();
        if (read.status === 'ok') return read.value;
        // A failed read must not look like "never checked"; report it as a
        // structured failure. A corrupt value keeps the existing null contract
        // and is repaired by the next successful check.
        if (read.status === 'unavailable') {
            return failure(this.deps.currentVersion(), 0, {
                code: 'STORAGE_READ_FAILED',
                message: read.error ?? 'Storage read failed',
            }, null);
        }
        return null;
    }

    check(options: UpdateCheckOptions = {}): Promise<UpdateCheckResult> {
        if (this.inFlight) return this.inFlight;
        if (options.force !== true && options.maxAgeMs !== undefined && options.maxAgeMs > 0) {
            return this.readFreshCache(options.maxAgeMs);
        }
        return this.start();
    }

    private async readFreshCache(maxAgeMs: number): Promise<UpdateCheckResult> {
        const read = await this.deps.store.read();
        if (this.inFlight) return this.inFlight;
        if (read.status === 'ok'
            && read.value.status !== 'failed'
            && this.now() - read.value.checkedAt < maxAgeMs) {
            return read.value;
        }
        if (this.inFlight) return this.inFlight;
        return this.start();
    }

    private start(): Promise<UpdateCheckResult> {
        if (this.inFlight) return this.inFlight;
        const run = this.runCheck();
        this.inFlight = run;
        void run.then(
            () => { if (this.inFlight === run) this.inFlight = null; },
            () => { if (this.inFlight === run) this.inFlight = null; },
        );
        return run;
    }

    private async runCheck(): Promise<UpdateCheckResult> {
        const currentVersion = this.deps.currentVersion();
        const checkedAt = this.now();
        const previousRead = await this.deps.store.read();
        const previousOk = previousRead.status === 'ok';
        const lastSuccess = previousOk ? successFromCache(previousRead.value) : null;

        const checked = await this.deps.checker.check(currentVersion);
        if (!checked.ok) {
            const result = failure(currentVersion, checkedAt, checked.error, lastSuccess);
            // A corrupt/unreadable cache must not be silently overwritten by a
            // failed check. Only a successful check may repair it.
            if (previousOk || previousRead.status === 'missing') {
                try {
                    await this.deps.store.save(result);
                } catch (error) {
                    return failure(currentVersion, checkedAt, {
                        code: 'STORAGE_WRITE_FAILED',
                        message: error instanceof Error ? error.message : String(error),
                    }, lastSuccess);
                }
            }
            return result;
        }

        const result: UpdateCheckResult = {
            status: checked.value.status,
            currentVersion: checked.value.currentVersion,
            latestVersion: checked.value.latestVersion,
            releaseUrl: checked.value.releaseUrl,
            checkedAt: checked.value.checkedAt,
            lastSuccess: checked.value,
        };
        try {
            await this.deps.store.save(result);
        } catch (error) {
            return failure(currentVersion, checkedAt, {
                code: 'STORAGE_WRITE_FAILED',
                message: error instanceof Error ? error.message : String(error),
            }, checked.value);
        }
        return result;
    }
}
