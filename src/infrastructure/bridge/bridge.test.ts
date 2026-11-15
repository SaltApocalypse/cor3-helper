import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { BridgeClient } from './bridge-client.js';
import { BridgeServer } from './bridge-server.js';
import { CapturingLogger } from '../logging/logger.js';
import { FakeClock } from '../../kernel/fake-clock.js';
import { ok } from '../../kernel/result.js';

const logger = new CapturingLogger({ now: () => 1 });

function createHarness() {
    const server = new BridgeServer('background', logger);
    server.register('system.ping', z.object({}).strict(), async () => ok({ version: '2.0.0-dev' }));
    const transport = {
        send: async (request: unknown) => server.handle(request),
    };
    const client = new BridgeClient(transport, 'popup', 'background');
    return { server, client };
}

describe('BridgeClient / BridgeServer', () => {
    it('performs a typed request/response', async () => {
        const { client } = createHarness();
        const result = await client.request('system.ping', {}, z.object({ version: z.string() }));
        expect(result).toEqual({ ok: true, value: { version: '2.0.0-dev' } });
    });

    it('returns a typed unknown-type error', async () => {
        const { client } = createHarness();
        const result = await client.request('system.missing', {}, z.object({}));
        expect(result).toEqual({
            ok: false,
            error: { code: 'BRIDGE_UNKNOWN_TYPE', message: 'Unknown bridge type: system.missing' },
        });
    });

    it('rejects a wrong target at the server boundary', async () => {
        const server = new BridgeServer('background', logger);
        const response = await server.handle({
            version: 1,
            id: 'x',
            source: 'popup',
            target: 'content',
            type: 'system.ping',
            payload: {},
        });
        expect(response).toBeNull();
    });

    it('returns a timeout result when the transport never replies', async () => {
        const clock = new FakeClock();
        const client = new BridgeClient({ send: () => new Promise(() => undefined) }, 'popup', 'background', clock);
        const pending = client.request('system.ping', {}, z.object({}), 1000);
        clock.advance(1000);
        await expect(pending).resolves.toEqual({
            ok: false,
            error: { code: 'BRIDGE_TIMEOUT', message: 'Bridge request timed out: system.ping' },
        });
    });
});
