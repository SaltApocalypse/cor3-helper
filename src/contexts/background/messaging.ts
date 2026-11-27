import { gameReadinessSchema } from '../../application/game/readiness.js';
import { tabRequestSchema } from '../../contracts/tab.js';
import { parseContentNotice } from '../../contracts/tab-commands.js';
import { rawMarketSnapshotSchema } from '../../contracts/market.js';
import type { CoreRuntime } from './composition/core.js';
import type { AutomationRuntime } from './composition/automation.js';
import { VERSION } from './composition/core.js';

export function registerMessaging(core: CoreRuntime, automation: AutomationRuntime): void {
    chrome.runtime.onMessage.addListener((message: unknown, sender) => {
        const request = tabRequestSchema.safeParse(message);
        if (!request.success) return false;
        const payload = parseContentNotice(request.data.type, request.data.payload);
        if (!payload) return false;
        message = { type: request.data.type, ...payload };
        const type = (message as { type?: unknown }).type;
        if (type === 'V2_GAME_READY') {
            const tabId = sender.tab?.id;
            if (typeof tabId !== 'number') return false;
            const parsed = gameReadinessSchema.safeParse((message as { readiness?: unknown }).readiness);
            if (parsed.success) void automation.readiness.handle(tabId, parsed.data);
            return false;
        }
        if (type === 'V2_MARKET_CACHE') {
            const marketId = (message as { marketId?: unknown }).marketId;
            const source = (message as { source?: unknown }).source;
            const parsed = rawMarketSnapshotSchema.safeParse((message as { snapshot?: unknown }).snapshot);
            if (typeof marketId === 'string' && parsed.success) {
                const component = source === 'jobs' || source === 'options' || source === 'lots' ? source : undefined;
                automation.autoJobs.applyMarketCacheSnapshot(marketId, parsed.data, component);
            }
            return false;
        }
        if (type === 'V2_EXPEDITION_DECISIONS') {
            const decisions = (message as { decisions?: unknown }).decisions;
            if (Array.isArray(decisions) && decisions.length > 0) {
                core.logger.debug('auto-expedition', 'Expedition decision event received', { decisions: decisions.length });
                void automation.expedition.run();
            }
            return false;
        }
        if (type === 'V2_MINIGAME_STUCK') {
            const kind = (message as { kind?: unknown }).kind;
            const reason = (message as { reason?: unknown }).reason;
            const detail = typeof reason === 'string' && reason.length > 0
                ? reason
                : 'minigame room stopped responding';
            void automation.pageReload.request(detail, typeof kind === 'string' ? kind : null);
            return false;
        }
        if (type === 'V2_MAINTENANCE_STARTED') {
            const serverId = (message as { serverId?: unknown }).serverId;
            const reason = (message as { reason?: unknown }).reason;
            if (typeof serverId === 'string' && serverId.length > 0) {
                automation.valuable.recordMaintenance(serverId);
            }
            core.logger.info('network', 'Server maintenance started', {
                serverId: typeof serverId === 'string' ? serverId : null,
                reason: typeof reason === 'string' ? reason : null,
            });
            return false;
        }
        if (type === 'V2_WS_NOTICE') {
            const level = (message as { level?: unknown }).level;
            const text = (message as { message?: unknown }).message;
            if (typeof text !== 'string') return false;
            const data = (message as { data?: unknown }).data;
            if (level === 'error') core.logger.error('ws', text, data);
            else if (level === 'warn') core.logger.warn('ws', text, data);
            else if (level === 'debug') core.logger.debug('ws', text, data);
            else core.logger.info('ws', text, data);
            return false;
        }
        return false;
    });

    if (chrome.tabs.onRemoved) {
        chrome.tabs.onRemoved.addListener((tabId) => {
            automation.readiness.removeTab(tabId);
        });
    }

    chrome.runtime.onInstalled.addListener(() => {
        core.logger.info('background', 'Installed extension', { version: VERSION });
    });
}
