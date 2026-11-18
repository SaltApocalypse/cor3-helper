import type { JobCondition, JobOffer, JobType } from '../../domains/jobs/model.js';
import { JOB_TYPES } from '../../domains/jobs/model.js';
import { rawJobSchema, type RawJob } from '../../contracts/jobs.js';

export interface JobMarketContext {
    readonly marketId: string;
    readonly marketKey: string;
    readonly recent: boolean;
    readonly marketServerId?: string | null | undefined;
}

export interface SkippedJob {
    readonly id: string;
    readonly name: string;
    readonly serverName: string | null;
    readonly status: string;
    readonly reason: string;
    readonly expired?: boolean;
    readonly reputationPenalty?: number;
    readonly deposit?: number;
    readonly jobType?: string;
}

export interface JobMarketMapping {
    readonly jobs: readonly JobOffer[];
    readonly skipped: number;
    readonly failed: number;
    readonly expired: number;
    readonly skippedJobs: readonly SkippedJob[];
    readonly resetAt?: string | null;
}

function skippedFromRaw(raw: unknown, status: string, reason: string, expired = false): SkippedJob | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const entry = raw as {
        id?: unknown;
        name?: unknown;
        relatedServers?: unknown;
        reputationPenalty?: unknown;
        deposit?: unknown;
        jobType?: unknown;
    };
    if (typeof entry.id !== 'string' || entry.id.length === 0) return null;
    const related = Array.isArray(entry.relatedServers) ? entry.relatedServers[0] : null;
    const serverName = related && typeof related === 'object'
        && typeof (related as { serverName?: unknown }).serverName === 'string'
        ? (related as { serverName: string }).serverName
        : null;
    return {
        id: entry.id,
        name: typeof entry.name === 'string' && entry.name.length > 0 ? entry.name : 'Unknown job',
        serverName,
        status,
        reason,
        ...(expired ? { expired: true } : {}),
        ...(typeof entry.reputationPenalty === 'number' ? { reputationPenalty: entry.reputationPenalty } : {}),
        ...(typeof entry.deposit === 'number' ? { deposit: entry.deposit } : {}),
        ...(typeof entry.jobType === 'string' ? { jobType: entry.jobType } : {}),
    };
}

function isJobType(value: string): value is JobType {
    return (JOB_TYPES as readonly string[]).includes(value);
}

const JOB_TYPE_BY_KEY = new Map(JOB_TYPES.map((type) => [normalizeJobKey(type), type]));

function normalizeJobKey(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * The game provides a machine `jobType` field. Display names are localized and
 * are only used as a compatibility fallback for older payloads. Accept enum
 * spellings such as FILE_DECRYPTION and surface names such as "File Decryption".
 */
function resolveJobType(raw: { readonly jobType?: string | undefined; readonly name: string }): JobType | null {
    for (const candidate of [raw.jobType, raw.name]) {
        if (!candidate) continue;
        const direct = isJobType(candidate) ? candidate : null;
        if (direct) return direct;
        const mapped = JOB_TYPE_BY_KEY.get(normalizeJobKey(candidate));
        if (mapped) return mapped;
    }
    return null;
}

function sanitizeDetails(raw: unknown): JobCondition['details'] | undefined {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
    const entries = Object.entries(raw).filter(([, value]) => value !== null && value !== undefined);
    if (entries.length === 0) return undefined;
    const details = Object.fromEntries(entries) as Record<string, unknown>;
    if (Array.isArray(details.ips)) {
        details.ips = details.ips.filter((value): value is string => typeof value === 'string');
    }
    if (Array.isArray(details.files)) {
        details.files = details.files
            .filter((value): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value))
            .map((file) => {
                const sanitized = { ...file };
                if (typeof sanitized.name !== 'string') delete sanitized.name;
                return sanitized;
            });
    }
    return details as JobCondition['details'];
}

function conditionsOf(raw: unknown): readonly JobCondition[] | undefined {
    const source = raw && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as { items?: unknown }).items ?? raw
        : raw;
    if (!Array.isArray(source)) return undefined;
    const conditions: JobCondition[] = [];
    for (const entry of source) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
        const { details: rawDetails, ip: rawIp, targetIp: rawTargetIp, ...rest } = entry as Record<string, unknown>;
        const details = sanitizeDetails(rawDetails);
        conditions.push({
            ...rest,
            ...(details ? { details } : {}),
            ...(typeof rawIp === 'string' ? { ip: rawIp } : {}),
            ...(typeof rawTargetIp === 'string' ? { targetIp: rawTargetIp } : {}),
        } as JobCondition);
    }
    return conditions.length > 0 ? conditions : undefined;
}

function serverIdOf(job: RawJob): string | null {
    for (const related of job.relatedServers ?? []) {
        if (typeof related?.id === 'string' && related.id.length > 0) return related.id;
    }
    // Some payloads only expose the target server inside `conditions.items`.
    // Walk the structure so those jobs are not rejected as `no-server`.
    const queue: unknown[] = [job.conditions, job.relatedServers];
    const seen = new Set<unknown>();
    while (queue.length > 0) {
        const current = queue.shift();
        if (!current || typeof current !== 'object' || seen.has(current)) continue;
        seen.add(current);
        if (Array.isArray(current)) {
            queue.push(...current);
            continue;
        }
        const entry = current as Record<string, unknown>;
        for (const key of ['serverConfigId', 'serverId', 'targetServerId']) {
            const value = entry[key];
            if (typeof value === 'string' && value.length > 0) return value;
        }
        for (const value of Object.values(entry)) {
            if (value && typeof value === 'object') queue.push(value);
        }
    }
    return null;
}

function fileInfoOf(raw: unknown): { id?: string; name?: string } | null {
    if (!raw || typeof raw !== 'object') return null;
    const entry = raw as { id?: unknown; name?: unknown };
    const id = typeof entry.id === 'string' ? entry.id : undefined;
    const name = typeof entry.name === 'string' ? entry.name : undefined;
    if (!id && !name) return null;
    return {
        ...(id ? { id } : {}),
        ...(name ? { name } : {}),
    };
}

/**
 * Maps market rows to job offers. Malformed rows are counted and skipped rather
 * than aborting a whole market sync.
 */
export function mapMarketJobs(rows: readonly unknown[], context: JobMarketContext): JobMarketMapping {
    const jobs: JobOffer[] = [];
    const skippedJobs: SkippedJob[] = [];
    let skipped = 0;
    let failed = 0;
    let expired = 0;
    for (const row of rows) {
        const parsed = rawJobSchema.safeParse(row);
        if (!parsed.success) {
            skipped += 1;
            const entry = skippedFromRaw(row, 'invalid', 'Malformed job row');
            if (entry) skippedJobs.push(entry);
            continue;
        }
        const raw = parsed.data;
        if (raw.isCompleted === true || raw.isExpired === true) {
            skipped += 1;
            if (raw.isExpired === true) expired += 1;
            const entry = skippedFromRaw(raw, raw.isCompleted === true ? 'completed' : 'expired', raw.isCompleted === true ? 'Job already completed' : 'Job expired', raw.isExpired === true);
            if (entry) skippedJobs.push(entry);
            continue;
        }
        if (raw.status === 'EXPIRED') {
            skipped += 1;
            expired += 1;
            const entry = skippedFromRaw(raw, 'expired', 'Job expired', true);
            if (entry) skippedJobs.push(entry);
            continue;
        }
        if (context.recent && raw.status !== 'TAKEN') {
            const status = raw.status ?? 'unknown';
            // The game reports timed-out/unfinished jobs as FAILED. There is no
            // separate EXPIRED status in recentJobs, so show them as expired to
            // match the in-game timer behavior instead of implying an action bug.
            const expiredJob = status === 'FAILED';
            if (expiredJob) expired += 1;
            else skipped += 1;
            const entry = skippedFromRaw(
                raw,
                expiredJob ? 'expired' : status.toLowerCase(),
                expiredJob ? 'Job expired' : `Recent job status: ${status}`,
                expiredJob,
            );
            if (entry) skippedJobs.push(entry);
            continue;
        }
        const jobType = resolveJobType(raw);
        if (!jobType) {
            skipped += 1;
            const entry = skippedFromRaw(raw, 'unsupported', `Unsupported job type: ${raw.jobType ?? raw.name}`);
            if (entry) skippedJobs.push(entry);
            continue;
        }
        const related = raw.relatedServers?.[0];
        const conditions = conditionsOf(raw.conditions);
        const fileInfo = fileInfoOf(raw.fileInfo);
        jobs.push({
            id: raw.id,
            name: raw.name,
            type: jobType,
            marketId: context.marketId,
            marketKey: context.marketKey,
            ...(context.marketServerId !== undefined ? { marketServerId: context.marketServerId } : {}),
            serverId: serverIdOf(raw),
            serverName: related?.serverName ?? null,
            rewardCredits: raw.rewardCredits ?? 0,
            rewardReputation: raw.rewardReputation ?? 0,
            deposit: raw.deposit ?? 0,
            reputationPenalty: raw.reputationPenalty ?? 0,
            alreadyTaken: context.recent || raw.status === 'TAKEN',
            canComplete: raw.canComplete ?? false,
            ...(conditions ? { conditions } : {}),
            ...(fileInfo ? { fileInfo } : {}),
        });
    }
    return { jobs, skipped, failed, expired, skippedJobs };
}

export interface MarketJobsSource {
    readonly jobs: unknown;
}

/**
 * Extracts open and recently taken jobs from a market `get.jobs` payload.
 * The payload is either an array or an object containing `jobs`/`recentJobs`.
 */
export function mapMarketSnapshotJobs(
    market: MarketJobsSource,
    marketId: string,
    marketKey: string,
    marketServerId?: string | null,
): JobMarketMapping {
    const container = market.jobs && typeof market.jobs === 'object' && !Array.isArray(market.jobs)
        ? market.jobs as { jobs?: unknown; recentJobs?: unknown; nextJobsResetAt?: unknown }
        : null;
    const open = Array.isArray(market.jobs)
        ? market.jobs
        : Array.isArray(container?.jobs) ? container.jobs : [];
    const recent = Array.isArray(container?.recentJobs) ? container.recentJobs : [];
    const context = { marketId, marketKey, ...(marketServerId !== undefined ? { marketServerId } : {}) };
    const openMapping = mapMarketJobs(open, { ...context, recent: false });
    const recentMapping = mapMarketJobs(recent, { ...context, recent: true });
    const seen = new Set(openMapping.jobs.map((job) => job.id));
    const skippedById = new Map<string, SkippedJob>();
    for (const job of [...openMapping.skippedJobs, ...recentMapping.skippedJobs]) {
        if (!seen.has(job.id) && !skippedById.has(job.id)) skippedById.set(job.id, job);
    }
    return {
        jobs: [...openMapping.jobs, ...recentMapping.jobs.filter((job) => !seen.has(job.id))],
        skipped: openMapping.skipped + recentMapping.skipped,
        failed: openMapping.failed + recentMapping.failed,
        expired: openMapping.expired + recentMapping.expired,
        skippedJobs: [...skippedById.values()],
        resetAt: typeof container?.nextJobsResetAt === 'string' ? container.nextJobsResetAt : null,
    };
}
