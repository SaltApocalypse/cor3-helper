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
