import { describe, expect, it } from 'vitest';
import { settingsPatchSchema, settingsV1Schema } from '../../contracts/storage.js';
import {
    parseToolbarOpenMode,
    toolbarOpenModeLabels,
    toolbarOpenModeMenuItemId,
    toolbarOpenModePopup,
    type ToolbarOpenMode,
} from './toolbar-open-mode.js';

const MODES: readonly ToolbarOpenMode[] = ['sidePanel', 'window', 'popup', 'none'];

describe('toolbar open mode settings', () => {
    it('defaults to the launcher when the setting is missing', () => {
        expect(settingsV1Schema.parse({}).toolbarOpenMode).toBe('none');
    });

    it('accepts every mode in a settings patch', () => {
        for (const mode of MODES) {
            expect(settingsPatchSchema.safeParse({ toolbarOpenMode: mode }).success).toBe(true);
        }
        expect(settingsPatchSchema.safeParse({ toolbarOpenMode: 'unknown' }).success).toBe(false);
    });
});

describe('toolbar open mode mapping', () => {
    it('maps modes to the browser action popup target', () => {
        expect(toolbarOpenModePopup('none')).toBe('popup.html');
        expect(toolbarOpenModePopup('popup')).toBe('sidepanel.html?mode=popup');
        expect(toolbarOpenModePopup('sidePanel')).toBe('');
        expect(toolbarOpenModePopup('window')).toBe('');
    });

    it('round-trips menu item IDs for every mode', () => {
        for (const mode of MODES) {
            expect(parseToolbarOpenMode(toolbarOpenModeMenuItemId(mode))).toBe(mode);
        }
    });

    it('ignores unrelated menu items', () => {
        expect(parseToolbarOpenMode('settings')).toBeNull();
        expect(parseToolbarOpenMode('toolbar-open-mode:unknown')).toBeNull();
    });

    it('provides localized labels for both languages', () => {
        expect(toolbarOpenModeLabels('en').parent).toBe('Default open mode');
        expect(toolbarOpenModeLabels('zh').parent).toBe('默认打开方式');
        expect(toolbarOpenModeLabels('zh').items.none).toBe('无（启动器）');
    });
});
