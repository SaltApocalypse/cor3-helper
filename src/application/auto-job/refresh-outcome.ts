import type { JobOffer } from '../../domains/jobs/model.js';
import type { GameError } from '../game/ports.js';
import type { Result } from '../../kernel/result.js';

/**
 * A refresh is only "fresh" when this request succeeded and returned this
 * exact job. Missing/unavailable are not old data and must never be treated as
 * a claimable observation.
 */
export type JobRefreshOutcome =
    | { readonly status: 'fresh'; readonly job: JobOffer; readonly resetAt: string | null }
    | { readonly status: 'missing' }
    | { readonly status: 'unavailable' };

export type JobRefreshResult = Result<JobRefreshOutcome, GameError>;
export type JobRefreshHook = (job: JobOffer, timeoutMs?: number) => Promise<JobRefreshResult>;
