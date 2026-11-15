import { z } from 'zod';
import type { Result } from '../../kernel/result.js';
import { err, ok } from '../../kernel/result.js';

/**
 * Update check for the SaltA fork.
 *
 * The fork publishes the 2.0 build metadata in the root `package.json` on the `v2` branch.
 * `raw.githubusercontent.com` is already in the extension host permissions, so
 * the background worker can fetch it without asking for a new permission.
 */
const REMOTE_URLS = [
    'https://raw.githubusercontent.com/SaltApocalypse/cor3-helper/v2/package.json',
    'https://cdn.jsdelivr.net/gh/SaltApocalypse/cor3-helper@latest/package.json',
    'https://github.com/SaltApocalypse/cor3-helper/raw/v2/package.json',
] as const;
const DEFAULT_TIMEOUT_MS = 6_000;

const remotePackageSchema = z.object({
    version: z.string().min(1),
    cor3Fork: z.object({
        label: z.string().min(1).optional(),
        releaseLabel: z.string().min(1).optional(),
        build: z.number().int().nonnegative().optional(),
    }).passthrough().optional(),
}).passthrough();

export interface UpdateCheckResult {
    readonly current: string;
    readonly latest: string;
    readonly updateAvailable: boolean;
    readonly releaseUrl: string;
    readonly checkedAt: number;
    readonly source: string;
}

interface ParsedVersion {
    readonly base: readonly number[];
    readonly suffix: string;
    readonly build: number | null;
}

function parseVersion(value: string): ParsedVersion {
    const cleaned = value.trim().replace(/^v/i, '');
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
    readonly urls?: readonly string[];
    readonly now?: () => number;
    readonly fetchImpl?: typeof fetch;
    readonly releaseUrl?: string;
    readonly timeoutMs?: number;
}

export class UpdateChecker {
    private readonly urls: readonly string[];
    private readonly now: () => number;
    private readonly fetchImpl: typeof fetch;
    private readonly releaseUrl: string;
    private readonly timeoutMs: number;

    constructor(options: UpdateCheckerOptions = {}) {
        this.urls = options.urls ?? REMOTE_URLS;
        this.now = options.now ?? (() => Date.now());
        this.fetchImpl = options.fetchImpl ?? fetch;
        this.releaseUrl = options.releaseUrl ?? 'https://github.com/SaltApocalypse/cor3-helper/releases';
        this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    }

    async check(current: string): Promise<Result<UpdateCheckResult, { readonly code: string; readonly message: string }>> {
        type Attempt = { readonly ok: true; readonly value: UpdateCheckResult } | { readonly ok: false; readonly error: string };
        const attempts = await Promise.all(this.urls.map(async (url): Promise<Attempt> => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), this.timeoutMs);
            try {
                const response = await this.fetchImpl(url, { cache: 'no-store', signal: controller.signal });
                if (!response.ok) return { ok: false, error: `${url}: HTTP ${response.status}` };
                const parsed = remotePackageSchema.safeParse(await response.json());
                if (!parsed.success) return { ok: false, error: `${url}: invalid package metadata` };
                const latest = versionNameFromPackage(parsed.data);
                return {
                    ok: true,
                    value: {
                        current,
                        latest,
                        updateAvailable: compareVersions(latest, current) > 0,
                        releaseUrl: this.releaseUrl,
                        checkedAt: this.now(),
                        source: url,
                    },
                };
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                return { ok: false, error: `${url}: ${message}` };
            } finally {
                clearTimeout(timer);
            }
        }));
        const success = attempts.find((attempt): attempt is Extract<Attempt, { ok: true }> => attempt.ok);
        if (success) return ok(success.value);
        const errors = attempts.flatMap((attempt) => attempt.ok ? [] : [attempt.error]);
        return err({
            code: 'UPDATE_CHECK_FAILED',
            message: errors[0] ?? 'Could not reach the update server',
        });
    }
}
