import { describe, expect, it } from 'vitest';
import { NetworkOperationQueue } from './operation-queue.js';
import { ok } from '../../kernel/result.js';

describe('NetworkOperationQueue', () => {
    it('runs one operation at a time and drains in order', async () => {
        const queue = new NetworkOperationQueue();
        const order: string[] = [];
        let releaseFirst: () => void = () => undefined;
        const first = queue.enqueue({ owner: 'first', reason: 'test' }, async () => {
            order.push('first:start');
            await new Promise<void>((resolve) => { releaseFirst = resolve; });
            order.push('first:end');
            return ok('first');
        });
        const second = queue.enqueue({ owner: 'second', reason: 'test' }, async () => {
            order.push('second:start');
            return ok('second');
        });

        await Promise.resolve();
        expect(order).toEqual(['first:start']);
        expect(queue.status().running?.owner).toBe('first');
        expect(queue.status().waiting).toHaveLength(1);

        releaseFirst?.();
        const [firstResult, secondResult] = await Promise.all([first, second]);
        expect(firstResult).toEqual({ ok: true, value: 'first' });
        expect(secondResult).toEqual({ ok: true, value: 'second' });
        expect(order).toEqual(['first:start', 'first:end', 'second:start']);
        expect(queue.status().running).toBeNull();
    });

    it('orders waiting operations by priority and then arrival', async () => {
        const queue = new NetworkOperationQueue();
        let release: () => void = () => undefined;
        const first = queue.enqueue({ owner: 'first', reason: 'test' }, async () => {
            await new Promise<void>((resolve) => { release = resolve; });
            return ok(undefined);
        });
        const low = queue.enqueue({ owner: 'low', reason: 'test', priority: 1 }, async () => ok('low'));
        const high = queue.enqueue({ owner: 'high', reason: 'test', priority: 10 }, async () => ok('high'));

        await Promise.resolve();
        release();
        await first;
        const highResult = await high;
        const lowResult = await low;
        expect(highResult).toEqual({ ok: true, value: 'high' });
        expect(lowResult).toEqual({ ok: true, value: 'low' });
        expect(queue.status().running ?? null).toBeNull();
    });

    it('cancels a waiting operation without running it', async () => {
        const queue = new NetworkOperationQueue();
        let release: () => void = () => undefined;
        const first = queue.enqueue({ owner: 'first', reason: 'test' }, async () => {
            await new Promise<void>((resolve) => { release = resolve; });
            return ok(undefined);
        });
        let ran = false;
        const cancelled = queue.enqueue({ owner: 'cancelled', reason: 'test' }, async () => {
            ran = true;
            return ok(undefined);
        });

        await Promise.resolve();
        expect(queue.cancel('cancelled:2')).toBe(true);
        expect(await cancelled).toEqual({
            ok: false,
            error: { code: 'NETWORK_OPERATION_CANCELLED', message: 'Network operation cancelled:2 was cancelled' },
        });
        release();
        await first;
        expect(ran).toBe(false);
    });
});
