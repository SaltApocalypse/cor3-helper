import type { ActivityState, OverviewAutomation, OverviewState } from '../../../application/popup/portal.js';
import { isGameReady } from '../../../application/game/readiness.js';

export type ExtensionHealth = 'ok' | 'warn' | 'error' | 'idle';
export type StatusTone = 'ok' | 'warn' | 'error' | 'muted';

const RECENT_ERROR_MS = 10 * 60_000;
const STALE_SNAPSHOT_MS = 5 * 60_000;

export function hasReadyGameTab(overview: OverviewState | null): boolean {
    return overview?.readiness.some((entry) => isGameReady(entry.readiness)) ?? false;
}

export function automationTone(automation: OverviewAutomation, now: number): StatusTone {
    const recentError = automation.lastError !== null
        && automation.lastAt !== null
        && now - automation.lastAt < RECENT_ERROR_MS;
    if (recentError) return 'error';
    if (automation.waiting) return 'warn';
    if (automation.running) return 'ok';
    if (automation.enabled) return automation.lastError ? 'warn' : 'ok';
    return automation.lastError ? 'warn' : 'muted';
}

export function recentAutomationError(
    overview: OverviewState | null,
    now: number,
): { readonly automation: OverviewAutomation; readonly ageMs: number } | null {
    if (!overview) return null;
    let latest: { automation: OverviewAutomation; ageMs: number } | null = null;
    for (const automation of overview.automations) {
        if (!automation.enabled || !automation.lastError || automation.lastAt === null) continue;
        const ageMs = Math.max(0, now - automation.lastAt);
        if (ageMs >= RECENT_ERROR_MS) continue;
        if (!latest || ageMs < latest.ageMs) latest = { automation, ageMs };
    }
    return latest;
}

export function extensionHealth(input: {
    readonly overview: OverviewState | null;
    readonly activity: ActivityState | null;
    readonly now: number;
}): ExtensionHealth {
    const { overview, activity, now } = input;
    if (!overview) return 'idle';
    if (!overview.auth.authenticated) return 'error';
    if (recentAutomationError(overview, now)) return 'error';

    const enabled = overview.automations.filter((automation) => automation.enabled);
    if (enabled.length > 0 && !hasReadyGameTab(overview)) return 'warn';
    if (overview.helperMode) return 'warn';
    if (overview.queue.waiting.length > 0) return 'warn';
    if (overview.networkAgeMs !== null && overview.networkAgeMs > STALE_SNAPSHOT_MS) return 'warn';
    if (enabled.length === 0 && !activity?.running) return 'idle';
    return 'ok';
}
