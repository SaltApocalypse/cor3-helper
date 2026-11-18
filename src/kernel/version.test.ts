import { describe, expect, it } from 'vitest';
import { buildNumberFromVersionName, mergeBuildNumber, splitVersionBuild } from './version.js';

describe('splitVersionBuild', () => {
    it('separates a release label from its build counter', () => {
        expect(splitVersionBuild('2.0.5-salta.274')).toEqual({ base: '2.0.5-salta', build: 274 });
    });

    it('collapses multiple counters to the newest one', () => {
        expect(splitVersionBuild('2.0.5-salta.272.270')).toEqual({ base: '2.0.5-salta', build: 272 });
    });

    it('leaves plain versions alone', () => {
        expect(splitVersionBuild('2.0.5')).toEqual({ base: '2.0.5', build: null });
        expect(splitVersionBuild('2.0.5-salta')).toEqual({ base: '2.0.5-salta', build: null });
    });
});

describe('mergeBuildNumber', () => {
    it('appends the bundle counter to a release label', () => {
        expect(mergeBuildNumber('2.0.5-salta', '274')).toBe('2.0.5-salta.274');
    });

    it('does not duplicate a counter already in the version name', () => {
        expect(mergeBuildNumber('2.0.5-salta.274', '274')).toBe('2.0.5-salta.274');
    });

    it('keeps only the newest counter when they differ', () => {
        expect(mergeBuildNumber('2.0.5-salta.272', '270')).toBe('2.0.5-salta.272');
        expect(mergeBuildNumber('2.0.5-salta.270', '272')).toBe('2.0.5-salta.272');
        expect(mergeBuildNumber('2.0.5-salta.272.270', null)).toBe('2.0.5-salta.272');
    });

    it('falls back when the manifest version is unavailable', () => {
        expect(mergeBuildNumber(null, '249')).toBe('2.0');
        expect(mergeBuildNumber('2.0.5-salta', null)).toBe('2.0.5-salta');
    });
});

describe('buildNumberFromVersionName', () => {
    it('reads the newest embedded counter', () => {
        expect(buildNumberFromVersionName('2.0.5-salta.272')).toBe('272');
        expect(buildNumberFromVersionName('2.0.5-salta.272.270')).toBe('272');
        expect(buildNumberFromVersionName('2.0.5-salta')).toBeNull();
    });
});
