import { describe, expect, it } from 'vitest';
import { displayVersion } from './version.js';

describe('displayVersion', () => {
    it('appends the build counter to a release label', () => {
        expect(displayVersion('2.0.1-salta', '249')).toBe('2.0.1-salta.249');
    });

    it('does not duplicate a build already present in a local version name', () => {
        expect(displayVersion('2.0.1-salta.249', '249')).toBe('2.0.1-salta.249');
    });

    it('falls back when the manifest version is unavailable', () => {
        expect(displayVersion(null, '249')).toBe('2.0');
        expect(displayVersion('2.0.1-salta', null)).toBe('2.0.1-salta');
    });
});
