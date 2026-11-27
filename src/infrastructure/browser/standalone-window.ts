/**
 * Opens (or focuses) the detached workspace window.
 *
 * Shared by the popup's "open in window" button and the toolbar context menu so
 * both paths reuse the same window instead of stacking duplicates.
 */
export async function openStandaloneWindow(): Promise<boolean> {
    try {
        const baseUrl = chrome.runtime.getURL('sidepanel.html');
        const windows = await chrome.windows.getAll({ populate: true });
        const existing = windows.find((window) => (
            window.type === 'popup'
            && typeof window.id === 'number'
            && window.tabs?.some((tab) => tab.url?.startsWith(baseUrl))
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
