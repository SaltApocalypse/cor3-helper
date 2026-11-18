const WORKSPACE_DOCUMENT = 'sidepanel.html';

export async function openWorkspaceSidePanel(): Promise<boolean> {
    try {
        const current = await chrome.windows.getCurrent();
        if (current.id === undefined) return false;
        await chrome.sidePanel.open({ windowId: current.id });
        return true;
    } catch {
        return openWorkspaceWindow();
    }
}

export async function openWorkspaceWindow(): Promise<boolean> {
    try {
        const baseUrl = chrome.runtime.getURL(WORKSPACE_DOCUMENT);
        const windows = await chrome.windows.getAll({ populate: true });
        const existing = windows.find((candidate) => (
            candidate.type === 'popup'
            && typeof candidate.id === 'number'
            && candidate.tabs?.some((tab) => tab.url?.startsWith(baseUrl))
        ));
        if (existing && typeof existing.id === 'number') {
            try {
                await chrome.windows.update(existing.id, { focused: true });
                return true;
            } catch {
                // The window may have closed between the query and the focus.
            }
        }
        await chrome.windows.create({
            url: `${baseUrl}?mode=window`,
            type: 'popup',
            width: 430,
            height: 800,
            focused: true,
        });
        return true;
    } catch {
        return false;
    }
}
