import { z } from 'zod';
import type { Result } from '../../kernel/result.js';
import { err, ok } from '../../kernel/result.js';

/**
 * Update check for the SaltA fork.
 *
 * The fork publishes the 2.0 build metadata in the root `package.json` on the
 * `v2` branch. The repository default branch may be `main`; both are queried so
 * a branch rename does not break the check. The GitHub Releases API is also
 * queried because it is the authoritative release source.
 */
const REMOTE_URLS = [
    'https://raw.githubusercontent.com/SaltApocalypse/cor3-helper/v2/package.json',
    'https://raw.githubusercontent.com/SaltApocalypse/cor3-helper/main/package.json',
    'https://cdn.jsdelivr.net/gh/SaltApocalypse/cor3-helper@latest/package.json',
    'https://cdn.jsdelivr.net/gh/SaltApocalypse/cor3-helper@v2/package.json',
    'https://cdn.jsdelivr.net/gh/SaltApocalypse/cor3-helper@main/package.json',
    'https://github.com/SaltApocalypse/cor3-helper/raw/v2/package.json',
    'https://github.com/SaltApocalypse/cor3-helper/raw/main/package.json',
] as const;
const RELEASE_API_URLS = [
    'https://api.github.com/repos/SaltApocalypse/cor3-helper/releases/latest',
] as const;
/** 0 means no request timeout. */
const DEFAULT_TIMEOUT_MS = 0;

const remotePackageSchema = z.object({
    version: z.string().min(1),
    cor3Fork: z.object({
        label: z.string().min(1).optional(),
        releaseLabel: z.string().min(1).optional(),
        build: z.number().int().nonnegative().optional(),
    }).passthrough().optional(),
}).passthrough();

const remoteReleaseSchema = z.object({
    tag_name: z.string().min(1),
    html_url: z.string().optional(),
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
    readonly apiUrls?: readonly string[];
    readonly now?: () => number;
    readonly fetchImpl?: typeof fetch;
    readonly releaseUrl?: string;
    /** 0 disables the abort timer. */
    readonly timeoutMs?: number;
}

type Attempt = { readonly ok: true; readonly value: UpdateCheckResult } | { readonly ok: false; readonly error: string };

export class UpdateChecker {
    private readonly urls: readonly string[];
    private readonly apiUrls: readonly string[];
    private readonly now: () => number;
    private readonly fetchImpl: typeof fetch;
    private readonly releaseUrl: string;
    private readonly timeoutMs: number;

    constructor(options: UpdateCheckerOptions = {}) {
        this.urls = options.urls ?? REMOTE_URLS;
        // A caller that injects custom package URLs (mostly tests) must opt in
        // to API URLs explicitly; production uses the defaults.
        this.apiUrls = options.apiUrls ?? (options.urls ? [] : RELEASE_API_URLS);
        this.now = options.now ?? (() => Date.now());
        this.fetchImpl = options.fetchImpl ?? fetch;
        this.releaseUrl = options.releaseUrl ?? 'https://github.com/SaltApocalypse/cor3-helper/releases';
        this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    }

    async check(current: string): Promise<Result<UpdateCheckResult, { readonly code: string; readonly message: string }>> {
        const errors: string[] = [];
        // The releases API is authoritative and usually responds fastest.
        for (const url of this.apiUrls) {
            const attempt = await this.checkRelease(url, current);
            if (attempt.ok) return ok(attempt.value);
            errors.push(attempt.error);
        }
        // Fall back to the package metadata, v2 first and main second. The
        // first successful endpoint wins so one blocked host cannot hold the
        // whole check hostage.
        for (const url of this.urls) {
            const attempt = await this.checkPackage(url, current);
            if (attempt.ok) return ok(attempt.value);
            errors.push(attempt.error);
        }
        return err({
            code: 'UPDATE_CHECK_FAILED',
            message: errors[0] ?? 'Could not reach the update server',
        });
    }

    private async checkPackage(url: string, current: string): Promise<Attempt> {
        const controller = this.timeoutMs > 0 ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), this.timeoutMs) : null;
        try {
            const response = await this.fetchImpl(url, {
                cache: 'no-store',
                ...(controller ? { signal: controller.signal } : {}),
            });
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
            if (timer !== null) clearTimeout(timer);
        }
    }

    private async checkRelease(url: string, current: string): Promise<Attempt> {
        const controller = this.timeoutMs > 0 ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), this.timeoutMs) : null;
        try {
            const response = await this.fetchImpl(url, {
                cache: 'no-store',
                headers: { Accept: 'application/vnd.github+json' },
                ...(controller ? { signal: controller.signal } : {}),
            });
            if (!response.ok) return { ok: false, error: `${url}: HTTP ${response.status}` };
            const parsed = remoteReleaseSchema.safeParse(await response.json());
            if (!parsed.success) return { ok: false, error: `${url}: invalid release metadata` };
            const latest = parsed.data.tag_name.trim().replace(/^v/i, '');
            if (!latest) return { ok: false, error: `${url}: empty release tag` };
            return {
                ok: true,
                value: {
                    current,
                    latest,
                    updateAvailable: compareVersions(latest, current) > 0,
                    releaseUrl: parsed.data.html_url ?? this.releaseUrl,
                    checkedAt: this.now(),
                    source: url,
                },
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { ok: false, error: `${url}: ${message}` };
        } finally {
            if (timer !== null) clearTimeout(timer);
        }
    }
}
