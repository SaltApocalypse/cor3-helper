import { describe, expect, it } from 'vitest';
import { settingsV1Schema } from '../../../contracts/storage.js';
import { AutomationStateStore } from '../../../infrastructure/storage/automation-state-store.js';
import { MemoryStorageArea } from '../../../infrastructure/storage/storage-area.js';
import { AutoMailCoordinator, isTransientMailFailure } from './auto-mail.js';
import { AUTO_MAIL_RETRY_ALARM } from './alarm-ids.js';

const settings = {
    ...settingsV1Schema.parse({}),
    mailAutoClaimEnabled: true,
    helperMode: false,
};

function logger() {
    return {
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
    };
}

describe('AutoMailCoordinator', () => {
    it('recognises transient mailbox failures', () => {
        expect(isTransientMailFailure('MAIL_TIMEOUT', 'timed out')).toBe(true);
        expect(isTransientMailFailure('MAIL_FAILED', 'no cor3.gg tab found')).toBe(true);
        expect(isTransientMailFailure('MAIL_FAILED', 'stash is full')).toBe(false);
    });

    it('schedules a short retry when the whole collect fails transiently', async () => {
        const created: string[] = [];
        const coordinator = new AutoMailCoordinator({
            settings: {
                get: async () => settings,
                update: async () => settings,
            },
            scheduler: {
                create: (alarm) => { created.push(alarm); },
                clear: async () => undefined,
                get: async () => null,
            },
            logger: logger(),
            clock: { now: () => 1_000 },
            state: new AutomationStateStore(new MemoryStorageArea(), () => 1_000),
            mail: {
                claimPending: async () => ({ ok: false, error: { code: 'MAIL_TIMEOUT', message: 'timed out' } }),
            },
            isInventorySorting: () => false,
        });

        await coordinator.run();
        expect(created).toContain(AUTO_MAIL_RETRY_ALARM);
    });
});
