import { describe, expect, it } from 'vitest';
import { CapturingLogger, redact, redactText } from './logger.js';

describe('redaction', () => {
    it('redacts bearer tokens and JWT strings', () => {
        const text = 'Authorization: Bearer abc.def.ghi and eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature';
        expect(redactText(text)).not.toContain('abc.def.ghi');
        expect(redactText(text)).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    });

    it('redacts sensitive object keys recursively', () => {
        const input = {
            headers: { Authorization: 'Bearer secret-token', cookie: 'session=abc' },
            nested: { token: 'value', safe: 'keep' },
            jwtToken: 'a.b.c',
            accessToken: 'access',
            refresh_token: 'refresh',
            sessionId: 'session',
            apiKey: 'api',
        };
        const output = redact(input);
        expect(output).toEqual({
            headers: { Authorization: '[REDACTED]', cookie: '[REDACTED]' },
            nested: { token: '[REDACTED]', safe: 'keep' },
            jwtToken: '[REDACTED]',
            accessToken: '[REDACTED]',
            refresh_token: '[REDACTED]',
            sessionId: '[REDACTED]',
            apiKey: '[REDACTED]',
        });
    });

    it('does not leak data through the logger', () => {
        const logger = new CapturingLogger({ now: () => 1 });
        logger.info('test', 'request failed', { authorization: 'Bearer secret', safe: 'value' });
        expect(JSON.stringify(logger.events)).not.toContain('secret');
        expect(JSON.stringify(logger.events)).toContain('value');
    });
});

import { BufferedLogger } from './logger.js';
import { RunLogStore } from './run-log-store.js';

describe('BufferedLogger retention', () => {
    function silent(): { debug: () => void; info: () => void; warn: () => void; error: () => void } {
        return { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined };
    }

    it('keeps a much larger window than the old 500 entries', () => {
        const logger = new BufferedLogger(silent(), 6000);
        for (let index = 0; index < 5500; index += 1) logger.info('test', `line ${index}`);
        expect(logger.events().length).toBe(5500);
        expect(logger.events()[0]?.message).toBe('line 0');
    });

    it('drops the oldest lines when the byte budget is exceeded', () => {
        const logger = new BufferedLogger(silent(), 10_000, undefined, 4_000);
        for (let index = 0; index < 40; index += 1) {
            logger.info('test', `line ${index} ${'x'.repeat(200)}`);
        }
        const events = logger.events();
        expect(events.length).toBeLessThan(40);
        expect(events[events.length - 1]?.message).toContain('line 39');
        expect(events[0]?.message).not.toContain('line 0 ');
    });

    it('drops the oldest lines when the entry budget is exceeded', () => {
        const logger = new BufferedLogger(silent(), 3);
        for (let index = 0; index < 5; index += 1) logger.info('test', `line ${index}`);
        expect(logger.events().map((event) => event.message)).toEqual(['line 2', 'line 3', 'line 4']);
    });
});

describe('RunLogStore persistence', () => {
    it('restores persisted runs and notifies on change', () => {
        const changes: number[] = [];
        const store = new RunLogStore(20, 500, () => changes.push(1));
        store.hydrate({
            'run-1': [
                { at: 1, level: 'info', scope: 'auto-jobs', message: 'first' },
                { at: 2, level: 'warn', scope: 'auto-jobs', message: 'second' },
                { bad: true },
            ],
        });
        expect(store.list('run-1').map((line) => line.message)).toEqual(['first', 'second']);
        expect(changes.length).toBe(1);
        store.add('run-1', 'info', 'auto-jobs', 'third');
        expect(store.list('run-1').map((line) => line.message)).toEqual(['first', 'second', 'third']);
        expect(store.snapshot()['run-1']?.length).toBe(3);
    });

    it('does not let restored lines replace a live run', () => {
        const store = new RunLogStore();
        store.add('run-1', 'info', 'auto-jobs', 'live');
        store.hydrate({ 'run-1': [{ at: 1, level: 'info', scope: 'auto-jobs', message: 'stale' }] });
        expect(store.list('run-1').map((line) => line.message)).toEqual(['live']);
    });

    it('caps the number of persisted runs', () => {
        const store = new RunLogStore(2, 10);
        store.add('a', 'info', 'auto-jobs', 'a');
        store.add('b', 'info', 'auto-jobs', 'b');
        store.add('c', 'info', 'auto-jobs', 'c');
        expect(Object.keys(store.snapshot())).toEqual(['b', 'c']);
    });
});
