import { useCallback, useEffect, useState } from 'preact/hooks';
import type {
    InventoryItemView,
    InventoryPreviewResult,
    InventorySummary,
    PopupPortal,
} from '../../../application/popup/portal.js';
import type { SpecialistPurchase, SpecialistState } from '../../../domains/specialists/model.js';
import type { TranslateSource } from '../../i18n-context.js';
import type { InventorySellTag, InventorySellTier } from '../../pages/InventoryPage.js';

/**
 * Warehouse inventory, specialists and bulk selling (H8 phase 7).
 */

export interface InventoryState {
    readonly inventory: InventorySummary | null;
    readonly inventoryItems: readonly InventoryItemView[];
    readonly inventoryFilter: string;
    readonly setInventoryFilter: (value: string) => void;
    readonly inventoryStatus: string;
    readonly setInventoryStatus: (value: string) => void;
    readonly inventoryBusy: boolean;
    readonly inventorySorting: boolean;
    readonly sortingTableItems: number;
    readonly specialists: SpecialistState | null;
    readonly specialistError: string | null;
    readonly specialistBusy: boolean;
    readonly sellTier: InventorySellTier;
    readonly sellTag: InventorySellTag;
    readonly sellPreview: InventoryPreviewResult | null;
    readonly sellConfirm: boolean;
    readonly sellingItemId: string | null;
    readonly loadInventory: () => Promise<void>;
    readonly changeSellTier: (tier: InventorySellTier) => void;
    readonly changeSellTag: (tag: InventorySellTag) => void;
    readonly sellInventoryFilter: () => Promise<void>;
    readonly sellInventoryItem: (itemId: string) => Promise<void>;
    readonly purchaseSpecialist: (purchase: SpecialistPurchase) => Promise<void>;
    readonly sortInventory: (mode: 'smart' | 'compact') => Promise<void>;
}

export function useInventory(portal: PopupPortal, tt: TranslateSource): InventoryState {
    const [inventory, setInventory] = useState<InventorySummary | null>(null);
    const [inventoryItems, setInventoryItems] = useState<readonly InventoryItemView[]>([]);
    const [inventoryFilter, setInventoryFilter] = useState('');
    const [specialists, setSpecialists] = useState<SpecialistState | null>(null);
    const [specialistError, setSpecialistError] = useState<string | null>(null);
    const [sellConfirm, setSellConfirm] = useState(false);
    const [sellingItemId, setSellingItemId] = useState<string | null>(null);
    const [inventoryStatus, setInventoryStatus] = useState('Inventory not loaded');
    const [inventoryBusy, setInventoryBusy] = useState(false);
    const [inventorySorting, setInventorySorting] = useState(false);
    const [specialistBusy, setSpecialistBusy] = useState(false);
    const [sellTier, setSellTier] = useState<InventorySellTier>('COMMON');
    const [sellTag, setSellTag] = useState<InventorySellTag>('none');
    const [sellPreview, setSellPreview] = useState<InventoryPreviewResult | null>(null);
    const [sortingTableItems, setSortingTableItems] = useState(0);

    const loadInventory = useCallback(async () => {
        setInventoryBusy(true);
        const [view, specialistResponse] = await Promise.all([portal.inventoryView(), portal.specialistView()]);
        if (specialistResponse.ok) {
            setSpecialists(specialistResponse.value);
            setSpecialistError(null);
        } else {
            // Do not fake an "unavailable" feature when the request itself
            // failed. Keep the last good data (if any) and surface the error.
            setSpecialistError(specialistResponse.error.message);
        }
        if (view.ok) {
            setInventory(view.value.summary);
            setInventoryItems(view.value.items);
            setSortingTableItems(view.value.sortingTableItems);
            setInventoryStatus('');
        } else {
            setInventoryStatus(view.error.message);
        }
        setInventoryBusy(false);
    }, [portal]);

    useEffect(() => {
        void loadInventory();
    }, [loadInventory]);

    const refreshSellPreview = useCallback(async (tier: InventorySellTier, tag: InventorySellTag) => {
        const response = await portal.previewInventoryFilter([tier], tag);
        if (response.ok) {
            setSellPreview(response.value);
            setSellConfirm(false);
        } else {
            setInventoryStatus(response.error.message);
        }
    }, [portal]);

    useEffect(() => {
        if (inventoryItems.length === 0) {
            setSellPreview(null);
            return;
        }
        const timer = setTimeout(() => { void refreshSellPreview(sellTier, sellTag); }, 150);
        return () => clearTimeout(timer);
    }, [inventoryItems, sellTier, sellTag, refreshSellPreview]);

    const changeSellTier = useCallback((tier: InventorySellTier) => {
        setSellTier(tier);
        setSellConfirm(false);
    }, []);

    const changeSellTag = useCallback((tag: InventorySellTag) => {
        setSellTag(tag);
        setSellConfirm(false);
    }, []);

    const sellInventoryFilter = useCallback(async () => {
        setInventoryBusy(true);
        let previewValue = sellPreview;
        if (!previewValue) {
            const preview = await portal.previewInventoryFilter([sellTier], sellTag);
            if (!preview.ok) {
                setInventoryStatus(preview.error.message);
                setInventoryBusy(false);
                return;
            }
            previewValue = preview.value;
            setSellPreview(previewValue);
        }
        const count = previewValue.stacks;
        if (count === 0) {
            setInventoryStatus(tt('No sellable items match the selected filters'));
            setInventoryBusy(false);
            return;
        }
        if (!sellConfirm) {
            setSellConfirm(true);
            setInventoryStatus(tt('Confirm selling {count} stack(s). Items above RARE are always skipped.', { count }));
            setInventoryBusy(false);
            return;
        }
        setSellConfirm(false);
        setInventoryStatus(tt('Selling filtered items...'));
        const response = await portal.sellInventoryFilter([sellTier], sellTag);
        if (response.ok) {
            setInventoryStatus(`${tt('Sold {stacks} stack(s), {quantity} item(s)', { stacks: response.value.soldStacks, quantity: response.value.soldQuantity })}: ${response.value.sellValue} cr${response.value.protectedStacks > 0 ? tt(' · {count} protected item(s) kept', { count: response.value.protectedStacks }) : ''}${response.value.failed.length > 0 ? tt(' · {count} failed', { count: response.value.failed.length }) : ''}${response.value.mailClaimed ? tt(' · mail claimed {count}', { count: response.value.mailClaimed }) : ''}`);
            setSellPreview(null);
            await loadInventory();
        } else {
            setInventoryStatus(response.error.message);
        }
        setInventoryBusy(false);
    }, [portal, sellTier, sellTag, sellPreview, sellConfirm, loadInventory, tt]);

    const sellInventoryItem = useCallback(async (itemId: string) => {
        if (sellingItemId !== null) return;
        setSellingItemId(itemId);
        const response = await portal.sellInventoryItem(itemId, 1);
        setInventoryStatus(response.ok
            ? tt('Sold {quantity} × {name} for {value} credits', { quantity: response.value.quantity, name: response.value.name, value: response.value.sellValue })
            : response.error.message);
        setSellingItemId(null);
        if (response.ok) await loadInventory();
    }, [portal, sellingItemId, loadInventory, tt]);

    const purchaseSpecialist = useCallback(async (purchase: SpecialistPurchase) => {
        setSpecialistBusy(true);
        try {
            const response = await portal.purchaseSpecialist(purchase);
            if (response.ok) {
                setInventoryStatus(tt('Purchase sent. Refreshing warehouse expansion...'));
                await new Promise((resolve) => setTimeout(resolve, 2000));
                await loadInventory();
            } else {
                setInventoryStatus(response.error.message);
            }
        } finally {
            setSpecialistBusy(false);
        }
    }, [portal, loadInventory, tt]);

    const sortInventory = useCallback(async (mode: 'smart' | 'compact') => {
        setInventoryBusy(true);
        setInventorySorting(true);
        setInventoryStatus(tt('Planning {mode} layout...', { mode: mode === 'smart' ? tt('smart') : tt('compact') }));
        try {
            const response = await portal.sortInventory(mode);
            if (response.ok) {
                setInventoryStatus(`${response.value.mode}: ${response.value.moves}${response.value.fallback ? ` ${tt('(compact fallback)')}` : ''}${response.value.notice ? ` — ${response.value.notice}` : ''}`);
                await loadInventory();
            } else {
                setInventoryStatus(response.error.message);
            }
        } finally {
            setInventorySorting(false);
            setInventoryBusy(false);
        }
    }, [portal, loadInventory, tt]);

    return {
        inventory,
        inventoryItems,
        inventoryFilter,
        setInventoryFilter,
        inventoryStatus,
        setInventoryStatus,
        inventoryBusy,
        inventorySorting,
        sortingTableItems,
        specialists,
        specialistError,
        specialistBusy,
        sellTier,
        sellTag,
        sellPreview,
        sellConfirm,
        sellingItemId,
        loadInventory,
        changeSellTier,
        changeSellTag,
        sellInventoryFilter,
        sellInventoryItem,
        purchaseSpecialist,
        sortInventory,
    };
}
