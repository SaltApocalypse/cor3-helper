import type { GameError } from '../game/ports.js';
import type { Result } from '../../kernel/result.js';

export interface FailedJobRef {
    readonly id: string;
    readonly name: string;
    readonly marketId: string;
    readonly marketKey: string;
}

export interface FailedJobDismissFailure {
    readonly job: FailedJobRef;
    readonly message: string;
}

export interface DismissFailedJobsOutcome {
    readonly dismissed: readonly FailedJobRef[];
    readonly failed: readonly FailedJobDismissFailure[];
    readonly stopped: boolean;
}

export interface DismissFailedJobsOptions {
    readonly shouldStop?: () => boolean;
    readonly onResult?: (job: FailedJobRef, result: Result<void, GameError>) => void;
}

export interface FailedJobDismissPort {
    dismiss(job: FailedJobRef): Promise<Result<void, GameError>>;
}

/**
 * Dismisses failed jobs one at a time. Network routing and market refresh stay
 * outside this service; the caller prepares the market endpoint first.
 */
export class DismissFailedJobsService {
    constructor(private readonly port: FailedJobDismissPort) {}

    async run(jobs: readonly FailedJobRef[], options: DismissFailedJobsOptions = {}): Promise<DismissFailedJobsOutcome> {
        const dismissed: FailedJobRef[] = [];
        const failed: FailedJobDismissFailure[] = [];
        for (const job of jobs) {
            if (options.shouldStop?.()) {
                return { dismissed, failed, stopped: true };
            }
            const result = await this.port.dismiss(job);
            options.onResult?.(job, result);
            if (result.ok) dismissed.push(job);
            else failed.push({ job, message: result.error.message });
        }
        return { dismissed, failed, stopped: false };
    }
}
