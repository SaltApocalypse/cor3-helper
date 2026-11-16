import type { ServerAccessPort, ServerAccessContext } from '../../application/network/route-executor.js';
import type { GameError } from '../../application/game/ports.js';
import { unwrapTabResult } from './tab-response.js';
import { err, ok, type Result } from '../../kernel/result.js';
import type { ServerId } from '../../kernel/ids.js';
import type { TabMessagePort } from '../auth/chrome-tab-auth-adapter.js';

type Sleep = (ms: number) => Promise<void>;

interface HackLoadoutPort {
    ensure(request: { ability: 'HACK'; target: string; requiredPower: number }): Promise<Result<unknown, { code: string; message: string }>>;
}

interface AccessData {
    readonly activeAccesses?: Array<{ readonly id?: unknown }>;
}

interface MinigamePort {
    solve(timeoutMs?: number): Promise<Result<unknown, GameError>>;
}

export class ChromeTabServerAccessAdapter implements ServerAccessPort {
    constructor(
        private readonly tabs: TabMessagePort,
        private readonly sleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        private readonly loadout?: HackLoadoutPort,
        private readonly minigames?: MinigamePort,
    ) {}

    async ensureAccess(serverId: ServerId, context?: ServerAccessContext): Promise<Result<void, GameError>> {
        const tabId = await this.tabs.findCor3Tab();
        if (tabId === null) return err({ code: 'NO_COR3_TAB', message: 'No cor3.gg tab found' });
        try {
            let status = await this.loginStatus(tabId, serverId);
            if (!status.ok) return status;
            let access = this.firstAccess(status.value);
            if (!access) {
                // Try the current loadout first, like v1. Equipping a HACK
                // loadout before the attempt made direct/unneeded routes fail
                // with LOADOUT_NO_PLAN even when the server was auto-hackable
                // or the current module was sufficient.
                let hack = await this.hackStart(tabId, serverId);
                if (!hack.ok && this.isRetryableHack(hack.error.code, hack.error.message)) {
                    const retryLoadout = await this.ensureHackLoadout(status.value, context);
                    if (!retryLoadout.ok) return retryLoadout;
                    hack = await this.hackStart(tabId, serverId);
                }
                if (!hack.ok) {
                    if (await this.recoverAccess(tabId, serverId)) return ok(undefined);
                    return hack;
                }
                if (!hack.value.autoHacked) {
                    await this.minigames?.solve(30000);
                }
                for (let attempt = 0; attempt < 5 && !access; attempt++) {
                    await this.sleep(attempt === 0 ? 1000 : 1500);
                    status = await this.loginStatus(tabId, serverId);
                    if (!status.ok) return status;
                    access = this.firstAccess(status.value);
                }
                if (!access && await this.recoverAccess(tabId, serverId)) return ok(undefined);
            }
            if (!access) return err({ code: 'NO_ACCESS', message: 'No access granted after hack' });
            const loginResponse = await this.tabs.send(tabId, {
                type: 'V2_LOGIN_WITH_ACCESS',
                serverId,
                accessGrantId: access,
            });
            const login = unwrapTabResult(loginResponse, { code: 'ACCESS_COMMAND_FAILED', message: 'Access command failed' });
            if (!login.ok) return err(login.error);
            return ok(undefined);
        } catch (error) {
            return err({ code: 'ACCESS_COMMAND_FAILED', message: error instanceof Error ? error.message : String(error) });
        }
    }

    private async recoverAccess(tabId: number, serverId: ServerId): Promise<boolean> {
        try {
            await this.minigames?.solve(5000);
        } catch {
            // The solver may not have a minigame to attach to.
        }
        await this.sleep(1000);
        const status = await this.loginStatus(tabId, serverId);
        if (!status.ok) return false;
        const access = this.firstAccess(status.value);
        if (!access) return false;
        const login = unwrapTabResult(await this.tabs.send(tabId, {
            type: 'V2_LOGIN_WITH_ACCESS',
            serverId,
            accessGrantId: access,
        }), { code: 'ACCESS_COMMAND_FAILED', message: 'Access command failed' });
        return login.ok;
    }

    private async ensureHackLoadout(status: unknown, context?: ServerAccessContext): Promise<Result<void, GameError>> {
        if (!this.loadout || !context?.serverTypeName) return ok(undefined);
        const statusData = status as { serverDefenceRate?: unknown } | null;
        const requiredPower = typeof statusData?.serverDefenceRate === 'number' ? statusData.serverDefenceRate : 0;
        const equipped = await this.loadout.ensure({
            ability: 'HACK',
            target: context.serverTypeName,
            requiredPower,
        });
        if (!equipped.ok) {
            return err({ code: `LOADOUT_${equipped.error.code}`, message: equipped.error.message });
        }
        return ok(undefined);
    }

    private isRetryableHack(code: string, message: string): boolean {
        return code === 'sai-hack-impossible'
            || code === 'sai-no-hack-software'
            || /sai-(?:no-hack-software|hack-impossible)|hack software/i.test(message);
    }

    private async loginStatus(tabId: number, serverId: ServerId): Promise<Result<unknown, GameError>> {
        return unwrapTabResult(await this.tabs.send(tabId, { type: 'V2_LOGIN_STATUS', serverId }), { code: 'ACCESS_COMMAND_FAILED', message: 'Access command failed' });
    }

    private async hackStart(tabId: number, serverId: ServerId): Promise<Result<{ readonly autoHacked: boolean }, GameError>> {
        const result = unwrapTabResult(await this.tabs.send(tabId, { type: 'V2_HACK_START', serverId }), { code: 'ACCESS_COMMAND_FAILED', message: 'Access command failed' });
        if (!result.ok) return result;
        const value = result.value as { autoHacked?: unknown } | null;
        return ok({ autoHacked: value?.autoHacked === true });
    }

    private firstAccess(value: unknown): string | null {
        const data = value as AccessData | null;
        const access = data?.activeAccesses?.find((entry) => typeof entry.id === 'string');
        return access && typeof access.id === 'string' ? access.id : null;
    }

}
