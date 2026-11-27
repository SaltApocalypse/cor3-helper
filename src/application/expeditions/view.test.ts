import { describe, expect, it } from 'vitest';
import { partitionExpeditions } from './view.js';
import type { ActiveExpedition, ExpeditionOverview } from '../../domains/expeditions/model.js';

function expedition(id: string, status: string, overrides: Partial<ActiveExpedition> = {}): ActiveExpedition {
    return {
        id,
        status,
        outcome: null,
        locationName: 'Location',
        mercenaryName: null,
        totalCost: null,
        riskScore: null,
        lootScore: null,
        hasInsurance: null,
        endsAt: null,
        containerOpenedAt: null,
        completedAt: null,
        loot: [],
        ...overrides,
    };
}

function overview(active: ActiveExpedition[], archived: ActiveExpedition[]): ExpeditionOverview {
    return { active, archived, mercenaries: [], locations: [], decisions: [] };
}

describe('partitionExpeditions', () => {
    it('keeps an unpaid completed expedition in the active completed list', () => {
        const result = partitionExpeditions(overview([expedition('exp-1', 'COMPLETED')], []));
        expect(result.completed.map((entry) => entry.id)).toEqual(['exp-1']);
        expect(result.history).toEqual([]);
    });

    it('moves archived expeditions into history', () => {
        const result = partitionExpeditions(overview([], [expedition('exp-2', 'COMPLETED')]));
        expect(result.completed).toEqual([]);
        expect(result.history.map((entry) => entry.id)).toEqual(['exp-2']);
    });

    it('does not duplicate an archived expedition that is still active', () => {
        const result = partitionExpeditions(overview([expedition('exp-3', 'IN_PROGRESS')], [expedition('exp-3', 'COMPLETED')]));
        expect(result.active.map((entry) => entry.id)).toEqual(['exp-3']);
        expect(result.history).toEqual([]);
    });

    it('sorts history by completion time descending', () => {
        const result = partitionExpeditions(overview([], [
            expedition('old', 'COMPLETED', { completedAt: '2026-11-20T10:00:00.000Z' }),
            expedition('new', 'COMPLETED', { completedAt: '2026-11-27T10:00:00.000Z' }),
        ]));
        expect(result.history.map((entry) => entry.id)).toEqual(['new', 'old']);
    });
});
