import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../kernel/fake-clock.js';
import { InMemoryEndpointLeaseService } from './endpoint-lease.js';

describe('InMemoryEndpointLeaseService', () => {
    it('allows one owner and rejects a concurrent owner', () => {
        const clock = new FakeClock(0);
        const leases = new InMemoryEndpointLeaseService(clock, 1000);
        expect(leases.acquire('auto-job', 'job').ok).toBe(true);
        const second = leases.acquire('market', 'refresh');
        expect(second).toEqual({
            ok: false,
            error: { code: 'LEASE_BUSY', message: 'Endpoint is owned by auto-job', owner: 'auto-job' },
        });
    });

    it('expires and can be reacquired', () => {
        const clock = new FakeClock(0);
        const leases = new InMemoryEndpointLeaseService(clock, 1000);
        leases.acquire('auto-job', 'job');
        clock.advance(1001);
        expect(leases.current()).toBeNull();
        expect(leases.acquire('market', 'refresh').ok).toBe(true);
    });

    it('renews and releases only for the owner', () => {
        const clock = new FakeClock(0);
        const leases = new InMemoryEndpointLeaseService(clock, 1000);
        leases.acquire('auto-job', 'job');
        expect(leases.renew('market').ok).toBe(false);
        expect(leases.renew('auto-job', 2000).ok).toBe(true);
        clock.advance(1500);
        expect(leases.current()?.owner).toBe('auto-job');
        expect(leases.release('auto-job').ok).toBe(true);
        expect(leases.current()).toBeNull();
    });
});
