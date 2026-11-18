import { afterEach, describe, expect, it, vi } from 'vitest';
import { openWorkspaceSidePanel, openWorkspaceWindow } from './workspace-opener.js';

const baseUrl = 'chrome-extension://test-id/sidepanel.html';

function stubChrome(options: {
    readonly windows?: readonly { readonly id: number; readonly type: string; readonly tabs?: readonly { readonly url?: string }[] }[];
    readonly create?: ReturnType<typeof vi.fn>;
    readonly update?: ReturnType<typeof vi.fn>;
    readonly sidePanelOpen?: ReturnType<typeof vi.fn>;
    readonly currentWindowId?: number | undefined;
} = {}) {
    const create = options.create ?? vi.fn().mockResolvedValue({ id: 2 });
    const update = options.update ?? vi.fn().mockResolvedValue({ id: 1 });
    const sidePanelOpen = options.sidePanelOpen ?? vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('chrome', {
        runtime: { getURL: (path: string) => `chrome-extension://test-id/${path}` },
        windows: {
            getCurrent: vi.fn().mockResolvedValue(
                'currentWindowId' in options ? { id: options.currentWindowId } : { id: 1 },
            ),
            getAll: vi.fn().mockResolvedValue(options.windows ?? []),
            create,
            update,
        },
        sidePanel: { open: sidePanelOpen },
    });
    return { create, update, sidePanelOpen };
}

describe('workspace opener', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('opens the side panel in the current browser window', async () => {
        const { sidePanelOpen, create } = stubChrome();
        await expect(openWorkspaceSidePanel()).resolves.toBe(true);
        expect(sidePanelOpen).toHaveBeenCalledWith({ windowId: 1 });
        expect(create).not.toHaveBeenCalled();
    });

    it('falls back to a detached window when the side panel API fails', async () => {
        const { create } = stubChrome({
            sidePanelOpen: vi.fn().mockRejectedValue(new Error('blocked')),
        });
        await expect(openWorkspaceSidePanel()).resolves.toBe(true);
        expect(create).toHaveBeenCalledWith(expect.objectContaining({ url: `${baseUrl}?mode=window` }));
    });

    it('returns false when no current window is available', async () => {
        stubChrome({ currentWindowId: undefined });
        await expect(openWorkspaceSidePanel()).resolves.toBe(false);
    });

    it('creates a detached workspace window', async () => {
        const { create } = stubChrome();
        await expect(openWorkspaceWindow()).resolves.toBe(true);
        expect(create).toHaveBeenCalledWith({
            url: `${baseUrl}?mode=window`,
            type: 'popup',
            width: 430,
            height: 800,
            focused: true,
        });
    });

    it('focuses an existing detached workspace window', async () => {
        const { create, update } = stubChrome({
            windows: [{ id: 7, type: 'popup', tabs: [{ url: `${baseUrl}?mode=window` }] }],
        });
        await expect(openWorkspaceWindow()).resolves.toBe(true);
        expect(update).toHaveBeenCalledWith(7, { focused: true });
        expect(create).not.toHaveBeenCalled();
    });

    it('reports failure when Chrome blocks the window', async () => {
        stubChrome({ create: vi.fn().mockRejectedValue(new Error('blocked')) });
        await expect(openWorkspaceWindow()).resolves.toBe(false);
    });
});
