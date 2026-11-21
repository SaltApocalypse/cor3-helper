import { z } from 'zod';
import type { Result } from '../../kernel/result.js';
import { err, ok } from '../../kernel/result.js';
import type { UpdateCheckError, UpdateCheckSuccess } from '../../contracts/update-check.js';

/**
 * Single authoritative update source for the SaltA fork. GitHub Releases is
 * the release source; package.json mirrors on branches/CDNs are deliberately
 * not queried because they can be stale and previously caused misleading
 * "up to date" results.
 */
export const UPDATE_CHECK_URL = 'https://api.github.com/repos/SaltApocalypse/cor3-helper/releases/latest';
/** A failed check must never leave the UI waiting indefinitely. */
export const DEFAULT_UPDATE_CHECK_TIMEOUT_MS = 10_000;

const remoteReleaseSchema = z.object({
    tag_name: z.string().min(1),
    html_url: z.string().min(1),
    draft: z.boolean().optional(),
    prerelease: z.boolean().optional(),
}).passthrough();

interface ParsedVersion {
    readonly base: readonly number[];
    readonly suffix: string;
    readonly build: number | null;
}

function normalizeVersion(value: string): string {
    return value.trim().replace(/^v/i, '');
}

function isValidVersion(value: string): boolean {
    return /^\d+(?:\.\d+)*(?:-[A-Za-z0-9._-]+)*$/.test(normalizeVersion(value));
}

function parseVersion(value: string): ParsedVersion {
    const cleaned = normalizeVersion(value);
    const match = cleaned.match(/^(\d+(?:\.\d+)*)(?:-(.+))?$/);
    const base = match?.[1]?.split('.').map((part) => Number(part) || 0) ?? [0];
    const suffix = match?.[2] ?? '';
    const buildMatch = suffix.match(/^(.*?)(\d+)$/);
    return {
        base,
        suffix: buildMatch?.[1] ?? suffix,
        build: buildMatch ? Number(buildMatch[2]) : null,
    };
}

/** Positive when `left` is newer than `right`. */
export function compareVersions(left: string, right: string): number {
    const a = parseVersion(left);
    const b = parseVersion(right);
    const length = Math.max(a.base.length, b.base.length);
    for (let index = 0; index < length; index += 1) {
        const diff = (a.base[index] ?? 0) - (b.base[index] ?? 0);
        if (diff !== 0) return diff;
    }
    if (a.suffix !== b.suffix) return a.suffix.localeCompare(b.suffix);
    if (a.build !== b.build) {
        if (a.build === null) return b.build === null ? 0 : -1;
        if (b.build === null) return 1;
        return a.build - b.build;
    }
    return 0;
}

export function versionNameFromPackage(pkg: {
    readonly version: string;
    readonly cor3Fork?: {
        readonly label?: string | undefined;
        readonly releaseLabel?: string | undefined;
        readonly build?: number | undefined;
    } | undefined;
}): string {
    // Release builds use `<version>-<releaseLabel>`; the local build counter is
    // intentionally ignored so release users are never offered a local build.
    const releaseLabel = pkg.cor3Fork?.releaseLabel;
    if (releaseLabel) return `${pkg.version}-${releaseLabel}`;
    const label = pkg.cor3Fork?.label;
    return label ? `${pkg.version}-${label}.${pkg.cor3Fork?.build ?? 1}` : pkg.version;
}

export interface UpdateCheckerOptions {
    readonly url?: string;
    readonly now?: () => number;
    readonly fetchImpl?: typeof fetch;
    readonly timeoutMs?: number;
}

export class UpdateChecker {
    private readonly url: string;
    private readonly now: () => number;
    private readonly fetchImpl: typeof fetch;
    private readonly timeoutMs: number;

    constructor(options: UpdateCheckerOptions = {}) {
        this.url = options.url ?? UPDATE_CHECK_URL;
        this.now = options.now ?? (() => Date.now());
        // Chrome's fetch requires the global (Window/WorkerGlobalScope) receiver.
        // Storing the bare function and calling `this.fetchImpl(...)` would pass
        // the checker as `this` and fail with "Illegal invocation" in a worker.
        const fetchImpl = options.fetchImpl ?? globalThis.fetch;
        this.fetchImpl = (input, init) => fetchImpl.call(globalThis, input, init);
        this.timeoutMs = options.timeoutMs ?? DEFAULT_UPDATE_CHECK_TIMEOUT_MS;
    }

    async check(currentVersion: string): Promise<Result<UpdateCheckSuccess, UpdateCheckError>> {
        if (!isValidVersion(currentVersion)) {
            return err({
                code: 'INVALID_VERSION',
                message: `Installed version is not valid: ${currentVersion}`,
            });
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), Math.max(1, this.timeoutMs));
        let response: Response;
        let raw: unknown;
        try {
            response = await this.fetchImpl(this.url, {
                cache: 'no-store',
                headers: { Accept: 'application/vnd.github+json' },
                signal: controller.signal,
            });
            if (!response.ok) {
                return err({
                    code: 'HTTP_ERROR',
                    message: `GitHub Releases API returned HTTP ${response.status}`,
                    httpStatus: response.status,
                });
            }
            try {
                raw = await response.json();
            } catch {
                return err({
                    code: 'JSON_ERROR',
                    message: 'GitHub Releases API returned invalid JSON',
                });
            }
        } catch (error) {
            const aborted = controller.signal.aborted;
            return err({
                code: aborted ? 'TIMEOUT' : 'NETWORK_ERROR',
                message: aborted
                    ? `Update check timed out after ${this.timeoutMs}ms`
                    : (error instanceof Error ? error.message : String(error)),
            });
        } finally {
            clearTimeout(timer);
        }

        const parsed = remoteReleaseSchema.safeParse(raw);
        if (!parsed.success) {
            return err({
                code: 'INVALID_RESPONSE',
                message: 'GitHub Releases response is missing tag_name or html_url',
            });
        }
        if (parsed.data.draft === true) {
            return err({
                code: 'INVALID_RESPONSE',
                message: 'Latest release is a draft; draft releases are not update evidence',
            });
        }
        if (parsed.data.prerelease === true) {
            return err({
                code: 'INVALID_RESPONSE',
                message: 'Latest release is a prerelease; this fork publishes stable releases only',
            });
        }

        const latestVersion = normalizeVersion(parsed.data.tag_name);
        if (!isValidVersion(latestVersion)) {
            return err({
                code: 'INVALID_VERSION',
                message: `GitHub release tag is not a valid version: ${parsed.data.tag_name}`,
            });
        }
        let releaseUrl: string;
        try {
            const candidate = new URL(parsed.data.html_url);
            if (candidate.protocol !== 'https:' && candidate.protocol !== 'http:') throw new Error('unsupported protocol');
            releaseUrl = candidate.toString();
        } catch {
            return err({
                code: 'INVALID_RESPONSE',
                message: 'GitHub Releases response contains an invalid html_url',
            });
        }

        return ok({
            status: compareVersions(latestVersion, currentVersion) > 0 ? 'available' : 'latest',
            currentVersion,
            latestVersion,
            releaseUrl,
            checkedAt: this.now(),
            source: this.url,
        });
    }
}
