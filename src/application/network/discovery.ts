import type { NetworkSnapshot } from '../../domains/network/model.js';
import type { GameError } from '../game/ports.js';
import type { Clock } from '../../kernel/clock.js';
import { SystemClock } from '../../kernel/clock.js';
import type { Result } from '../../kernel/result.js';
import type { EndpointLeasePort } from './endpoint-lease.js';

export interface DiscoveryProgress {
    readonly fingerprint: string;
    readonly scannedIps: readonly string[];
    readonly startedAt: number;
}

export interface DiscoveryProgressStore {
    get(): Promise<DiscoveryProgress | null>;
    set(progress: DiscoveryProgress): Promise<void>;
    clear(): Promise<void>;
}

export class MemoryDiscoveryProgressStore implements DiscoveryProgressStore {
    private progress: DiscoveryProgress | null = null;
    async get(): Promise<DiscoveryProgress | null> { return this.progress; }
    async set(progress: DiscoveryProgress): Promise<void> { this.progress = progress; }
    async clear(): Promise<void> { this.progress = null; }
}

export interface DiscoveryCommandPort {
    connectIp(ip: string): Promise<Result<void, GameError>>;
}

export interface DiscoveryOptions {
    readonly reason?: string;
    readonly maxDurationMs?: number;
    readonly maxIps?: number;
    readonly delayMs?: number;
    readonly restart?: boolean;
    readonly signal?: AbortSignal;
}

export interface DiscoveryResult {
    readonly ok: boolean;
    readonly skipped?: boolean | undefined;
    readonly reason?: string | undefined;
    readonly partial?: boolean | undefined;
    readonly scanned: number;
    readonly total: number;
    readonly newConnections: number;
    readonly newServers: number;
}

const DEFAULT_MAX_MS = 5 * 60 * 1000;
const DEFAULT_DELAY_MS = 2500;

function fingerprint(snapshot: NetworkSnapshot): string {
    return [...snapshot.servers.values()]
        .map((server) => server.ip)
        .filter((ip): ip is string => typeof ip === 'string' && ip.length > 0)
        .sort()
        .join('|');
}

function delay(clock: Clock, ms: number): Promise<void> {
    return new Promise((resolve) => clock.setTimeout(resolve, ms));
}

export class NetworkDiscoveryService {
    private running = false;

    constructor(
        private readonly snapshots: { get(force?: boolean): Promise<Result<NetworkSnapshot, GameError>> },
        private readonly commands: DiscoveryCommandPort,
        private readonly progressStore: DiscoveryProgressStore,
        private readonly clock: Clock = new SystemClock(),
        private readonly sleep: (ms: number) => Promise<void> = (ms) => delay(new SystemClock(), ms),
        private readonly lease?: EndpointLeasePort,
    ) {}

    async discover(options: DiscoveryOptions = {}): Promise<DiscoveryResult> {
        if (this.running) {
            return { ok: false, skipped: true, reason: 'locked', scanned: 0, total: 0, newConnections: 0, newServers: 0 };
        }
        const maxDurationMs = options.maxDurationMs ?? DEFAULT_MAX_MS;
        const delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
        const leaseOwner = 'network-discovery';
        const leaseResult = this.lease?.acquire(leaseOwner, options.reason ?? 'discovery', maxDurationMs + 60000);
        if (leaseResult && !leaseResult.ok) {
            return { ok: false, skipped: true, reason: 'endpoint-busy', scanned: 0, total: 0, newConnections: 0, newServers: 0 };
        }
        this.running = true;
        const startedAt = this.clock.now();

        try {
            const beforeResult = await this.snapshots.get(true);
            if (!beforeResult.ok) {
                return { ok: false, reason: 'initial-map-failed', scanned: 0, total: 0, newConnections: 0, newServers: 0 };
            }
            const before = beforeResult.value;
            const allIps = [...new Set([...before.servers.values()]
                .map((server) => server.ip)
                .filter((ip): ip is string => typeof ip === 'string' && ip.length > 0))];
            const fp = fingerprint(before);
            let progress = await this.progressStore.get();
            if (!progress || progress.fingerprint !== fp || options.restart) {
                progress = { fingerprint: fp, scannedIps: [], startedAt };
            }
            const scanned = new Set(progress.scannedIps);
            const available = allIps.filter((ip) => !scanned.has(ip));
            let remaining = available;
            if (options.maxIps && options.maxIps > 0) remaining = available.slice(0, options.maxIps);
            const hasMore = remaining.length < available.length;

            for (const ip of remaining) {
                if (options.signal?.aborted) {
                    await this.progressStore.set(progress);
                    return { ok: false, partial: true, reason: 'aborted', scanned: progress.scannedIps.length, total: allIps.length, newConnections: 0, newServers: 0 };
                }
                if (this.clock.now() - startedAt >= maxDurationMs) {
                    await this.progressStore.set(progress);
                    return { ok: false, partial: true, reason: 'timeout', scanned: progress.scannedIps.length, total: allIps.length, newConnections: 0, newServers: 0 };
                }
                const command = await this.commands.connectIp(ip);
                if (!command.ok) {
                    await this.progressStore.set(progress);
                    return { ok: false, partial: true, reason: command.error.code, scanned: progress.scannedIps.length, total: allIps.length, newConnections: 0, newServers: 0 };
                }
                progress = {
                    ...progress,
                    scannedIps: [...progress.scannedIps, ip],
                };
                await this.progressStore.set(progress);
                await this.sleep(delayMs);
            }

            if (hasMore) {
                await this.progressStore.set(progress);
                return { ok: false, partial: true, reason: 'max-ips', scanned: progress.scannedIps.length, total: allIps.length, newConnections: 0, newServers: 0 };
            }

            const afterResult = await this.snapshots.get(true);
            if (!afterResult.ok) {
                await this.progressStore.set(progress);
                return { ok: false, reason: 'final-map-failed', scanned: progress.scannedIps.length, total: allIps.length, newConnections: 0, newServers: 0 };
            }
            const after = afterResult.value;
            const beforeServers = new Set(before.servers.keys());
            const beforeEdges = new Set(before.edges.map((edge) => edge.id));
            const newServers = [...after.servers.keys()].filter((id) => !beforeServers.has(id)).length;
            const newConnections = after.edges.filter((edge) => !beforeEdges.has(edge.id)).length;
            await this.progressStore.clear();
            return {
                ok: true,
                scanned: progress.scannedIps.length,
                total: allIps.length,
                newConnections,
                newServers,
            };
        } finally {
            if (leaseResult?.ok) this.lease?.release(leaseOwner);
            this.running = false;
        }
    }
}
