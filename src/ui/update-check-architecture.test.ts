import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function walk(directory: string): string[] {
    return readdirSync(directory).flatMap((name) => {
        const path = join(directory, name);
        return statSync(path).isDirectory()
            ? walk(path)
            : /\.(ts|tsx)$/.test(name) ? [path] : [];
    });
}

function uiSources(): Array<{ path: string; source: string }> {
    return walk(join(process.cwd(), 'src/ui'))
        .filter((path) => !path.endsWith('update-check-architecture.test.ts'))
        .map((path) => ({ path, source: readFileSync(path, 'utf8') }));
}

describe('update-check UI architecture', () => {
    it('A01/A02 keeps UpdateChecker and GitHub access out of the UI', () => {
        const offenders = uiSources().filter(({ source }) =>
            source.includes('new UpdateChecker')
            || source.includes('api.github.com/repos/SaltApocalypse')
            || source.includes('raw.githubusercontent.com/SaltApocalypse'));
        expect(offenders).toEqual([]);
    });

    it('A03/A04 does not compare versions or implement update-check state in the UI', () => {
        const offenders = uiSources().filter(({ source }) =>
            source.includes('compareVersions')
            || source.includes('updateCheckResultToView')
            || source.includes('updateCheckSuccessToView')
            || source.includes('UpdateCheckView'));
        expect(offenders).toEqual([]);
    });

    it('A05/A06 reads update state from the portal, not Chrome storage', () => {
        const offenders = uiSources().filter(({ source }) =>
            source.includes('chrome.storage')
            || source.includes('new UpdateCheckService')
            || source.includes('new UpdateCheckStore'));
        expect(offenders).toEqual([]);
        const settings = uiSources().find(({ path }) => path.endsWith('/useSettings.ts'));
        const welcome = uiSources().find(({ path }) => path.endsWith('/WelcomeApp.tsx'));
        expect(settings?.source).toContain('portal.updateStatus()');
        expect(settings?.source).toContain('portal.updateCheck()');
        expect(welcome?.source).toContain('portal.updateStatus()');
        expect(welcome?.source).toContain('portal.updateCheck()');
    });
});
