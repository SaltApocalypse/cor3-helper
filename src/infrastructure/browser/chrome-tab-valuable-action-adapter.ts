import type {
    SellableItem,
    SellableSnapshot,
    ValuableMarketPort,
    ValuableSaleOutcome,
    ValuableSearchHit,
    ValuableSearchOptions,
    ValuableSearchResult,
    ValuableServerPort,
} from '../../application/valuable/seller.js';
import type { ValuableFile, ValuableLog } from '../../domains/valuable/model.js';
import type { GameError } from '../../application/game/ports.js';
import { unwrapTabResult } from './tab-response.js';
import { err, ok, type Result } from '../../kernel/result.js';
import type { TabMessagePort } from '../auth/chrome-tab-auth-adapter.js';

function tagsOf(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const tags: string[] = [];
    for (const tag of value) {
        if (typeof tag === 'string') tags.push(tag);
        else if (tag && typeof tag === 'object') {
            const entry = tag as { key?: unknown; label?: unknown };
            const label = typeof entry.label === 'string' ? entry.label : typeof entry.key === 'string' ? entry.key : '';
            if (label) tags.push(label);
        }
    }
    return tags;
}

function numberOr(value: unknown, fallback = 0): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function firstNumber(values: readonly unknown[], fallback = 0): number {
    for (const value of values) {
        if (typeof value === 'number' && Number.isFinite(value)) return value;
    }
    return fallback;
}

export class ChromeTabValuableActionAdapter implements ValuableServerPort, ValuableMarketPort {
    constructor(private readonly tabs: TabMessagePort) {}

    async searchFiles(serverId: string, timeoutMs?: number, options?: ValuableSearchOptions): Promise<Result<ValuableSearchResult, GameError>> {
        return this.search('searchFiles', serverId, timeoutMs, options);
    }

    async searchLogs(serverId: string, timeoutMs?: number): Promise<Result<ValuableSearchResult, GameError>> {
        return this.search('searchLogs', serverId, timeoutMs);
    }

    async getFiles(serverId: string): Promise<Result<readonly ValuableFile[], GameError>> {
        const result = await this.action('getFiles', { serverId });
        if (!result.ok) return result;
        const data = result.value as { files?: unknown } | null;
        if (!Array.isArray(data?.files)) return ok([]);
        const files: ValuableFile[] = [];
        for (const raw of data.files) {
            if (!raw || typeof raw !== 'object') continue;
            const entry = raw as Record<string, unknown>;
            const fileId = typeof entry.fileId === 'string' ? entry.fileId : typeof entry.id === 'string' ? entry.id : '';
            if (!fileId) continue;
            files.push({
                fileId,
                name: typeof entry.name === 'string' ? entry.name : fileId,
                basePrice: numberOr(entry.basePrice),
                tags: tagsOf(entry.tags),
            });
        }
        return ok(files);
    }

    async getLogs(serverId: string): Promise<Result<readonly ValuableLog[], GameError>> {
        const result = await this.action('getLogs', { serverId });
        if (!result.ok) return result;
        const data = result.value as { logs?: unknown } | null;
        if (!Array.isArray(data?.logs)) return ok([]);
        const logs: ValuableLog[] = [];
        for (const raw of data.logs) {
            if (!raw || typeof raw !== 'object') continue;
            const entry = raw as Record<string, unknown>;
            const seq = typeof entry.seq === 'number' ? entry.seq : Number(entry.seq);
            if (!Number.isFinite(seq) || seq <= 0) continue;
            logs.push({
                seq,
                message: typeof entry.message === 'string' ? entry.message : '',
                basePrice: numberOr(entry.basePrice),
                tags: tagsOf(entry.tags),
            });
        }
        return ok(logs);
    }

    async downloadFile(serverId: string, fileId: string): Promise<Result<void, GameError>> {
        return this.actionVoid('downloadFile', { serverId, fileId });
    }

    async downloadLog(serverId: string, seq: number): Promise<Result<void, GameError>> {
        return this.actionVoid('downloadLog', { serverId, seq });
    }

    async getSellableItems(marketId: string): Promise<Result<SellableSnapshot, GameError>> {
        const result = await this.action('getSellableItems', { marketId });
        if (!result.ok) return result;
        const data = result.value as { items?: unknown; totalPrice?: unknown; totalRepGain?: unknown } | null;
        const items: SellableItem[] = [];
        if (Array.isArray(data?.items)) {
            for (const raw of data.items) {
                if (!raw || typeof raw !== 'object') continue;
                const entry = raw as Record<string, unknown>;
                const itemId = typeof entry.itemId === 'string'
                    ? entry.itemId
                    : typeof entry.id === 'string'
                        ? entry.id
                        : typeof entry.fileId === 'string' ? entry.fileId : '';
                if (!itemId) continue;
                items.push({
                    itemType: typeof entry.itemType === 'string' ? entry.itemType : 'file',
                    itemId,
                    price: firstNumber([entry.price, entry.sellPrice, entry.totalPrice, entry.basePrice, entry.value]),
                    reputation: firstNumber([entry.reputationGain, entry.repGain, entry.totalRepGain, entry.reputation]),
                });
            }
        }
        return ok({
            items,
            totalPrice: numberOr(data?.totalPrice),
            totalRepGain: numberOr(data?.totalRepGain),
        });
    }

    async sellItems(marketId: string, items: readonly SellableItem[]): Promise<Result<ValuableSaleOutcome, GameError>> {
        let sold = 0;
        let credits = 0;
        let reputation = 0;
        for (const item of items) {
            const result = await this.action('sellItems', {
                marketId,
                items: [{ itemType: item.itemType, itemId: item.itemId }],
            });
            if (!result.ok) break;
            sold += 1;
            const data = result.value as Record<string, unknown> | null;
            credits += firstNumber([data?.totalPrice, data?.credits, data?.price, data?.value], item.price);
            reputation += firstNumber(
                [data?.totalRepGain, data?.reputationGain, data?.reputation],
                item.reputation,
            );
        }
        return ok({ sold, credits, reputation });
    }

    private async search(
        kind: 'searchFiles' | 'searchLogs',
        serverId: string,
        timeoutMs?: number,
        options?: ValuableSearchOptions,
    ): Promise<Result<ValuableSearchResult, GameError>> {
        const result = await this.action(kind, {
            serverId,
            ...(timeoutMs !== undefined ? { timeoutMs } : {}),
            ...(options?.bypassRateLimitCooldown ? { bypassRateLimitCooldown: true } : {}),
        });
        if (!result.ok) return result;
        const data = result.value as { found?: unknown; searchPowerUsed?: unknown } | null;
        const found: ValuableSearchHit[] = [];
        if (Array.isArray(data?.found)) {
            for (const raw of data.found) {
                if (!raw || typeof raw !== 'object') continue;
                const entry = raw as Record<string, unknown>;
                const id = typeof entry.id === 'string' ? entry.id : typeof entry.fileId === 'string' ? entry.fileId : '';
                if (!id) continue;
                found.push({ id, basePrice: numberOr(entry.basePrice) });
            }
        }
        return ok({
            found,
            ...(typeof data?.searchPowerUsed === 'number' ? { searchPowerUsed: data.searchPowerUsed } : {}),
        });
    }

    private async action(kind: string, payload: Record<string, unknown>): Promise<Result<unknown, GameError>> {
        const tabId = await this.tabs.findCor3Tab();
        if (tabId === null) return err({ code: 'NO_COR3_TAB', message: 'No cor3.gg tab found' });
        try {
            const response = await this.tabs.send(tabId, { type: 'V2_VALUABLE_ACTION', kind, payload });
            return unwrapTabResult(response, { code: 'VALUABLE_ACTION_FAILED', message: 'Valuable action failed' });
        } catch (error) {
            return err({ code: 'VALUABLE_ACTION_FAILED', message: error instanceof Error ? error.message : String(error) });
        }
    }

    private async actionVoid(kind: string, payload: Record<string, unknown>): Promise<Result<void, GameError>> {
        const result = await this.action(kind, payload);
        return result.ok ? ok(undefined) : result;
    }

}
