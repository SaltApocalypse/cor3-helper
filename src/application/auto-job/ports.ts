import type { JobOffer } from '../../domains/jobs/model.js';
import type { AutoJobRunError, AutoJobRunResult } from './runner.js';
import type { Result } from '../../kernel/result.js';
import type { GameError } from '../game/ports.js';

export interface JobRunPort {
    run(job: JobOffer): Promise<Result<AutoJobRunResult, AutoJobRunError>>;
}

export interface JobCommandPort {
    take(marketId: string, jobId: string): Promise<Result<void, GameError>>;
    complete(marketId: string, jobId: string): Promise<Result<void, GameError>>;
    dismiss(marketId: string, jobId: string): Promise<Result<void, GameError>>;
}
