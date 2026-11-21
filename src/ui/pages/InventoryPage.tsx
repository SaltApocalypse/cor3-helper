import { useState } from 'preact/hooks';
import type { AutoMailStatus, InventoryItemView, InventoryPreviewResult, InventorySummary } from '../../application/popup/portal.js';
import type { SpecialistPurchase, SpecialistState } from '../../domains/specialists/model.js';
import { formatRemaining } from '../format.js';
import { InfoTip } from '../components/InfoTip.js';
import { useT, type TranslateSource } from '../i18n-context.js';

const SELL_TIERS = [
    { value: 'COMMON', label: 'COMMON' },
    { value: 'RARE', label: 'RARE' },
] as const;
const SELL_TAGS = [
    { value: 'none', label: 'NONE' },
    { value: 'craft', label: 'CRAFT' },
] as const;
const TIER_ORDER: Record<string, number> = { QUEST: 0, LEGENDARY: 1, EPIC: 2, SUPERRARE: 3, RARE: 4, COMMON: 5 };

export type InventorySellTier = typeof SELL_TIERS[number]['value'];
export type InventorySellTag = typeof SELL_TAGS[number]['value'];

interface InventoryGroup {
    readonly key: string;
    readonly item: InventoryItemView;
    readonly quantity: number;
}

export interface InventoryPageProps {
    readonly inventory: InventorySummary | null;
    readonly inventoryStatus: string;
    readonly busy: boolean;
    readonly sorting: boolean;
    readonly sortingTableItems: number;
    readonly onSort: (mode: 'smart' | 'compact') => void | Promise<void>;
    readonly items: readonly InventoryItemView[];
    readonly inventoryFilter: string;
    readonly onInventoryFilterChange: (value: string) => void;
    readonly onSellItem: (id: string) => void | Promise<void>;
    readonly sellingItemId: string | null;
    readonly sellTier: InventorySellTier;
    readonly onSellTierChange: (tier: InventorySellTier) => void;
    readonly sellTag: InventorySellTag;
    readonly onSellTagChange: (tag: InventorySellTag) => void;
    readonly sellPreview: InventoryPreviewResult | null;
    readonly onSellFilter: () => void | Promise<void>;
    readonly sellConfirm: boolean;
    readonly autoMail: AutoMailStatus | null;
    readonly autoMailBusy: boolean;
    readonly onToggleAutoMail: () => void | Promise<void>;
    readonly mailClaimBusy: boolean;
    readonly onClaimMailbox: () => void | Promise<void>;
    readonly specialists: SpecialistState | null;
    readonly specialistError: string | null;
    readonly specialistBusy: boolean;
    readonly now: number;
    readonly onPurchaseSpecialist: (purchase: SpecialistPurchase) => void | Promise<void>;
    readonly onRefreshInventory: () => void | Promise<void>;
    readonly helperMode: boolean;
    readonly panelOpen: Readonly<Record<string, boolean>>;
    readonly onPanelOpenChange: (key: string, open: boolean) => void;
}

function tierClass(tier: string): string {
    return `v2-tier-${tier.toLowerCase()}`;
}

function expansionStatusLabel(status: string, tr: TranslateSource): string {
    switch (status.trim().toUpperCase()) {
        case 'ACTIVE': return tr('Active');
        case 'IN_GRACE': return tr('In grace');
        case 'AVAILABLE': return tr('Available');
        case 'LOCKED': return tr('Locked');
        case 'EXPIRED': return tr('Expired');
        case 'OWNED': return tr('Owned');
        default: return status;
    }
}

function canSellDirectly(item: InventoryItemView): boolean {
    const tier = item.tier.toUpperCase();
    return item.canSell && item.sellPrice > 0 && (tier === 'COMMON' || tier === 'RARE');
}

function groupItems(items: readonly InventoryItemView[]): InventoryGroup[] {
    const groups = new Map<string, InventoryGroup>();
    for (const item of items) {
        const key = item.itemConfigId ?? `${item.name}|${item.tier}|${item.canCraft ? 'craft' : 'plain'}`;
        const existing = groups.get(key);
        if (existing) {
            groups.set(key, {
                ...existing,
                quantity: existing.quantity + item.quantity,
            });
        } else {
            groups.set(key, {
                key,
                item,
                quantity: item.quantity,
            });
        }
    }
    return [...groups.values()];
}

export function InventoryPage({
    inventory,
    inventoryStatus,
    busy,
    sorting,
    sortingTableItems,
    onSort,
    items,
    inventoryFilter,
    onInventoryFilterChange,
    onSellItem,
    sellingItemId,
    sellTier,
    onSellTierChange,
    sellTag,
    onSellTagChange,
    sellPreview,
    onSellFilter,
    sellConfirm,
    autoMail,
    autoMailBusy,
    onToggleAutoMail,
    mailClaimBusy,
    onClaimMailbox,
    specialists,
    specialistError,
    specialistBusy,
    now,
    onPurchaseSpecialist,
    onRefreshInventory,
    helperMode,
    panelOpen,
    onPanelOpenChange,
}: InventoryPageProps) {
    const tr = useT();
    const [visibleLimit, setVisibleLimit] = useState(200);
    const [sortConfirm, setSortConfirm] = useState<'smart' | 'compact' | null>(null);
    const [confirmSpecialist, setConfirmSpecialist] = useState<string | null>(null);
    const autoMailEnabled = autoMail?.enabled ?? false;
    const autoMailLast = autoMail?.last ?? null;
    const totalValue = items.reduce((sum, item) => sum + (item.canSell ? item.sellPrice * item.quantity : 0), 0);
    const filteredGroups = groupItems(items)
        .filter((group) => inventoryFilter.length === 0
            || `${group.item.name} ${group.item.tier} ${group.item.tags.join(' ')}`.toLowerCase().includes(inventoryFilter.toLowerCase()))
        .sort((left, right) => {
            const byTier = (TIER_ORDER[left.item.tier.toUpperCase()] ?? 6) - (TIER_ORDER[right.item.tier.toUpperCase()] ?? 6);
            if (byTier !== 0) return byTier;
            return left.item.name.localeCompare(right.item.name);
        });
    const visibleGroups = filteredGroups.slice(0, visibleLimit);
    const rental = inventory?.rental ?? null;
    const rentalStatus = (rental?.status ?? '').trim().toUpperCase();
    const rentalActive = Boolean(rental && (rental.expiresAt || rentalStatus === 'ACTIVE' || rentalStatus === 'IN_GRACE'));
    const requestSpecialistPurchase = (purchase: SpecialistPurchase) => {
        const key = `${purchase.kind}:${purchase.level}:${purchase.priceId}`;
        if (confirmSpecialist !== key) {
            setConfirmSpecialist(key);
            return;
        }
        setConfirmSpecialist(null);
        void onPurchaseSpecialist(purchase);
    };
    const requestSort = (mode: 'smart' | 'compact') => {
        if (sortConfirm !== mode) {
            setSortConfirm(mode);
            return;
        }
        setSortConfirm(null);
        void onSort(mode);
    };
    return (
        <div class="v2-stash">
            <div class="v2-stash-summary">
                <span>{inventory ? tr('{used}/{max} capacity', { used: inventory.currentUsage ?? inventory.items, max: inventory.maxCapacity ?? '?' }) : tr('Warehouse data not loaded')}</span>
                {inventory ? <span>{tr('{width} × {rows} grid', { width: inventory.gridWidth ?? '?', rows: inventory.usableRows ?? '?' })}</span> : null}
                {inventory ? <span class="v2-stash-value">{totalValue.toLocaleString()} cr</span> : null}
            </div>
            {inventoryStatus ? <p class="v2-muted v2-stash-status">{tr(inventoryStatus)}</p> : null}
            {sortingTableItems > 0 ? <p class="v2-text-warn">{tr('The sorting table is not empty. Close the warehouse window in-game to return those items before sorting.')}</p> : null}

            {!helperMode ? (
                <div class="v2-auto-complete">
                    <div class="v2-auto-complete-header">
                        <span class="v2-auto-complete-title">{tr('Auto collect mailbox')}</span>
                        <button
                            type="button"
                            class="v2-switch"
                            role="switch"
                            aria-checked={autoMailEnabled}
                            aria-label={tr('Auto collect mailbox')}
                            title={autoMailEnabled ? tr('Disable auto collect mailbox') : tr('Enable auto collect mailbox')}
                            disabled={autoMailBusy}
                            onClick={() => void onToggleAutoMail()}
                        >
                            <span />
                        </button>
                    </div>
                    <div class="v2-actions">
                        <button type="button" disabled={mailClaimBusy || autoMailBusy} onClick={() => void onClaimMailbox()}>
                            {mailClaimBusy ? tr('Claiming...') : tr('Claim mailbox now')}
                        </button>
                    </div>
                    {autoMailBusy || autoMail?.running ? (
                        <p class="v2-muted v2-stash-status">{autoMailBusy ? tr('Updating mailbox automation…') : tr('Collecting mailbox…')}</p>
                    ) : autoMailLast ? (
                        <p class={`v2-muted v2-stash-status${autoMailLast.error ? ' v2-text-error' : ''}`}>
                            {autoMailLast.error
                                ? tr('Mailbox collect failed: {message}', { message: autoMailLast.error })
                                : `${tr('Mailbox: {claimed} collected', { claimed: autoMailLast.claimed })}${autoMailLast.failed > 0 ? tr(' · {count} failed', { count: autoMailLast.failed }) : ''}${autoMailLast.stashFull ? tr(' · stash full') : ''}`}
                        </p>
                    ) : null}
                </div>
            ) : null}

            <details
                class="v2-loadout-section"
                open={panelOpen['game.inventory.sort'] ?? false}
                onToggle={(event) => onPanelOpenChange('game.inventory.sort', (event.currentTarget as HTMLDetailsElement).open)}
            >
                <summary class="v2-loadout-section-head">
                    <span class="v2-stash-fold-title">
                        {tr('Sort')}
                        <InfoTip text={tr('Smart keeps rarity sections and packs short items into spare space. Compact packs everything as tightly as possible. Sorting is server-driven and can take a long time; do not refresh or close the page.')} />
                    </span>
                </summary>
                <div class="v2-loadout-section-body">
                    <div class="v2-stash-sort-actions">
                        <button type="button" disabled={busy || sortingTableItems > 0} onClick={() => requestSort('smart')}>
                            {sortConfirm === 'smart' ? tr('Confirm') : tr('Smart')}
                        </button>
                        <button type="button" disabled={busy || sortingTableItems > 0} onClick={() => requestSort('compact')}>
                            {sortConfirm === 'compact' ? tr('Confirm') : tr('Compact')}
                        </button>
                    </div>
                    {sorting ? (
                        <p class="v2-text-warn v2-stash-status" role="status">
                            {tr('Sorting can take a long time. Please wait and do not close the page.')}
                        </p>
                    ) : null}
                </div>
            </details>

            <details
                class="v2-loadout-section"
                open={panelOpen['game.inventory.sell'] ?? false}
                onToggle={(event) => onPanelOpenChange('game.inventory.sell', (event.currentTarget as HTMLDetailsElement).open)}
            >
                <summary class="v2-loadout-section-head">
                    {tr('Batch sell')}
                </summary>
                <div class="v2-loadout-section-body">
                    <div class="v2-stash-sell-row">
                        <label class="v2-field">
                            <span>{tr('Tier')}</span>
                            <select
                                class={`v2-stash-select ${tierClass(sellTier)}`}
                                value={sellTier}
                                onInput={(event) => onSellTierChange((event.currentTarget as HTMLSelectElement).value as InventorySellTier)}
                            >
                                {SELL_TIERS.map((entry) => <option key={entry.value} value={entry.value}>{tr(entry.label)}</option>)}
                            </select>
                        </label>
                        <label class="v2-field">
                            <span>{tr('Tag')}</span>
                            <select
                                class="v2-stash-select"
                                value={sellTag}
                                onInput={(event) => onSellTagChange((event.currentTarget as HTMLSelectElement).value as InventorySellTag)}
                            >
                                {SELL_TAGS.map((entry) => <option key={entry.value} value={entry.value}>{tr(entry.label)}</option>)}
                            </select>
                        </label>
                    </div>
                    {sellPreview ? (
                        <div class="v2-stash-preview">
                            <span>
                                {tr('Estimated income: {value} cr', { value: sellPreview.value.toLocaleString() })}
                                {tr(' · {stacks} stack(s) · {quantity} item(s)', { stacks: sellPreview.stacks, quantity: sellPreview.quantity })}
                            </span>
                            {sellPreview.protectedStacks > 0 ? (
                                <span class="v2-text-warn">
                                    {tr('{count} item(s) cannot be sold automatically ({value} cr).', { count: sellPreview.protectedStacks, value: sellPreview.protectedValue.toLocaleString() })}
                                </span>
                            ) : null}
                        </div>
                    ) : null}
                    <button
                        type="button"
                        class="v2-stash-sell-button"
                        disabled={busy || (sellPreview?.stacks ?? 0) === 0}
                        onClick={() => void onSellFilter()}
                    >
                        {sellConfirm ? tr('Confirm sell {count}', { count: sellPreview?.stacks ?? 0 }) : tr('Sell')}
                    </button>
                </div>
            </details>

            <details
                class="v2-loadout-section"
                open={panelOpen['game.inventory.expansion'] ?? false}
                onToggle={(event) => onPanelOpenChange('game.inventory.expansion', (event.currentTarget as HTMLDetailsElement).open)}
            >
                <summary class="v2-loadout-section-head">
                    {tr('Warehouse expansion service')}
                </summary>
                <div class="v2-loadout-section-body">
                    {rentalActive && rental ? (
                        <div class="v2-expansion-card is-active">
                            <div class="v2-expansion-head">
                                <strong>{tr('Warehouse expansion rental')}</strong>
                                <span class="v2-tag v2-tag-ok">{expansionStatusLabel(rental.status ?? 'ACTIVE', tr)}</span>
                            </div>
                            <p class="v2-muted">
                                {rental.expiresAt
                                    ? tr('Remaining: {time}', { time: formatRemaining(rental.expiresAt, now) })
                                    : tr('No expiry reported')}
                                {rental.gracePeriodEndAt
                                    ? ` · ${tr('Grace ends in {time}', { time: formatRemaining(rental.gracePeriodEndAt, now) })}`
                                    : ''}
                            </p>
                        </div>
                    ) : null}
                    {specialistError ? (
                        <div class="v2-specialist-error">
                            <p class="v2-text-warn">
                                {tr('Warehouse expansion data could not be loaded: {error}', { error: specialistError })}
                            </p>
                            <button type="button" class="v2-link-button" disabled={busy} onClick={() => void onRefreshInventory()}>
                                {tr('Retry')}
                            </button>
                        </div>
                    ) : null}
                    {!specialistError && (!specialists || !specialists.available) ? (
                        rentalActive
                            ? null
                            : <p class="v2-muted">{specialists ? tr('Warehouse expansion service is not available.') : tr('Warehouse expansion data is not loaded.')}</p>
                    ) : null}
                    {specialists?.available ? (
                        <>
                            {specialists.expansions.length === 0 && specialists.offers.length === 0 ? (
                                <p class="v2-muted">{tr('No warehouse expansion offers are available.')}</p>
                            ) : null}
                            {specialists.expansions.map((expansion) => {
                                const priceId = expansion.priceId;
                                const key = `${expansion.kind}:${expansion.level}:${priceId ?? ''}`;
                                const confirming = priceId !== null && confirmSpecialist === key;
                                return (
                                    <div class="v2-expansion-card is-active" key={`active-${expansion.specialistId}-${expansion.kind}-${expansion.level}`}>
                                        <div class="v2-expansion-main">
                                            <strong>{tr('Level {level}', { level: expansion.level })}</strong>
                                            <span class="v2-expansion-meta">
                                                {tr('+{slots} warehouse slots', { slots: expansion.bonusSlots })}
                                                {' · '}
                                                {expansion.expiresAt
                                                    ? tr('Remaining: {time}', { time: formatRemaining(expansion.expiresAt, now) })
                                                    : tr('No expiry reported')}
                                                {expansion.gracePeriodEndAt
                                                    ? ` · ${tr('Grace ends in {time}', { time: formatRemaining(expansion.gracePeriodEndAt, now) })}`
                                                    : ''}
                                            </span>
                                        </div>
                                        <span class="v2-tag v2-tag-ok v2-expansion-status">{expansionStatusLabel(expansion.status, tr)}</span>
                                        {priceId ? (
                                            <button
                                                type="button"
                                                class={`v2-expansion-action${confirming ? ' is-confirming' : ''}`}
                                                disabled={specialistBusy}
                                                onClick={() => requestSpecialistPurchase({
                                                    specialistType: expansion.specialistType,
                                                    kind: expansion.kind,
                                                    level: expansion.level,
                                                    priceId,
                                                })}
                                            >
                                                {confirming
                                                    ? tr('Confirm extend · {credits} CR', { credits: expansion.credits !== null ? expansion.credits.toLocaleString() : '?' })
                                                    : tr('Extend · {credits} CR', { credits: expansion.credits !== null ? expansion.credits.toLocaleString() : '?' })}
                                            </button>
                                        ) : null}
                                    </div>
                                );
                            })}
                            {specialists.offers.map((offer) => {
                                const key = `${offer.kind}:${offer.level}:${offer.priceId}`;
                                const confirming = confirmSpecialist === key;
                                return (
                                    <div class="v2-expansion-card" key={`offer-${offer.specialistId}-${offer.kind}-${offer.level}`}>
                                        <div class="v2-expansion-main">
                                            <strong>{tr('Level {level}', { level: offer.level })}</strong>
                                            <span class="v2-expansion-meta">{tr('+{slots} warehouse slots', { slots: offer.bonusSlots })}</span>
                                        </div>
                                        <span class="v2-tag v2-expansion-status">{expansionStatusLabel(offer.status, tr)}</span>
                                        <button
                                            type="button"
                                            class={`v2-expansion-action${confirming ? ' is-confirming' : ''}`}
                                            disabled={specialistBusy}
                                            onClick={() => requestSpecialistPurchase({
                                                specialistType: offer.specialistType,
                                                kind: offer.kind,
                                                level: offer.level,
                                                priceId: offer.priceId,
                                            })}
                                        >
                                            {confirming
                                                ? tr('Confirm purchase · {credits} CR', { credits: offer.credits !== null ? offer.credits.toLocaleString() : '?' })
                                                : tr('Purchase · {credits} CR', { credits: offer.credits !== null ? offer.credits.toLocaleString() : '?' })}
                                        </button>
                                    </div>
                                );
                            })}
                        </>
                    ) : null}
                </div>
            </details>

            <input
                class="v2-wide-input"
                placeholder={tr('Filter items by name / tier / tag')}
                value={inventoryFilter}
                onInput={(event) => onInventoryFilterChange((event.currentTarget as HTMLInputElement).value)}
            />
            <div class="v2-stash-rows">
                {visibleGroups.map((group) => {
                    const item = group.item;
                    const sellable = canSellDirectly(item);
                    return (
                        <div key={group.key} class={`v2-stash-row ${tierClass(item.tier)}`}>
                            <div class="v2-stash-row-thumb">
                                {item.imageUrl
                                    ? <img src={item.imageUrl} alt="" loading="lazy" />
                                    : <span>{item.tier.slice(0, 1)}</span>}
                                {sellable ? (
                                    <button
                                        type="button"
                                        class={`v2-stash-row-sell-overlay${sellingItemId === item.id ? ' is-selling' : ''}`}
                                        disabled={busy || sellingItemId !== null}
                                        onClick={() => void onSellItem(item.id)}
                                    >
                                        {sellingItemId === item.id ? tr('Selling…') : tr('Sell')}
                                    </button>
                                ) : null}
                            </div>
                            <div class="v2-stash-row-main">
                                <strong>{item.name}</strong>
                            </div>
                            <div class="v2-stash-row-side">
                                <div class="v2-stash-row-tags">
                                    <span class={`v2-tier ${tierClass(item.tier)}`}>{tr(item.tier)}</span>
                                    {item.canCraft ? <span class="v2-tag v2-tag-warn">{tr('CRAFT')}</span> : null}
                                    {item.canUse ? <span class="v2-tag">{tr('USE')}</span> : null}
                                </div>
                                <span class="v2-stash-row-value">
                                    {item.sellPrice > 0 ? `${item.sellPrice.toLocaleString()} cr` : '—'}
                                    {group.quantity > 1 ? ` · ×${group.quantity}` : ''}
                                </span>
                            </div>
                        </div>
                    );
                })}
                {filteredGroups.length === 0 ? (
                    <div class="v2-stash-row v2-stash-row-empty">
                        <div class="v2-stash-row-main">
                            <strong>{tr('No matching items.')}</strong>
                        </div>
                    </div>
                ) : null}
            </div>
            {filteredGroups.length > visibleLimit ? (
                <button type="button" disabled={busy} onClick={() => setVisibleLimit((value) => value + 200)}>
                    {tr('Show more ({count} remaining)', { count: filteredGroups.length - visibleLimit })}
                </button>
            ) : null}
        </div>
    );
}
