import type { Clock } from '../../kernel/clock.js';
import { err, ok, type Result } from '../../kernel/result.js';

export interface EndpointLease {
    readonly owner: string;
    readonly reason: string;
    readonly acquiredAt: number;
    readonly expiresAt: number;
}

export interface EndpointLeaseError {
    readonly code: 'LEASE_BUSY' | 'LEASE_NOT_OWNER' | 'LEASE_EXPIRED';
    readonly message: string;
    readonly owner?: string;
}

export interface EndpointLeasePort {
    acquire(owner: string, reason: string, ttlMs?: number): Result<EndpointLease, EndpointLeaseError>;
    release(owner: string): Result<void, EndpointLeaseError>;
}

export class InMemoryEndpointLeaseService implements EndpointLeasePort {
    private active: EndpointLease | null = null;

    constructor(
        private readonly clock: Clock,
        private readonly defaultTtlMs = 5 * 60 * 1000,
    ) {}

    acquire(owner: string, reason: string, ttlMs = this.defaultTtlMs): Result<EndpointLease, EndpointLeaseError> {
        const now = this.clock.now();
        if (this.active && this.active.expiresAt > now && this.active.owner !== owner) {
            return err({
                code: 'LEASE_BUSY',
                message: `Endpoint is owned by ${this.active.owner}`,
                owner: this.active.owner,
            });
        }
        const lease: EndpointLease = {
            owner,
            reason,
            acquiredAt: now,
            expiresAt: now + Math.max(1000, ttlMs),
        };
        this.active = lease;
        return ok(lease);
    }

    renew(owner: string, ttlMs = this.defaultTtlMs): Result<EndpointLease, EndpointLeaseError> {
        const now = this.clock.now();
        if (!this.active || this.active.owner !== owner) {
            return err({ code: 'LEASE_NOT_OWNER', message: 'No active lease for this owner' });
        }
        if (this.active.expiresAt <= now) {
            this.active = null;
            return err({ code: 'LEASE_EXPIRED', message: 'The endpoint lease has expired' });
        }
        const lease: EndpointLease = {
            ...this.active,
            expiresAt: now + Math.max(1000, ttlMs),
        };
        this.active = lease;
        return ok(lease);
    }

    release(owner: string): Result<void, EndpointLeaseError> {
        if (!this.active || this.active.owner !== owner) {
            return err({ code: 'LEASE_NOT_OWNER', message: 'No active lease for this owner' });
        }
        this.active = null;
        return ok(undefined);
    }

    current(): EndpointLease | null {
        if (this.active && this.active.expiresAt <= this.clock.now()) {
            this.active = null;
        }
        return this.active;
    }
}
