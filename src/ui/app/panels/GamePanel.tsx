import type { PopupPortal } from '../../../application/popup/portal.js';
import { GameSection } from '../../components/GameSection.js';
import { InfoTip } from '../../components/InfoTip.js';
import { RefreshButton } from '../../components/RefreshButton.js';
import { SortablePanelGroup, type SortablePanelItem } from '../../components/SortablePanelGroup.js';
import { ToggleSwitch } from '../../components/ToggleSwitch.js';
import { useT } from '../../i18n-context.js';
import { InventoryPage } from '../../pages/InventoryPage.js';
import { LoadoutNotes, LoadoutPage } from '../../pages/LoadoutPage.js';
import type { InventoryState } from '../hooks/useInventory.js';
import type { LoadoutState } from '../hooks/useLoadout.js';
import type { MailState } from '../hooks/useMail.js';
import type { SettingsState } from '../hooks/useSettings.js';

export interface GamePanelProps {
    readonly portal: PopupPortal;
    readonly inventory: InventoryState;
    readonly loadout: LoadoutState;
    readonly mail: MailState;
    readonly settings: SettingsState;
    readonly now: number;
}

export function GamePanel({ portal, inventory, loadout, mail, settings, now }: GamePanelProps) {
    const tt = useT();
    const panels: SortablePanelItem[] = [
        {
            id: 'game.loadout',
            node: (
                <GameSection
                    title={tt('Loadout')}
                    description={tt('Equip hardware and software, inspect power, and apply recommended loadouts.')}
                    expanded={settings.panelOpen['game.loadout'] ?? true}
                    onOpenChange={(open) => settings.updatePanelOpen('game.loadout', open)}
                    titleAccessory={
                        <InfoTip title={tt('Loadout notes')}>
                            <LoadoutNotes />
                        </InfoTip>
                    }
                    actions={
                        <RefreshButton
                            label={tt('Refresh loadout')}
                            disabled={loadout.loadoutLoading}
                            onClick={loadout.loadLoadout}
                        />
                    }
                >
                    <LoadoutPage
                        loadout={loadout.loadout}
                        status={loadout.loadoutStatus}
                        feedback={loadout.loadoutFeedback}
                        ability={loadout.loadoutAbility}
                        onAbilityChange={loadout.setLoadoutAbility}
                        target={loadout.loadoutTarget}
                        onTargetChange={loadout.setLoadoutTarget}
                        power={loadout.loadoutPower}
                        onPowerChange={loadout.setLoadoutPower}
                        busy={loadout.loadoutBusy}
                        panelOpen={settings.panelOpen}
                        onPanelOpenChange={settings.updatePanelOpen}
                        onApply={() => loadout.applyLoadout('best')}
                        onApplyWeakest={() => loadout.applyLoadout('weakest')}
                        onCopyLoadout={async (text) => {
                            const copied = await portal.copyText(text);
                            loadout.setLoadoutFeedback({
                                scope: 'recommend',
                                message: copied ? tt('Loadout copied') : tt('Copy failed'),
                                tone: copied ? 'ok' : 'error',
                            });
                        }}
                        onEquipHardware={loadout.equipLoadoutHardware}
                        onEquipSoftware={loadout.equipLoadoutSoftware}
                        onUnequipSoftware={loadout.unequipLoadoutSoftware}
                    />
                </GameSection>
            ),
        },
        {
            id: 'game.inventory',
            node: (
                <GameSection
                    title={tt('Inventory')}
                    description={tt('Inspect warehouse contents, bulk sell, sort, and collect mail.')}
                    expanded={settings.panelOpen['game.inventory'] ?? false}
                    onOpenChange={(open) => settings.updatePanelOpen('game.inventory', open)}
                    actions={
                        <RefreshButton
                            label={tt('Refresh inventory')}
                            disabled={inventory.inventoryBusy || inventory.inventorySorting}
                            onClick={inventory.loadInventory}
                        />
                    }
                >
                    <InventoryPage
                        inventory={inventory.inventory}
                        inventoryStatus={inventory.inventoryStatus}
                        busy={inventory.inventoryBusy}
                        sorting={inventory.inventorySorting}
                        sortingTableItems={inventory.sortingTableItems}
                        onSort={inventory.sortInventory}
                        items={inventory.inventoryItems}
                        inventoryFilter={inventory.inventoryFilter}
                        onInventoryFilterChange={inventory.setInventoryFilter}
                        onSellItem={inventory.sellInventoryItem}
                        sellingItemId={inventory.sellingItemId}
                        sellTier={inventory.sellTier}
                        onSellTierChange={inventory.changeSellTier}
                        sellTag={inventory.sellTag}
                        onSellTagChange={inventory.changeSellTag}
                        sellPreview={inventory.sellPreview}
                        onSellFilter={inventory.sellInventoryFilter}
                        sellConfirm={inventory.sellConfirm}
                        autoMail={mail.autoMail}
                        autoMailBusy={mail.autoMailBusy}
                        onToggleAutoMail={mail.toggleAutoMail}
                        mailClaimBusy={mail.mailClaimBusy}
                        onClaimMailbox={mail.claimMailboxNow}
                        specialists={inventory.specialists}
                        specialistError={inventory.specialistError}
                        specialistBusy={inventory.specialistBusy}
                        now={now}
                        onPurchaseSpecialist={inventory.purchaseSpecialist}
                        onRefreshInventory={inventory.loadInventory}
                        helperMode={settings.helperMode}
                        panelOpen={settings.panelOpen}
                        onPanelOpenChange={settings.updatePanelOpen}
                    />
                </GameSection>
            ),
        },
        {
            id: 'game.assist',
            node: (
                <GameSection
                    title={tt('Assist tools')}
                    expanded={settings.panelOpen['game.assist'] ?? false}
                    onOpenChange={(open) => settings.updatePanelOpen('game.assist', open)}
                >
                    <div class="v2-settings-row">
                        <div class="v2-settings-copy">
                            <strong class="v2-sai-highlight-title">
                                {tt('SAI file highlight')}
                                <InfoTip title={tt('SAI highlight colors')}>
                                    <div class="v2-sai-color-legend">
                                        <p class="v2-muted">
                                            {tt('Colors follow the original userscript highlighter:')}
                                        </p>
                                        <ul>
                                            <li>
                                                <span class="v2-sai-swatch is-user" />
                                                {tt('User files')}
                                            </li>
                                            <li>
                                                <span class="v2-sai-swatch is-system" />
                                                {tt('System files')}
                                            </li>
                                            <li>
                                                <span class="v2-sai-swatch is-job" />
                                                {tt('Job files')}
                                            </li>
                                            <li>
                                                <span class="v2-sai-swatch is-valuable" />
                                                {tt('Marked valuable')}
                                            </li>
                                            <li>
                                                <span class="v2-sai-swatch is-priced" />
                                                {tt('Credit value or tags')}
                                            </li>
                                            <li>
                                                <span class="v2-sai-swatch is-other" />
                                                {tt('Other special sources')}
                                            </li>
                                        </ul>
                                        <p class="v2-muted">{tt('Normal generated files are not highlighted.')}</p>
                                        <p class="v2-muted">
                                            {tt('Value badges show credit value, detection rate and tags.')}
                                        </p>
                                    </div>
                                </InfoTip>
                            </strong>
                        </div>
                        <ToggleSwitch
                            checked={settings.settings?.saiFileHighlightEnabled ?? false}
                            disabled={!settings.settings}
                            label={tt('SAI file highlight')}
                            onChange={(enabled) => void settings.changeQol('saiFileHighlightEnabled', enabled)}
                        />
                    </div>
                </GameSection>
            ),
        },
    ];

    return (
        <SortablePanelGroup
            pageKey="game"
            items={panels}
            order={settings.panelOrder.game}
            onReorder={(ids) => settings.reorderPanels('game', ids)}
        />
    );
}
