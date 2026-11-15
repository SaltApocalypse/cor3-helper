import { z } from 'zod';
import { ok } from '../../../kernel/result.js';
import { isFreshLogEvent, type CoreRuntime } from '../composition/core.js';

export interface DevtoolsHandlerDeps {
    readonly core: CoreRuntime;
}

export function registerDevtoolsHandlers(server: CoreRuntime['server'], deps: DevtoolsHandlerDeps): void {
    const { core } = deps;
    server.register('devtools.bridgeLogs', z.object({ limit: z.number().int().positive().max(300).default(200) }).strict(), async ({ limit }) => {
        return ok(core.bridgeAudits.slice(-limit));
    });
    server.register('devtools.wsLogs', z.object({}).strict(), async () => {
        const tabId = await core.tabs.findCor3Tab();
        if (tabId === null) return ok([]);
        try {
            const response = await core.tabs.send(tabId, { type: 'V2_WS_LOGS' });
            if (response && typeof response === 'object' && (response as { ok?: unknown }).ok === true) {
                return ok((response as { value?: unknown }).value ?? []);
            }
            return ok([]);
        } catch {
            return ok([]);
        }
    });
    server.register('devtools.logs', z.object({ limit: z.number().int().positive().max(500).default(200) }).strict(), async ({ limit }) => {
        return ok(core.logger.events().filter(isFreshLogEvent).slice(-limit));
    });
    server.register('devtools.clearLogs', z.object({}).strict(), async () => {
        core.logger.clear();
        if (core.sessionLogArea) await core.sessionLogArea.set({ [core.sessionLogKey]: [] }).catch(() => undefined);
        return ok(undefined);
    });
    server.register('devtools.clearBridgeLogs', z.object({}).strict(), async () => {
        core.bridgeAudits.splice(0, core.bridgeAudits.length);
        return ok(undefined);
    });
    server.register('devtools.clearWsLogs', z.object({}).strict(), async () => {
        const tabId = await core.tabs.findCor3Tab();
        if (tabId !== null) await core.tabs.send(tabId, { type: 'V2_CLEAR_WS_LOGS' }).catch(() => undefined);
        return ok(undefined);
    });
    server.register('devtools.wsSend', z.object({ message: z.string().min(1) }).strict(), async ({ message }) => {
        const tabId = await core.tabs.findCor3Tab();
        if (tabId === null) return { ok: false, error: { code: 'NO_COR3_TAB', message: 'No cor3.gg tab found' } };
        const response = await core.tabs.send(tabId, { type: 'V2_WS_SEND', message }).catch((error: unknown) => ({
            ok: false,
            error: { code: 'WS_SEND_FAILED', message: error instanceof Error ? error.message : String(error) },
        }));
        return response as { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } };
    });
}
