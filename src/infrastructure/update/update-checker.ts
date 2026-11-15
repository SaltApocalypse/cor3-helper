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
] as const;

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
}

export class UpdateChecker {
    private readonly urls: readonly string[];
    private readonly now: () => number;
    private readonly fetchImpl: typeof fetch;
    private readonly releaseUrl: string;

    constructor(options: UpdateCheckerOptions = {}) {
        this.urls = options.urls ?? REMOTE_URLS;
        this.now = options.now ?? (() => Date.now());
        this.fetchImpl = options.fetchImpl ?? fetch;
        this.releaseUrl = options.releaseUrl ?? 'https://github.com/SaltApocalypse/cor3-helper/releases';
    }

    async check(current: string): Promise<Result<UpdateCheckResult, { readonly code: string; readonly message: string }>> {
        const errors: string[] = [];
        for (const url of this.urls) {
            try {
                const response = await this.fetchImpl(url, { cache: 'no-store' });
                if (!response.ok) {
                    errors.push(`${url}: HTTP ${response.status}`);
                    continue;
                }
                const parsed = remotePackageSchema.safeParse(await response.json());
                if (!parsed.success) {
                    errors.push(`${url}: invalid package metadata`);
                    continue;
                }
                const latest = versionNameFromPackage(parsed.data);
                return ok({
                    current,
                    latest,
                    updateAvailable: compareVersions(latest, current) > 0,
                    releaseUrl: this.releaseUrl,
                    checkedAt: this.now(),
                    source: url,
                });
            } catch (error) {
                errors.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        return err({
            code: 'UPDATE_CHECK_FAILED',
            message: errors[0] ?? 'Could not reach the update server',
        });
    }
}
