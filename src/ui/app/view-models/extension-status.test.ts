import { describe, expect, it } from 'vitest';
import type { ActivityState, OverviewAutomation, OverviewState } from '../../../application/popup/portal.js';
import { automationTone, extensionHealth, recentAutomationError } from './extension-status.js';

const NOW = 10_000_000;

function automation(overrides: Partial<OverviewAutomation> = {}): OverviewAutomation {
    return {
        key: 'auto-jobs',
        label: 'Auto Jobs',
        enabled: true,
        running: false,
        lastAt: NOW - 60_000,
        lastError: null,
        ...overrides,
    };
}

function overview(overrides: Partial<OverviewState> = {}): OverviewState {
    return {
        auth: { authenticated: true, source: 'content' },
        network: { serverCount: 3, connectionCount: 2, hiddenConnectionCount: 0, home: 'Home', endpoint: 'Home' },
        networkAgeMs: 1_000,
        queue: { running: null, waiting: [], updatedAt: NOW },
        readiness: [{
            tabId: 1,
            readiness: {
                socketOpen: true,
                authenticated: true,
                mapLoaded: true,
                marketLoaded: true,
                loadoutLoaded: true,
                ready: true,
                readyAt: NOW - 1_000,
                checkedAt: NOW,
            },
        }],
        helperMode: false,
        autoJobs: {
            nextRefreshAt: null,
            refreshReason: 'interval',
            lastRefreshAt: NOW - 1_000,
            lastError: null,
            lastSkipReason: null,
            lastAttemptAt: NOW - 1_000,
        },
        automations: [automation()],
        timers: [],
        jobReport: null,
        ...overrides,
    };
}

function activity(running: boolean): ActivityState {
    return { key: running ? 'auto-jobs' : 'idle', label: 'Auto Jobs', detail: 'test', running, progress: null };
}

describe('extensionHealth', () => {
    it('is healthy when auth, game tab and automations are ready', () => {
        expect(extensionHealth({ overview: overview(), activity: activity(true), now: NOW })).toBe('ok');
    });

    it('is an error when the session is not authenticated', () => {
        expect(extensionHealth({
            overview: overview({ auth: { authenticated: false, source: 'none' } }),
            activity: activity(false),
            now: NOW,
        })).toBe('error');
    });

    it('warns when helper mode is enabled', () => {
        expect(extensionHealth({ overview: overview({ helperMode: true }), activity: activity(false), now: NOW })).toBe('warn');
    });

    it('warns when enabled automation has no ready game tab', () => {
        expect(extensionHealth({ overview: overview({ readiness: [] }), activity: activity(false), now: NOW })).toBe('warn');
    });

    it('reports a recent automation error and ignores old errors', () => {
        const recent = overview({ automations: [automation({ lastError: 'ROUTE_FAILED', lastAt: NOW - 1_000 })] });
        const old = overview({ automations: [automation({ lastError: 'ROUTE_FAILED', lastAt: NOW - 11 * 60_000 })] });
        expect(extensionHealth({ overview: recent, activity: activity(false), now: NOW })).toBe('error');
        expect(extensionHealth({ overview: old, activity: activity(false), now: NOW })).not.toBe('error');
    });

    it('warns for queued work or a stale network snapshot', () => {
        expect(extensionHealth({
            overview: overview({ queue: { running: null, waiting: [{ id: '1', owner: 'auto-jobs', reason: 'market', priority: 1, enqueuedAt: NOW }], updatedAt: NOW } }),
            activity: activity(false),
            now: NOW,
        })).toBe('warn');
        expect(extensionHealth({ overview: overview({ networkAgeMs: 6 * 60_000 }), activity: activity(false), now: NOW })).toBe('warn');
    });

    it('is idle when no automation is enabled and nothing is running', () => {
        expect(extensionHealth({
            overview: overview({ automations: [automation({ enabled: false })] }),
            activity: activity(false),
            now: NOW,
        })).toBe('idle');
    });
});

describe('automationTone', () => {
    it('distinguishes running, enabled, disabled and recent errors', () => {
        expect(automationTone(automation({ running: true }), NOW)).toBe('ok');
        expect(automationTone(automation({ enabled: false }), NOW)).toBe('muted');
        expect(automationTone(automation({ lastError: 'ROUTE_FAILED', lastAt: NOW - 1_000 }), NOW)).toBe('error');
        expect(automationTone(automation({ lastError: 'ROUTE_FAILED', lastAt: NOW - 11 * 60_000 }), NOW)).toBe('warn');
    });
});

describe('recentAutomationError', () => {
    it('picks the most recent recent error', () => {
        const result = recentAutomationError(overview({
            automations: [
                automation({ key: 'auto-mail', lastError: 'old', lastAt: NOW - 5 * 60_000 }),
                automation({ key: 'auto-jobs', lastError: 'new', lastAt: NOW - 1_000 }),
            ],
        }), NOW);
        expect(result?.automation.key).toBe('auto-jobs');
        expect(result?.ageMs).toBe(1_000);
    });
});
