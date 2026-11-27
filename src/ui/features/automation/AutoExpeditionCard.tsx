import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { AutoDroneStatus, AutoExpeditionStatus, ExpeditionDecisionView } from '../../../application/popup/portal.js';
import type { SettingsPatch, SettingsV1 } from '../../../contracts/storage.js';
import type { DroneState } from '../../../domains/drone/model.js';
import type { ExpeditionOverview } from '../../../domains/expeditions/model.js';
import { decisionScore } from '../../../domains/expeditions/model.js';
import { DRONE_EXPEDITION_PROFILE, MERC_EXPEDITION_PROFILES, buildDroneCardState, mercProfileKeyForMarket, partitionExpeditions } from '../../../application/expeditions/view.js';
import { AutomationCard } from '../../components/AutomationCard.js';
import { InfoTip } from '../../components/InfoTip.js';
import { MysteryEggBanner } from '../../components/MysteryEggBanner.js';
import { RefreshButton } from '../../components/RefreshButton.js';
import { formatRemaining } from '../../format.js';
import { useT, type TranslateSource } from '../../i18n-context.js';

export interface AutoExpeditionCardProps {
    readonly mercStatus: AutoExpeditionStatus | null;
    readonly droneStatus: AutoDroneStatus | null;
    readonly settings: SettingsV1 | null;
    readonly expeditions: ExpeditionOverview | null;
    readonly drone: DroneState | null;
    readonly mercBusy: boolean;
    readonly droneBusy: boolean;
    readonly expanded: boolean;
    readonly onOpenChange: (open: boolean) => void;
    readonly panelOpen: Readonly<Record<string, boolean>>;
    readonly updatePanelOpen: (key: string, open: boolean) => void;
    readonly onToggleMerc: () => Promise<string | null> | string | null;
    readonly onToggleDrone: () => Promise<string | null> | string | null;
    readonly onRunDrone: () => Promise<void>;
    readonly onCancelMercPreparation: () => Promise<void>;
    readonly onLoadMerc: () => Promise<void>;
    readonly onRespondDecision: (expeditionId: string, messageId: string, optionId: string) => Promise<string | null>;
    readonly onLoadDrone: () => Promise<void>;
    readonly onUpdateSettings: (patch: SettingsPatch) => Promise<{ readonly ok: boolean; readonly error?: string }>;
    readonly now: number;
}

type TabKey = 'merc' | 'drone';

const MERC_MARKET_LABEL: Record<string, string> = {
    core: 'CORE',
    usol: 'USOL',
    'usol-elite': 'USOL Elite',
};

const MERC_DECISION_OPTIONS = [
    { value: 'off', label: 'Off (let the system decide)' },
    { value: 'veterans', label: 'Get rid of veterans (highest risk)' },
    { value: 'loot', label: 'Highest loot first' },
    { value: 'risk', label: 'Lowest risk first' },
] as const;

/**
 * Drone events do not carry mercenary/veteran data, so "veterans first" can
 * only fall back to the highest-risk option. Keep it out of the drone dropdown
 * instead of offering a choice that has no drone-specific meaning.
 */
const DRONE_DECISION_OPTIONS = [
    { value: 'off', label: 'Off (let the system decide)' },
    { value: 'loot', label: 'Highest loot first' },
    { value: 'risk', label: 'Lowest risk first' },
] as const;

function formatMissionDuration(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds <= 0) return '--';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
    if (minutes > 0) return `${minutes}m`;
    return `${Math.round(seconds)}s`;
}

function dronePhaseLabel(phase: string, tr: TranslateSource): string {
    switch (phase) {
        case 'destroyed': return tr('Destroyed');
        case 'maintenance': return tr('Repairing…');
        case 'working': return tr('On mission');
        case 'charging': return tr('Charging');
        case 'ready': return tr('Idle');
        default: return tr('No drone');
    }
}

function expeditionMessage(message: string, tr: TranslateSource): string {
    const launched = message.match(/^Launched with (.+) \((.+)\)$/);
    if (launched) return tr('Launched with {name} ({market})', { name: launched[1] ?? '', market: launched[2] ?? '' });
    return tr(message);
}

function expeditionStatusLabel(status: string, tr: TranslateSource): string {
    const normalized = status.trim().toUpperCase().replace(/[\s-]+/g, '_');
    switch (normalized) {
        case 'RUNNING':
        case 'RUNNING_EVENT':
        case 'IN_PROGRESS':
            return tr('Running');
        case 'COMPLETED':
            return tr('Completed');
        case 'FULL_SUCCESS':
        case 'SUCCESS':
            return tr('Full success');
        case 'PARTIAL_SUCCESS':
            return tr('Partial success');
        case 'DEATH':
            return tr('Death');
        case 'FAILED':
        case 'FAILURE':
            return tr('Failed');
        case 'EXPIRED':
            return tr('Expired');
        case 'DECISION_PENDING':
            return tr('Decision pending');
        case 'IDLE':
            return tr('Idle');
        default:
            return status;
    }
}

function expeditionOutcomeTag(expedition: ExpeditionOverview['active'][number]): string {
    const value = (expedition.outcome ?? expedition.status).toUpperCase();
    if (value.includes('DEATH') || value.includes('FAIL')) return 'v2-tag-error';
    if (value.includes('PARTIAL')) return 'v2-tag-warn';
    return 'v2-tag-ok';
}

function decisionOptionScore(
    option: ExpeditionDecisionView['options'][number],
    decision: Pick<ExpeditionDecisionView, 'riskScore' | 'mode' | 'lootWeight' | 'riskWeight'>,
): number | null {
    if (decision.mode !== 'score') return null;
    return decisionScore(option, decision.riskScore, { loot: decision.lootWeight, risk: decision.riskWeight });
}

function StatBar({ label, value, max }: {
    readonly label: string;
    readonly value: number;
    readonly max: number;
}) {
    const safeMax = max > 0 ? max : 0;
    const percent = safeMax > 0 ? Math.max(0, Math.min(100, Math.round((value / safeMax) * 100))) : 0;
    const tone = percent > 60 ? 'ok' : percent > 30 ? 'warn' : 'error';
    return (
        <div class="v2-drone-bar">
            <span class="v2-drone-bar-label">{label}</span>
            <span class="v2-drone-bar-track">
                <span class={`v2-drone-bar-fill is-${tone}`} style={{ width: `${percent}%` }} />
            </span>
            <span class="v2-drone-bar-value">{value}/{max}</span>
        </div>
    );
}

function Switch({ checked, disabled, label, onClick }: {
    readonly checked: boolean;
    readonly disabled?: boolean | undefined;
    readonly label: string;
    readonly onClick: () => void;
}) {
    return (
        <button
            type="button"
            class="v2-switch"
            role="switch"
            aria-checked={checked}
            aria-label={label}
            title={label}
            disabled={disabled}
            onClick={onClick}
        >
            <span />
        </button>
    );
}

function Fold({ title, titleExtra, open, onToggle, children }: {
    readonly title: string;
    readonly titleExtra?: ComponentChildren;
    readonly open: boolean;
    readonly onToggle: () => void;
    readonly children: ComponentChildren;
}) {
    return (
        <div class="v2-loadout-section">
            <div class="v2-expedition-fold-head">
                <button type="button" class="v2-loadout-section-head" data-open={open ? 'true' : 'false'} aria-expanded={open} onClick={onToggle}>
                    <span class="v2-expedition-fold-title">{title}</span>
                </button>
                {titleExtra ?? null}
            </div>
            {open ? <div class="v2-loadout-section-body">{children}</div> : null}
        </div>
    );
}

export function AutoExpeditionCard({
    mercStatus,
    droneStatus,
    settings,
    expeditions,
    drone,
    mercBusy,
    droneBusy,
    expanded,
    onOpenChange,
    panelOpen,
    updatePanelOpen,
    onToggleMerc,
    onToggleDrone,
    onRunDrone,
    onCancelMercPreparation,
    onLoadMerc,
    onRespondDecision,
    onLoadDrone,
    onUpdateSettings,
    now,
}: AutoExpeditionCardProps) {
    const tr = useT();
    const [tab, setTab] = useState<TabKey>('merc');
    const [mercError, setMercError] = useState<string | null>(null);
    const [droneError, setDroneError] = useState<string | null>(null);

    const mercOptionsOpen = panelOpen['auto-expedition.merc.options'] ?? true;
    const mercSelectionOpen = panelOpen['auto-expedition.merc.selection'] ?? true;
    const mercDecisionOpen = panelOpen['auto-expedition.merc.decision'] ?? true;
    const mercHistoryOpen = panelOpen['auto-expedition.merc.history'] ?? false;
    const droneDecisionOpen = panelOpen['auto-expedition.drone.decision'] ?? true;
    const droneOptionsOpen = panelOpen['auto-expedition.drone.options'] ?? true;

    const updateSettings = async (patch: SettingsPatch, scope: 'merc' | 'drone' = tab): Promise<boolean> => {
        const result = await onUpdateSettings(patch);
        if (!result.ok) {
            const message = result.error ?? tr('Setting update failed');
            if (scope === 'drone') setDroneError(message);
            else setMercError(message);
            return false;
        }
        return true;
    };

    const mercGlobalMode = settings?.mercSelectionMode === 'global';
    const mercMaxPrice = settings?.mercMaxPrice ?? null;
    const mercMinCredits = settings?.mercMinCredits ?? 50000;
    const mercOrder = settings?.mercMarketOrder ?? ['core', 'usol', 'usol-elite'];
    const decisionMode = settings?.mercDecisionMode ?? 'simple';
    const decisionLoot = settings?.mercDecisionScoreLoot ?? 1;
    const decisionRisk = settings?.mercDecisionScoreRisk ?? -5;
    const droneDecisionMode = settings?.droneDecisionMode ?? 'simple';
    const droneDecisionLoot = settings?.droneDecisionScoreLoot ?? 3;
    const droneDecisionRisk = settings?.droneDecisionScoreRisk ?? -2;

    const moveMarket = (index: number, direction: -1 | 1) => {
        const next = [...mercOrder];
        const target = index + direction;
        if (target < 0 || target >= next.length) return;
        const value = next[index]!;
        next[index] = next[target]!;
        next[target] = value;
        void updateSettings({ mercMarketOrder: next });
    };

    const mercAvailable = mercStatus?.available ?? true;
    const droneAvailable = droneStatus?.available ?? true;
    const egg = mercStatus?.egg ?? null;
    const shownEgg = useRef<string | null>(null);

    useEffect(() => {
        if (!egg || shownEgg.current === egg.expeditionId) return;
        shownEgg.current = egg.expeditionId;
        if (!expanded) onOpenChange(true);
    }, [egg, expanded, onOpenChange]);

    const preparation = mercStatus?.preparation ?? null;
    const preparationSeconds = preparation ? Math.max(0, Math.ceil((preparation.until - now) / 1000)) : 0;
    const mercMarketKey = mercProfileKeyForMarket(
        mercStatus?.preparation?.marketKey
        ?? mercStatus?.last?.marketKey
        ?? settings?.mercMarketOrder?.[0]
        ?? 'core',
    );
    const mercProfile = MERC_EXPEDITION_PROFILES[mercMarketKey];
    const { active: activeExpeditions, completed: completedExpeditions, history: expeditionHistory } = partitionExpeditions(expeditions);
    const autoDecisionEnabled = decisionMode === 'score' || (settings?.mercDecisionPolicy ?? 'off') !== 'off';
    const overviewDecision = expeditions?.decisions[0] ?? null;
    const overviewDecisionDeadline = overviewDecision?.deadline ? Date.parse(overviewDecision.deadline) : Number.NaN;
    const overviewDecisionAutoAt = autoDecisionEnabled
        ? Math.max(now, Number.isFinite(overviewDecisionDeadline) ? Math.min(overviewDecisionDeadline - 30_000, now + 30_000) : now + 30_000)
        : null;
    const decisionView: ExpeditionDecisionView | null = mercStatus?.decision ?? (overviewDecision ? {
        id: overviewDecision.id,
        expeditionId: overviewDecision.expeditionId,
        message: overviewDecision.message,
        riskScore: overviewDecision.riskScore,
        lootScore: overviewDecision.lootScore,
        deadline: overviewDecision.deadline,
        firstSeenAt: now,
        autoRespondAt: overviewDecisionAutoAt,
        options: overviewDecision.options,
        mode: decisionMode,
        policy: settings?.mercDecisionPolicy ?? 'off',
        lootWeight: decisionLoot,
        riskWeight: decisionRisk,
        chosenOptionId: null,
        resolvedAt: null,
        resolvedBy: null,
    } : null);
    const decisionAutoSeconds = decisionView?.autoRespondAt != null
        ? Math.max(0, Math.ceil((decisionView.autoRespondAt - now) / 1000))
        : null;
    const droneView = buildDroneCardState(drone, now);
    const activeDroneMission = droneView.activeMission;
    const droneTargetMission = droneView.targetMission;
    const droneNextAvailableAt = droneView.nextAvailableAt;
    const dronePhase = droneView.phase;
    const dronePhaseClass = dronePhase === 'destroyed'
        ? 'v2-tag-error'
        : dronePhase === 'none'
            ? ''
            : dronePhase === 'maintenance' || dronePhase === 'charging' || dronePhase === 'working'
                ? 'v2-tag-warn'
                : 'v2-tag-ok';
    const droneCardClass = dronePhase === 'destroyed'
        ? ' is-error'
        : dronePhase === 'none'
            ? ''
            : dronePhase === 'maintenance' || dronePhase === 'charging' || dronePhase === 'working'
                ? ' is-warn'
                : ' is-ok';

    const setMercSwitch = async () => {
        setMercError(null);
        const error = await onToggleMerc();
        if (typeof error === 'string' && error) setMercError(error);
    };
    const setDroneSwitch = async () => {
        setDroneError(null);
        const error = await onToggleDrone();
        if (typeof error === 'string' && error) setDroneError(error);
    };

    return (
        <AutomationCard
            title={tr('Auto Expedition')}
            description={tr('Mercenary and drone expedition automation.')}
            alwaysAvailable
            expanded={expanded}
            onOpenChange={onOpenChange}
        >
            {egg ? <MysteryEggBanner /> : null}
            <div class="v2-expedition-tabs">
                <button type="button" class={tab === 'merc' ? 'active' : ''} onClick={() => setTab('merc')}>{tr('Mercenaries')}</button>
                <button type="button" class={tab === 'drone' ? 'active' : ''} onClick={() => setTab('drone')}>{tr('Drone')}</button>
            </div>

            {tab === 'merc' ? (
                <fieldset class="v2-expedition-fieldset" disabled={!mercAvailable}>
                    {!mercAvailable ? <p class="v2-muted v2-text-warn">{tr('Mercenary expeditions are not unlocked yet.')}</p> : null}
                    <section class="v2-expedition-active">
                        <div class="v2-expedition-active-head">
                            <strong>{tr('Active Expedition')}</strong>
                            <span class="v2-expedition-active-actions">
                                {mercStatus?.dataStale ? <span class="v2-tag v2-tag-warn">{tr('stale')}</span> : null}
                                <RefreshButton label={tr('Refresh active expedition')} disabled={mercBusy} onClick={onLoadMerc} />
                            </span>
                        </div>
                        <div class="v2-expedition-stage-list">
                            {preparation ? (
                                <article class="v2-stage-card is-warn">
                                    <div class="v2-stage-head">
                                        <span class="v2-stage-title">{tr('🚀 Preparing · {name}', { name: preparation.mercenaryName })}</span>
                                        <span class="v2-tag v2-tag-warn">{preparationSeconds}s</span>
                                    </div>
                                    <div class="v2-stage-stats">
                                        <span>{tr('Market')} <strong>{preparation.marketLabel}</strong></span>
                                        <span>{tr('Location')} <strong>{preparation.locationName}</strong></span>
                                        <span>{tr('Cost')} <strong>💰 {preparation.totalCost}</strong></span>
                                        <span>{tr('Risk')} <strong>⚠ {preparation.riskScore}</strong></span>
                                        <span>{tr('Insurance')} <strong>{preparation.insurance ? tr('on') : tr('off')}</strong></span>
                                        {preparation.insurance ? (
                                            <span>
                                                {tr('Insurance cost')}{' '}
                                                <strong>{preparation.insuranceCost != null ? `💰 ${preparation.insuranceCost}` : tr('Included in total')}</strong>
                                            </span>
                                        ) : null}
                                    </div>
                                    <div class="v2-stage-actions">
                                        <button type="button" class="v2-danger" onClick={() => void onCancelMercPreparation()}>{tr('Cancel')}</button>
                                    </div>
                                </article>
                            ) : null}
                            {activeExpeditions.map((expedition) => (
                                <article class="v2-stage-card is-warn" key={expedition.id}>
                                    <div class="v2-stage-head">
                                        <span class="v2-stage-title">{tr('📍 {location} — {name}', { location: expedition.locationName, name: expedition.mercenaryName ?? tr('Mercenary') })}</span>
                                        <span class="v2-tag v2-tag-warn">{expeditionStatusLabel(expedition.status, tr)}</span>
                                    </div>
                                    <div class="v2-stage-stats">
                                        {expedition.endsAt ? <span>{tr('ETA')} <strong>{formatRemaining(expedition.endsAt, now)}</strong></span> : null}
                                        {expedition.totalCost !== null ? <span>{tr('Cost')} <strong>💰 {expedition.totalCost}</strong></span> : null}
                                    </div>
                                    <div class="v2-stage-stats">
                                        <span>{tr('Loot')} <strong>{expedition.lootScore ?? decisionView?.lootScore ?? '--'}</strong></span>
                                        <span>{tr('Risk')} <strong>⚠ {expedition.riskScore ?? decisionView?.riskScore ?? '--'}</strong></span>
                                    </div>
                                </article>
                            ))}
                            {completedExpeditions.map((expedition) => (
                                <article class="v2-stage-card is-ok" key={`ready-${expedition.id}`}>
                                    <div class="v2-stage-head">
                                        <span class="v2-stage-title">{tr('✅ {location} — {name}', { location: expedition.locationName, name: expedition.mercenaryName ?? tr('Mercenary') })}</span>
                                        <span class="v2-tag v2-tag-ok">{expeditionStatusLabel(expedition.status, tr)}</span>
                                    </div>
                                    <div class="v2-stage-stats">
                                        {expedition.totalCost !== null ? <span>{tr('Cost')} <strong>💰 {expedition.totalCost}</strong></span> : null}
                                        <span>{tr('Rewards')} <strong>{tr('awaiting payment')}</strong></span>
                                    </div>
                                </article>
                            ))}
                            {decisionView ? (
                                <article class="v2-stage-card is-warn">
                                    <div class="v2-stage-head">
                                        <span class="v2-stage-title">{tr('Pending decision')}</span>
                                        <span class="v2-tag v2-tag-warn">
                                            {decisionView.resolvedAt !== null ? tr('Resolved') : tr('Decision')}
                                        </span>
                                    </div>
                                    <p class="v2-stage-note">{decisionView.message}</p>
                                    {decisionAutoSeconds !== null && decisionView.resolvedAt === null ? (
                                        <p class="v2-stage-note v2-text-warn">
                                            {tr('Auto decision in {seconds}s', { seconds: decisionAutoSeconds })}
                                        </p>
                                    ) : null}
                                    <div class="v2-decision-options">
                                        {decisionView.options.map((option) => {
                                            const score = decisionOptionScore(option, decisionView);
                                            const chosen = decisionView.chosenOptionId === option.id;
                                            return (
                                                <button
                                                    type="button"
                                                    key={option.id}
                                                    class={`v2-decision-option${chosen ? ' is-selected' : ''}`}
                                                    disabled={mercBusy || decisionView.resolvedAt !== null}
                                                    onClick={() => {
                                                        setMercError(null);
                                                        void onRespondDecision(decisionView.expeditionId, decisionView.id, option.id).then((error) => {
                                                            if (error) setMercError(error);
                                                        });
                                                    }}
                                                >
                                                    <span class="v2-decision-option-label">
                                                        {chosen ? '✓ ' : ''}{option.label}
                                                    </span>
                                                    <span class="v2-decision-option-stats">
                                                        <span>{tr('Loot: {value}', { value: `${option.lootModifier >= 0 ? '+' : ''}${option.lootModifier}` })}</span>
                                                        <span>{tr('Risk: {value}', { value: `${option.riskModifier >= 0 ? '+' : ''}${option.riskModifier}` })}</span>
                                                        {score !== null ? <strong>{tr('Score: {value}', { value: `${score >= 0 ? '+' : ''}${score}` })}</strong> : null}
                                                    </span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                    {decisionView.options.some((option) => option.requiredModuleId !== null) ? (
                                        <p class="v2-stage-note v2-muted">{tr('Options requiring a missing module cannot be auto-selected.')}</p>
                                    ) : null}
                                </article>
                            ) : null}
                            {!preparation && activeExpeditions.length === 0 && completedExpeditions.length === 0 && !decisionView ? (
                                <article class="v2-stage-card">
                                    <div class="v2-stage-head">
                                        <span class="v2-stage-title">{tr('Mercenary expedition')}</span>
                                        <span class="v2-tag v2-tag-ok">{tr('Idle')}</span>
                                    </div>
                                </article>
                            ) : null}
                        </div>
                        {mercStatus?.last ? (
                            <div class="v2-expedition-last-run">
                                <strong>{tr('Last run')}</strong>
                                <span>
                                    {mercStatus.last.launched ? tr('launched') : tr('not launched')}
                                    {mercStatus.last.selectedMerc ? ` · ${mercStatus.last.selectedMerc}` : ''}
                                    {mercStatus.last.paid ? ` · ${tr('paid {amount}', { amount: mercStatus.last.paid })}` : ''}
                                    {mercStatus.last.error ? ` · ${expeditionMessage(mercStatus.last.error, tr)}` : mercStatus.last.message ? ` · ${expeditionMessage(mercStatus.last.message, tr)}` : ''}
                                </span>
                            </div>
                        ) : null}
                    </section>

                    <Fold
                        title={tr('Auto expedition options')}
                        open={mercOptionsOpen}
                        onToggle={() => updatePanelOpen('auto-expedition.merc.options', !mercOptionsOpen)}
                    >
                        <div class="v2-expedition-setting-row">
                            <div>
                                <strong>{tr('Auto start mercenary expedition')}</strong>
                                <p class="v2-muted">{tr('Automatically select a mercenary, launch, and pay for completed expeditions.')}</p>
                            </div>
                            <Switch
                                checked={mercStatus?.enabled ?? settings?.autoExpeditionEnabled ?? false}
                                disabled={mercBusy || mercStatus?.running}
                                label={tr('Auto start mercenary expedition')}
                                onClick={() => void setMercSwitch()}
                            />
                        </div>
                        {mercError ? <p class="v2-muted v2-text-error">{mercError}</p> : null}

                        <Fold
                            title={tr('Mercenary selection rules')}
                            open={mercSelectionOpen}
                            onToggle={() => updatePanelOpen('auto-expedition.merc.selection', !mercSelectionOpen)}
                        >
                            <div class="v2-expedition-setting-row">
                                <div>
                                    <strong>{tr('Maximum mercenary price')}</strong>
                                    <p class="v2-muted">{tr('Do not hire mercenaries above this total cost (including insurance).')}</p>
                                </div>
                                <div class="v2-expedition-inline">
                                    <input
                                        type="number"
                                        min={0}
                                        placeholder="15000"
                                        value={mercMaxPrice ?? ''}
                                        onInput={(event) => {
                                            const value = (event.currentTarget as HTMLInputElement).value.trim();
                                            void updateSettings({ mercMaxPrice: value === '' ? null : Math.max(0, Math.floor(Number(value) || 0)) });
                                        }}
                                    />
                                    <Switch
                                        checked={settings?.mercMaxPriceEnabled ?? false}
                                        label={tr('Maximum mercenary price')}
                                        onClick={() => {
                                            if (!settings?.mercMaxPriceEnabled && mercMaxPrice === null) {
                                                setMercError(tr('Enter a maximum price before enabling the cap.'));
                                                return;
                                            }
                                            setMercError(null);
                                            void updateSettings({ mercMaxPriceEnabled: !settings?.mercMaxPriceEnabled });
                                        }}
                                    />
                                </div>
                            </div>

                            <label class="v2-field">
                                <span>{tr('Cheapest mercenary strategy')}</span>
                                <select
                                    value={settings?.mercSelectionMode ?? 'market'}
                                    onInput={(event) => void updateSettings({ mercSelectionMode: (event.currentTarget as HTMLSelectElement).value as 'market' | 'global' })}
                                >
                                    <option value="market">{tr('Lowest price within market order')}</option>
                                    <option value="global">{tr('Lowest price globally')}</option>
                                </select>
                            </label>

                            {!mercGlobalMode ? (
                            <div class="v2-expedition-order">
                                <div class="v2-expedition-order-head">
                                    <strong>{tr('Mercenary market order')}</strong>
                                    <InfoTip text={tr('In market order mode, the first market with an available mercenary wins. Global mode ignores this order.')} />
                                </div>
                                {mercOrder.map((key, index) => (
                                    <div class="v2-expedition-order-row" key={key}>
                                        <span>{MERC_MARKET_LABEL[key] ?? key}</span>
                                        <button
                                            type="button"
                                            disabled={index === 0}
                                            onClick={() => moveMarket(index, -1)}
                                        >
                                            ↑
                                        </button>
                                        <button
                                            type="button"
                                            disabled={index === mercOrder.length - 1}
                                            onClick={() => moveMarket(index, 1)}
                                        >
                                            ↓
                                        </button>
                                    </div>
                                ))}
                            </div>
                            ) : null}

                            <div class="v2-expedition-setting-row">
                                <div>
                                    <strong>{tr('Include insurance')}</strong>
                                    <p class="v2-muted">{tr('Adds the insurance cost when configuring and launching the expedition.')}</p>
                                </div>
                                <Switch
                                    checked={settings?.mercInsuranceEnabled ?? false}
                                    label={tr('Include insurance')}
                                    onClick={() => void updateSettings({ mercInsuranceEnabled: !settings?.mercInsuranceEnabled })}
                                />
                            </div>
                        </Fold>

                        <div class="v2-expedition-setting-row">
                            <div>
                                <strong>{tr('Stop below credits')}</strong>
                                <p class="v2-muted">{tr('Disable Auto Expedition when credits fall below this value.')}</p>
                            </div>
                            <div class="v2-expedition-inline">
                                <input
                                    type="number"
                                    min={0}
                                    max={350000}
                                    step={1000}
                                    value={mercMinCredits}
                                    onInput={(event) => {
                                        const value = Math.max(0, Math.min(350000, Math.floor(Number((event.currentTarget as HTMLInputElement).value) || 0)));
                                        void updateSettings({ mercMinCredits: value });
                                    }}
                                />
                                <Switch
                                    checked={settings?.mercMinCreditsEnabled ?? false}
                                    label={tr('Stop below credits')}
                                    onClick={() => void updateSettings({ mercMinCreditsEnabled: !settings?.mercMinCreditsEnabled })}
                                />
                            </div>
                        </div>
                    </Fold>

                    <div class="v2-expedition-plain-section">
                        <label class="v2-field">
                            <span>{tr('Expedition location ({market})', { market: mercProfile.marketLabel })}</span>
                            <select value={mercProfile.locationConfigId} disabled>
                                <option value={mercProfile.locationConfigId}>{mercProfile.locationName}</option>
                            </select>
                        </label>
                        <label class="v2-field">
                            <span>{tr('Expedition goal')}</span>
                            <select value={mercProfile.goalId} disabled>
                                <option value={mercProfile.goalId}>{mercProfile.goalName}</option>
                            </select>
                        </label>
                    </div>

                    <Fold
                        title={tr('In-mission decisions')}
                        titleExtra={<InfoTip text={tr('Simple: choose from preset policies. Score: compare options by loot and risk weights; the highest score wins and ties keep the first option.')} />}
                        open={mercDecisionOpen}
                        onToggle={() => updatePanelOpen('auto-expedition.merc.decision', !mercDecisionOpen)}
                    >
                        <label class="v2-field">
                            <span>{tr('Decision mode')}</span>
                            <select
                                value={decisionMode}
                                onInput={(event) => void updateSettings({ mercDecisionMode: (event.currentTarget as HTMLSelectElement).value as SettingsV1['mercDecisionMode'] })}
                            >
                                <option value="simple">{tr('Simple decision')}</option>
                                <option value="score">{tr('Score decision')}</option>
                            </select>
                        </label>
                        {decisionMode === 'simple' ? (
                            <label class="v2-field">
                                <span>{tr('Simple decision policy')}</span>
                                <select
                                    value={settings?.mercDecisionPolicy ?? 'off'}
                                    onInput={(event) => void updateSettings({ mercDecisionPolicy: (event.currentTarget as HTMLSelectElement).value as SettingsV1['mercDecisionPolicy'] })}
                                >
                                    {MERC_DECISION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{tr(option.label)}</option>)}
                                </select>
                            </label>
                        ) : (
                            <div class="v2-expedition-setting-block">
                                <div>
                                    <strong>{tr('Score weights')}</strong>
                                    <p class="v2-muted">{tr('Loot and risk weights used to score each decision option.')}</p>
                                </div>
                                <div class="v2-expedition-inline v2-decision-weights">
                                    <label class="v2-field">
                                        <span>{tr('Loot weight')}</span>
                                        <input
                                            class="v2-decision-weight-input"
                                            type="number"
                                            min={-100}
                                            max={100}
                                            step={1}
                                            value={decisionLoot}
                                            onInput={(event) => void updateSettings({ mercDecisionScoreLoot: Math.max(-100, Math.min(100, Math.floor(Number((event.currentTarget as HTMLInputElement).value) || 0))) })}
                                        />
                                    </label>
                                    <label class="v2-field">
                                        <span>{tr('Risk weight')}</span>
                                        <input
                                            class="v2-decision-weight-input"
                                            type="number"
                                            min={-100}
                                            max={100}
                                            step={1}
                                            value={decisionRisk}
                                            onInput={(event) => void updateSettings({ mercDecisionScoreRisk: Math.max(-100, Math.min(100, Math.floor(Number((event.currentTarget as HTMLInputElement).value) || 0))) })}
                                        />
                                    </label>
                                    <button
                                        type="button"
                                        class="v2-icon-button"
                                        aria-label={tr('Reset')}
                                        title={tr('Reset')}
                                        onClick={() => void updateSettings({ mercDecisionScoreLoot: 1, mercDecisionScoreRisk: -5 })}
                                    >
                                        ↺
                                    </button>
                                </div>
                            </div>
                        )}
                    </Fold>

                    <div class="v2-expedition-setting-row">
                        <div>
                            <strong>{tr('Auto pay and send rewards to mailbox')}</strong>
                        </div>
                        <Switch
                            checked={settings?.mercAutoPayEnabled ?? true}
                            label={tr('Auto pay and send rewards to mailbox')}
                            onClick={() => void updateSettings({ mercAutoPayEnabled: !(settings?.mercAutoPayEnabled ?? true) })}
                        />
                    </div>

                    <Fold
                        title={tr('History')}
                        open={mercHistoryOpen}
                        onToggle={() => updatePanelOpen('auto-expedition.merc.history', !mercHistoryOpen)}
                    >
                        {expeditionHistory.length === 0 ? (
                            <p class="v2-muted">{tr('No expedition history yet.')}</p>
                        ) : (
                            <div class="v2-expedition-stage-list">
                                {expeditionHistory.map((expedition) => (
                                    <article class="v2-stage-card" key={`history-${expedition.id}`}>
                                        <div class="v2-stage-head">
                                            <span class="v2-stage-title">
                                                {tr('📍 {location} — {name}', {
                                                    location: expedition.locationName,
                                                    name: expedition.mercenaryName ?? tr('Mercenary'),
                                                })}
                                            </span>
                                            <span class={`v2-tag ${expeditionOutcomeTag(expedition)}`}>
                                                {expeditionStatusLabel(expedition.outcome ?? expedition.status, tr)}
                                            </span>
                                        </div>
                                        <div class="v2-stage-stats">
                                            {expedition.totalCost !== null ? <span>{tr('Cost')} <strong>💰 {expedition.totalCost}</strong></span> : null}
                                            {expedition.riskScore !== null ? <span>{tr('Risk')} <strong>⚠ {expedition.riskScore}</strong></span> : null}
                                            {expedition.completedAt ? (
                                                <span>
                                                    {tr('Completed')}{' '}
                                                    <strong>{new Date(expedition.completedAt).toLocaleString()}</strong>
                                                </span>
                                            ) : null}
                                        </div>
                                    </article>
                                ))}
                            </div>
                        )}
                    </Fold>
                </fieldset>
            ) : (
                <fieldset class="v2-expedition-fieldset" disabled={!droneAvailable}>
                    {!droneAvailable ? <p class="v2-muted v2-text-warn">{tr('Drone expeditions are not unlocked yet.')}</p> : null}
                    <section class="v2-expedition-active">
                        <div class="v2-expedition-active-head">
                            <strong>{tr('Active Expedition')}</strong>
                            <span class="v2-expedition-active-actions">
                                {droneStatus?.dataStale ? <span class="v2-tag v2-tag-warn">{tr('stale')}</span> : null}
                                <RefreshButton label={tr('Refresh drone state')} disabled={droneBusy} onClick={onLoadDrone} />
                            </span>
                        </div>
                        <div class="v2-expedition-stage-list">
                            {!drone ? (
                                <article class="v2-stage-card">
                                    <div class="v2-stage-head">
                                        <span class="v2-stage-title">{tr('Drone')}</span>
                                        <span class="v2-tag v2-tag-warn">{tr('Unavailable')}</span>
                                    </div>
                                </article>
                            ) : (
                                <article class={`v2-stage-card${droneCardClass}`}>
                                    <div class="v2-stage-head">
                                        <span class="v2-stage-title">{tr('🛩️ {name}', { name: drone.drone?.name ?? tr('Drone') })}</span>
                                        <span class={`v2-tag ${dronePhaseClass}`}>{dronePhaseLabel(dronePhase, tr)}</span>
                                    </div>
                                    {drone.drone ? (
                                        <>
                                            <StatBar label={tr('Durability')} value={drone.drone.durability} max={drone.drone.maxDurability} />
                                            <StatBar label={tr('Battery')} value={drone.battery} max={drone.maxBattery} />
                                        </>
                                    ) : null}
                                    {dronePhase === 'maintenance' ? (
                                        <p class="v2-stage-note">
                                            {drone.drone?.repairSecondsRemaining !== null && drone.drone?.repairSecondsRemaining !== undefined
                                                ? tr('Repair ready in {time}', { time: formatRemaining(new Date(now + drone.drone.repairSecondsRemaining * 1000).toISOString(), now) })
                                                : tr('Waiting for repair')}
                                        </p>
                                    ) : null}
                                    {dronePhase === 'charging' ? (
                                        <p class="v2-stage-note">
                                            {droneNextAvailableAt !== null
                                                ? tr('Next sortie in {time}', { time: formatRemaining(new Date(droneNextAvailableAt).toISOString(), now) })
                                                : tr('Waiting for battery')}
                                            {droneTargetMission ? ` · ${droneTargetMission.name}` : ''}
                                        </p>
                                    ) : null}
                                    {activeDroneMission ? (
                                        <div class="v2-stage-stats">
                                            <span>{tr('Location')} <strong>{activeDroneMission.locationName}</strong></span>
                                            <span>{tr('Mission')} <strong>{activeDroneMission.name}</strong></span>
                                            <span>{tr('Risk')} <strong>{activeDroneMission.risk}</strong></span>
                                            <span>{tr('Battery')} <strong>{activeDroneMission.batteryCost}</strong></span>
                                            <span>{tr('Duration')} <strong>{formatMissionDuration(activeDroneMission.durationSeconds)}</strong></span>
                                        </div>
                                    ) : null}
                                    {!activeDroneMission && !droneTargetMission ? (
                                        <p class="v2-stage-note v2-text-warn">
                                            {tr('Configured mission is not available in the current game data.')}
                                        </p>
                                    ) : null}
                                </article>
                            )}
                        </div>
                        {droneStatus?.last ? (
                            <div class="v2-expedition-last-run">
                                <strong>{tr('Last run')}</strong>
                                <span>{tr(droneStatus.last.status)} · {tr(droneStatus.last.message)}</span>
                            </div>
                        ) : null}
                    </section>

                    <Fold
                        title={tr('Auto expedition options')}
                        open={droneOptionsOpen}
                        onToggle={() => updatePanelOpen('auto-expedition.drone.options', !droneOptionsOpen)}
                    >
                        <div class="v2-expedition-setting-row">
                            <div>
                                <strong>{tr('Auto start drone expedition')}</strong>
                                <p class="v2-muted">{tr('Repairs, resolves events, and launches the best available mission.')}</p>
                            </div>
                            <Switch
                                checked={droneStatus?.enabled ?? settings?.autoDroneEnabled ?? false}
                                disabled={droneBusy || droneStatus?.running}
                                label={tr('Auto start drone expedition')}
                                onClick={() => void setDroneSwitch()}
                            />
                        </div>
                        {droneError ? <p class="v2-muted v2-text-error">{droneError}</p> : null}

                        <div class="v2-expedition-setting-row">
                            <div>
                                <strong>{tr('Auto repair drone')}</strong>
                                <p class="v2-muted">{tr('Repair durability before launching when the configured conditions are met.')}</p>
                            </div>
                            <Switch
                                checked={settings?.droneRepairEnabled ?? false}
                                label={tr('Auto repair drone')}
                                onClick={() => void updateSettings({ droneRepairEnabled: !settings?.droneRepairEnabled })}
                            />
                        </div>

                        {(settings?.droneRepairEnabled ?? false) ? (
                            <div class="v2-expedition-subsettings">
                                <label class="v2-field">
                                    <span>{tr('Repair when durability is below')}</span>
                                    <input
                                        type="number"
                                        min={0}
                                        max={100}
                                        value={settings?.droneRepairThreshold ?? 60}
                                        onInput={(event) => {
                                            const value = Number((event.currentTarget as HTMLInputElement).value);
                                            if (!Number.isFinite(value) || value < 0 || value > 100) {
                                                setDroneError(tr('Durability threshold must be between 0 and 100.'));
                                                return;
                                            }
                                            setDroneError(null);
                                            void updateSettings({ droneRepairThreshold: Math.floor(value) });
                                        }}
                                    />
                                </label>
                                <div class="v2-expedition-setting-row">
                                    <div>
                                        <strong>{tr('Repair while charging')}</strong>
                                        <p class="v2-muted">{tr('Also repair when battery is below 30 while the drone is charging.')}</p>
                                    </div>
                                    <Switch
                                        checked={settings?.droneRepairOnCharge ?? false}
                                        label={tr('Repair while charging')}
                                        onClick={() => void updateSettings({ droneRepairOnCharge: !settings?.droneRepairOnCharge })}
                                    />
                                </div>
                            </div>
                        ) : null}
                    </Fold>

                    <div class="v2-expedition-plain-section">
                        <label class="v2-field">
                            <span>{tr('Drone mission location')}</span>
                            <select value={DRONE_EXPEDITION_PROFILE.locationConfigId} disabled>
                                <option value={DRONE_EXPEDITION_PROFILE.locationConfigId}>{DRONE_EXPEDITION_PROFILE.locationName}</option>
                            </select>
                        </label>
                        <label class="v2-field">
                            <span>{tr('Drone mission goal')}</span>
                            <select value={DRONE_EXPEDITION_PROFILE.missionConfigId} disabled>
                                <option value={DRONE_EXPEDITION_PROFILE.missionConfigId}>{DRONE_EXPEDITION_PROFILE.goalName}</option>
                            </select>
                        </label>
                    </div>

                    <Fold
                        title={tr('In-mission decisions')}
                        titleExtra={<InfoTip text={tr('Simple: choose from preset policies. Score: compare options by loot and risk weights; the highest score wins and ties keep the first option.')} />}
                        open={droneDecisionOpen}
                        onToggle={() => updatePanelOpen('auto-expedition.drone.decision', !droneDecisionOpen)}
                    >
                        <label class="v2-field">
                            <span>{tr('Decision mode')}</span>
                            <select
                                value={droneDecisionMode}
                                onInput={(event) => void updateSettings({ droneDecisionMode: (event.currentTarget as HTMLSelectElement).value as SettingsV1['droneDecisionMode'] })}
                            >
                                <option value="simple">{tr('Simple decision')}</option>
                                <option value="score">{tr('Score decision')}</option>
                            </select>
                        </label>
                        {droneDecisionMode === 'simple' ? (
                            <label class="v2-field">
                                <span>{tr('Simple decision policy')}</span>
                                <select
                                    value={settings?.droneDecisionPolicy === 'veterans' ? 'loot' : settings?.droneDecisionPolicy ?? 'off'}
                                    onInput={(event) => void updateSettings({ droneDecisionPolicy: (event.currentTarget as HTMLSelectElement).value as SettingsV1['droneDecisionPolicy'] })}
                                >
                                    {DRONE_DECISION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{tr(option.label)}</option>)}
                                </select>
                            </label>
                        ) : (
                            <div class="v2-expedition-setting-block">
                                <div>
                                    <strong>{tr('Score weights')}</strong>
                                    <p class="v2-muted">{tr('Loot and risk weights used to score each decision option.')}</p>
                                </div>
                                <div class="v2-expedition-inline v2-decision-weights">
                                    <label class="v2-field">
                                        <span>{tr('Loot weight')}</span>
                                        <input
                                            class="v2-decision-weight-input"
                                            type="number"
                                            min={-100}
                                            max={100}
                                            step={1}
                                            value={droneDecisionLoot}
                                            onInput={(event) => void updateSettings({ droneDecisionScoreLoot: Math.max(-100, Math.min(100, Math.floor(Number((event.currentTarget as HTMLInputElement).value) || 0))) })}
                                        />
                                    </label>
                                    <label class="v2-field">
                                        <span>{tr('Risk weight')}</span>
                                        <input
                                            class="v2-decision-weight-input"
                                            type="number"
                                            min={-100}
                                            max={100}
                                            step={1}
                                            value={droneDecisionRisk}
                                            onInput={(event) => void updateSettings({ droneDecisionScoreRisk: Math.max(-100, Math.min(100, Math.floor(Number((event.currentTarget as HTMLInputElement).value) || 0))) })}
                                        />
                                    </label>
                                    <button
                                        type="button"
                                        class="v2-icon-button"
                                        aria-label={tr('Reset')}
                                        title={tr('Reset')}
                                        onClick={() => void updateSettings({ droneDecisionScoreLoot: 3, droneDecisionScoreRisk: -2 })}
                                    >
                                        ↺
                                    </button>
                                </div>
                            </div>
                        )}
                    </Fold>

                    <div class="v2-expedition-setting-row">
                        <div>
                            <strong>{tr('Auto send rewards to mailbox')}</strong>
                        </div>
                        <Switch
                            checked={settings?.droneAutoSendEnabled ?? true}
                            label={tr('Auto send rewards to mailbox')}
                            onClick={() => void updateSettings({ droneAutoSendEnabled: !(settings?.droneAutoSendEnabled ?? true) })}
                        />
                    </div>

                    <div class="v2-actions">
                        <button type="button" disabled={droneBusy} onClick={() => void onRunDrone()}>{tr('Run once')}</button>
                    </div>
                </fieldset>
            )}
        </AutomationCard>
    );
}
