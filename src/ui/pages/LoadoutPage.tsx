import { useMemo, useState } from 'preact/hooks';
import type { LoadoutHardwareView, LoadoutSoftwareView, LoadoutView } from '../../application/loadout/view.js';
import { LOADOUT_RESOURCE_KEYS, softwareConsumptionRows } from '../../application/loadout/consumption.js';
import { Modal } from '../components/Modal.js';
import { useT, type TranslateSource } from '../i18n-context.js';

export type LoadoutFeedbackScope = 'recommend' | 'hardware' | 'software' | 'general';

export interface LoadoutFeedback {
    readonly scope: LoadoutFeedbackScope;
    readonly message: string;
    readonly tone?: 'ok' | 'error' | 'warn';
}

export interface LoadoutPageProps {
    readonly loadout: LoadoutView | null;
    readonly status: string;
    readonly feedback: LoadoutFeedback | null;
    readonly ability: 'HACK' | 'DECRYPT' | 'SEARCH';
    readonly onAbilityChange: (value: 'HACK' | 'DECRYPT' | 'SEARCH') => void;
    readonly target: string;
    readonly onTargetChange: (value: string) => void;
    readonly power: number;
    readonly onPowerChange: (value: number) => void;
    readonly busy: boolean;
    readonly panelOpen: Readonly<Record<string, boolean>>;
    readonly onPanelOpenChange: (key: string, open: boolean) => void;
    readonly onApply: () => void | Promise<void>;
    readonly onApplyWeakest: () => void | Promise<void>;
    readonly onCopyLoadout: (text: string) => void | Promise<void>;
    readonly onEquipHardware: (id: string) => void | Promise<void>;
    readonly onEquipSoftware: (id: string) => void | Promise<void>;
    readonly onUnequipSoftware: (id: string) => void | Promise<void>;
}

const SLOT_ORDER = ['cpu', 'gpu', 'ram', 'psu'] as const;
const SLOT_LABEL: Record<string, string> = { cpu: 'CPU', gpu: 'GPU', ram: 'RAM', psu: 'PSU' };
const HW_SPEC_DISPLAY: Record<string, readonly [string, string]> = {
    cpuFrequency: ['Frequency', 'GHz'],
    cpuCores: ['Cores count', 'count'],
    cpuConsuming: ['Power consuming', 'kW'],
    gpuPower: ['Power', 'PFLOPS'],
    gpuMemory: ['Memory', 'TB'],
    gpuConsuming: ['Power consuming', 'kW'],
    ramFrequency: ['Frequency', 'GHz'],
    ramMemory: ['Memory', 'TB'],
    psuPower: ['Power', 'kW'],
    psuProtection: ['Protection', '%'],
};
const RESOURCE_LABEL: Record<string, string> = {
    cpu_frequency: 'CPU Frequency',
    cpu_cores: 'CPU Cores',
    gpu_power: 'GPU Power',
    gpu_memory: 'GPU Memory',
    ram_frequency: 'RAM Frequency',
    ram_memory: 'RAM Memory',
    psu_power: 'PSU Power',
};
const RESOURCE_UNIT: Record<string, string> = {
    cpu_frequency: 'GHz',
    cpu_cores: 'count',
    gpu_power: 'PFLOPS',
    gpu_memory: 'TB',
    ram_frequency: 'GHz',
    ram_memory: 'TB',
    psu_power: 'kW',
};
const TOOL_LABEL: Record<string, string> = { HACK: 'Hack', DECRYPT: 'Decrypt', SEARCH: 'Search' };
const TOOL_ORDER: Record<string, number> = { HACK: 0, DECRYPT: 1, SEARCH: 2 };
const TOTAL_CELLS = 20;
const ABILITY_OPTIONS = ['HACK', 'DECRYPT', 'SEARCH'] as const;
type LoadoutAbility = typeof ABILITY_OPTIONS[number];

function targetOptionsFor(loadout: LoadoutView | null, ability: LoadoutAbility): string[] {
    if (!loadout) return [];
    const values = new Set<string>();
    for (const software of loadout.software) {
        for (const entry of software.abilities) {
            if (entry.type !== ability) continue;
            const targets = ability === 'DECRYPT' ? entry.fileTypes : entry.serverTypes;
            for (const value of targets ?? []) values.add(value);
        }
    }
    return [...values].sort((left, right) => left.localeCompare(right));
}

function toolGroup(item: LoadoutSoftwareView): number {
    let best = 99;
    for (const ability of item.abilities) {
        const order = TOOL_ORDER[ability.type];
        if (order !== undefined && order < best) best = order;
    }
    return best;
}

function formatted(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

const LOWER_IS_BETTER = new Set(['cpuConsuming', 'gpuConsuming']);

function specDelta(value: number, current: number | undefined, key: string): 'up' | 'down' | null {
    if (current === undefined || value === current) return null;
    const better = LOWER_IS_BETTER.has(key) ? value < current : value > current;
    return better ? 'up' : 'down';
}

function specRows(hardware: LoadoutHardwareView, compareTo: LoadoutHardwareView | undefined, tr: TranslateSource) {
    const rows = Object.entries(hardware.specs)
        .filter(([key]) => HW_SPEC_DISPLAY[key])
        .map(([key, value]) => ({ key, label: tr(HW_SPEC_DISPLAY[key]![0]), unit: HW_SPEC_DISPLAY[key]![1], value }));
    return (
        <>
            {rows.map((row) => {
                const delta = compareTo ? specDelta(row.value, compareTo.specs[row.key], row.key) : null;
                return (
                    <div key={row.key} class="v2-loadout-spec-row">
                        <span>{row.label}</span>
                        <span class={`v2-loadout-spec-val${delta ? ` ${delta}` : ''}`}>
                            {delta ? <span class={`v2-loadout-delta ${delta}`}>{delta === 'up' ? '↑' : '↓'}</span> : null}
                            {formatted(row.value)} {row.unit}
                        </span>
                    </div>
                );
            })}
            {hardware.itemVulnerability !== undefined ? (() => {
                const delta = compareTo && compareTo.itemVulnerability !== undefined
                    ? specDelta(hardware.itemVulnerability, compareTo.itemVulnerability, 'itemVulnerability')
                    : null;
                return (
                    <div class="v2-loadout-spec-row">
                        <span>{tr('Vulnerability')}</span>
                        <span class={`v2-loadout-spec-val${delta ? ` ${delta}` : ''}`}>
                            {delta ? <span class={`v2-loadout-delta ${delta}`}>{delta === 'up' ? '↑' : '↓'}</span> : null}
                            {formatted(hardware.itemVulnerability)} %
                        </span>
                    </div>
                );
            })() : null}
        </>
    );
}

function consumingRowsFor(item: LoadoutSoftwareView) {
    return softwareConsumptionRows(item);
}

function SoftwareDetails({ item }: { readonly item: LoadoutSoftwareView }) {
    const tr = useT();
    const consumingRows = consumingRowsFor(item);
    return (
        <>
            {item.abilities.map((ability) => (
                <section key={`detail-${item.id}-${ability.type}`} class="v2-loadout-info-tool">
                    <strong>{tr(TOOL_LABEL[ability.type] ?? ability.type).toUpperCase()} {tr('TOOL')}</strong>
                    <p class="v2-muted">
                        {tr('Power')} {ability.minPower}/{ability.maxPower}
                        {ability.computedPower !== undefined ? ` · ${tr('current')} ${formatted(ability.computedPower)}` : ''}
                    </p>
                    <p class="v2-muted">
                        {tr('Servers')}: {ability.serverTypes?.length ? ability.serverTypes.join(', ') : tr('Universal')}
                    </p>
                    <p class="v2-muted">
                        {tr('Formats')}: {ability.fileTypes?.length ? ability.fileTypes.join(', ') : tr('Universal')}
                    </p>
                </section>
            ))}
            <div class="v2-loadout-info-specs">
                <div class="v2-loadout-details-title">{tr('Basic Required')}</div>
                {consumingRows.length > 0 ? consumingRows.map((row) => (
                    <div key={row.key} class="v2-loadout-spec-row">
                        <span>
                            {tr(RESOURCE_LABEL[row.key] ?? row.key)}
                            <span class="v2-loadout-alloc">
                                {item.equipped && row.alloc !== null
                                    ? ` (${formatted(row.alloc)} ${row.unit})`
                                    : row.unit ? ` (${row.unit})` : ''}
                            </span>
                        </span>
                        <span class="v2-loadout-spec-val">{formatted(row.min)}/{formatted(row.max)}</span>
                    </div>
                )) : <p class="v2-muted">{tr('No consumption data')}</p>}
                {item.equipped && item.ratio !== undefined ? (
                    <div class="v2-loadout-spec-row v2-loadout-ratio">
                        <span>{tr('Performance Ratio')}</span>
                        <span class="v2-loadout-spec-val">{(item.ratio * 100).toFixed(1)}%</span>
                    </div>
                ) : null}
            </div>
        </>
    );
}

function SoftwareCard({
    item,
    busy,
    onInstall,
    onUninstall,
    onInfo,
}: {
    readonly item: LoadoutSoftwareView;
    readonly busy: boolean;
    readonly onInstall: () => void;
    readonly onUninstall: () => void;
    readonly onInfo: () => void;
}) {
    const tr = useT();
    const installed = item.equipped;
    return (
        <article class={`v2-loadout-sw-card${installed ? ' installed' : ''}`}>
            <div class="v2-loadout-sw-header">
                <div class="v2-loadout-sw-title">
                    <button
                        type="button"
                        class="v2-loadout-sw-image-button"
                        title={tr('View {name} details', { name: item.name })}
                        aria-label={tr('View {name} details', { name: item.name })}
                        onClick={onInfo}
                    >
                        {item.image
                            ? <img class="v2-loadout-sw-image" src={item.image} alt="" />
                            : <span class="v2-loadout-sw-image-placeholder">{item.name.slice(0, 1).toUpperCase()}</span>}
                        <span class="v2-loadout-sw-image-overlay">{tr('INFO')}</span>
                    </button>
                    <div>
                        <strong>{item.name}</strong>
                        <div class="v2-muted">
                            {[item.manufacturer, item.tier !== undefined ? tr('Tier {tier}', { tier: item.tier }) : null].filter(Boolean).join(' · ') || '\u00a0'}
                        </div>
                    </div>
                </div>
                <button
                    type="button"
                    class={`v2-loadout-install${installed ? ' uninstall' : ''}`}
                    disabled={busy}
                    onClick={installed ? onUninstall : onInstall}
                >
                    {busy ? '...' : installed ? tr('UNINSTALL') : tr('INSTALL')}
                </button>
            </div>

            <div class="v2-loadout-abilities">
                {item.abilities.map((ability) => (
                    <div key={`${item.id}-${ability.type}`} class="v2-loadout-ability-row">
                        <span class="v2-loadout-func-label">{tr('FUNC:')}</span>
                        <span>{tr(TOOL_LABEL[ability.type] ?? ability.type)} {ability.minPower}/{ability.maxPower}</span>
                        <span class="v2-loadout-ability-targets">
                            {tr('Servers')}: {ability.serverTypes?.length ? ability.serverTypes.join(', ') : tr('Universal')}
                            {' · '}
                            {tr('Formats')}: {ability.fileTypes?.length ? ability.fileTypes.join(', ') : tr('Universal')}
                        </span>
                    </div>
                ))}
            </div>
        </article>
    );
}

export function LoadoutPage({
    loadout,
    status,
    feedback,
    ability,
    onAbilityChange,
    target,
    onTargetChange,
    power,
    onPowerChange,
    busy,
    panelOpen,
    onPanelOpenChange,
    onApply,
    onApplyWeakest,
    onCopyLoadout,
    onEquipHardware,
    onEquipSoftware,
    onUnequipSoftware,
}: LoadoutPageProps) {
    const tr = useT();
    const [infoHardware, setInfoHardware] = useState<LoadoutHardwareView | null>(null);
    const [infoSoftware, setInfoSoftware] = useState<LoadoutSoftwareView | null>(null);
    const [replaceSlot, setReplaceSlot] = useState<string | null>(null);
    const [replaceSearch, setReplaceSearch] = useState('');
    const [softwareSearch, setSoftwareSearch] = useState('');
    const [softwareFilter, setSoftwareFilter] = useState('all');
    const [softwareBusyId, setSoftwareBusyId] = useState<string | null>(null);
    const [hardwareBusyId, setHardwareBusyId] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    const equipped = useMemo(() => {
        const result: Record<string, LoadoutHardwareView | undefined> = {};
        for (const hardware of loadout?.hardware ?? []) {
            if (hardware.equipped) result[hardware.slot] = hardware;
        }
        return result;
    }, [loadout]);

    const filteredSoftware = useMemo(() => {
        if (!loadout) return [];
        const needle = softwareSearch.trim().toLowerCase();
        return loadout.software.filter((item) => {
            const matchesType = softwareFilter === 'all' || item.abilities.some((entry) => entry.type.toLowerCase() === softwareFilter);
            if (!matchesType) return false;
            if (!needle) return true;
            return item.name.toLowerCase().includes(needle)
                || (item.manufacturer ?? '').toLowerCase().includes(needle);
        }).sort((left, right) =>
            Number(right.equipped) - Number(left.equipped)
            || toolGroup(left) - toolGroup(right)
            || left.name.localeCompare(right.name));
    }, [loadout, softwareFilter, softwareSearch]);

    const targetOptions = useMemo(() => {
        const options = targetOptionsFor(loadout, ability);
        return target && !options.includes(target) ? [target, ...options] : options;
    }, [loadout, ability, target]);

    const replaceOptions = useMemo(() => {
        if (!loadout || !replaceSlot) return [];
        const needle = replaceSearch.trim().toLowerCase();
        return loadout.hardware
            .filter((item) => item.slot === replaceSlot && !item.equipped)
            .filter((item) => !needle || item.name.toLowerCase().includes(needle))
            .sort((left, right) => left.name.localeCompare(right.name));
    }, [loadout, replaceSlot, replaceSearch]);

    const replaceCurrent = replaceSlot ? equipped[replaceSlot] : undefined;

    const copyLoadout = async () => {
        const lines = [
            `${tr('Requirement')}: ${ability} · ${target || tr('No target')} · ${tr('Power')} ${power}`,
            ...SLOT_ORDER.map((slot) => `${SLOT_LABEL[slot]}: ${equipped[slot]?.name ?? tr('None')}`),
        ];
        const software = loadout?.software.filter((item) => item.equipped).map((item) => item.name) ?? [];
        lines.push(`${tr('Software')}: ${software.length > 0 ? software.join(', ') : tr('None')}`);
        await onCopyLoadout(lines.join('\n'));
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    const changeAbility = (next: LoadoutAbility) => {
        onAbilityChange(next);
        const options = targetOptionsFor(loadout, next);
        onTargetChange(options[0] ?? '');
    };

    if (!loadout) {
        return (
            <section class="v2-card">
                <p class="v2-muted">{tr(status)}</p>
                <p class="v2-muted">{tr('Loadout data is not available yet.')}</p>
            </section>
        );
    }

    return (
        <section class="v2-card">
            <LoadoutFeedbackLine feedback={feedback} scope="general" />

            <details
                class="v2-loadout-section"
                open={panelOpen['loadout.recommended'] ?? true}
                onToggle={(event) => onPanelOpenChange('loadout.recommended', (event.currentTarget as HTMLDetailsElement).open)}
            >
                <summary class="v2-loadout-section-head">
                    {tr('Recommended Loadout')}
                </summary>
                <div class="v2-loadout-section-body">
                    <div class="v2-loadout-result-row">
                        <LoadoutFeedbackLine feedback={feedback} scope="recommend" placeholder={tr('No result yet — apply a loadout to see the outcome.')} />
                        <button
                            type="button"
                            class="v2-icon-button"
                            title={copied ? tr('Copied') : tr('Copy loadout')}
                            aria-label={copied ? tr('Copied') : tr('Copy loadout')}
                            onClick={() => void copyLoadout()}
                        >
                            {copied ? '✓' : '⧉'}
                        </button>
                    </div>
                    <div>
                        <div class="v2-loadout-row">
                            <select value={ability} onInput={(event) => changeAbility((event.currentTarget as HTMLSelectElement).value as LoadoutAbility)}>
                                {ABILITY_OPTIONS.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
                            </select>
                            <select value={target} onInput={(event) => onTargetChange((event.currentTarget as HTMLSelectElement).value)}>
                                {targetOptions.length === 0 ? (
                                    <option value="">{tr('No {type} available', { type: ability === 'DECRYPT' ? tr('file types') : tr('server types') })}</option>
                                ) : targetOptions.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
                            </select>
                            <input type="number" min={0} value={power} onInput={(event) => onPowerChange(Number((event.currentTarget as HTMLInputElement).value))} />
                        </div>
                        <div class="v2-actions">
                            <button type="button" disabled={busy || target.length === 0} onClick={() => void onApplyWeakest()}>{tr('Apply weakest (min power)')}</button>
                            <button type="button" disabled={busy || target.length === 0} onClick={() => void onApply()}>{tr('Apply optimized (keep current if sufficient)')}</button>
                        </div>
                    </div>
                </div>
            </details>

            <details
                class="v2-loadout-section"
                open={panelOpen['loadout.hardware'] ?? true}
                onToggle={(event) => onPanelOpenChange('loadout.hardware', (event.currentTarget as HTMLDetailsElement).open)}
            >
                <summary class="v2-loadout-section-head">
                    {tr('Hardwares')}
                    <span class="v2-muted">{tr('{count} owned', { count: loadout.ownedHardware })}</span>
                </summary>
                <div class="v2-loadout-section-body">
                    <LoadoutFeedbackLine feedback={feedback} scope="hardware" />
                    {SLOT_ORDER.map((slot) => {
                        const current = equipped[slot];
                        const replacements = loadout.hardware.filter((item) => item.slot === slot && !item.equipped);
                        return (
                            <div key={slot} class="v2-loadout-hw-card">
                                <div class="v2-loadout-hw-main">
                                    <span class="v2-loadout-hw-cat">{SLOT_LABEL[slot]}</span>
                                    <strong>{current?.name ?? tr('No hardware equipped')}</strong>
                                    {current ? <div class="v2-loadout-hw-specs">{specRows(current, undefined, tr)}</div> : null}
                                </div>
                                <div class="v2-loadout-hw-actions">
                                    <button
                                        type="button"
                                        disabled={replacements.length === 0}
                                        onClick={() => {
                                            setReplaceSearch('');
                                            setReplaceSlot(slot);
                                        }}
                                    >
                                        {tr('CHANGE')}
                                    </button>
                                    <button type="button" disabled={!current} onClick={() => current && setInfoHardware(current)}>{tr('INFO')}</button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </details>

            <details
                class="v2-loadout-section"
                open={panelOpen['loadout.software'] ?? true}
                onToggle={(event) => onPanelOpenChange('loadout.software', (event.currentTarget as HTMLDetailsElement).open)}
            >
                <summary class="v2-loadout-section-head">
                    {tr('Softwares')}
                    <span class="v2-muted">
                        {tr('{equipped} equipped / {owned} owned', { equipped: loadout.equippedSoftwareIds.length, owned: loadout.software.length })}
                    </span>
                </summary>
                <div class="v2-loadout-section-body">
                    <LoadoutFeedbackLine feedback={feedback} scope="software" />
                    <div class="v2-loadout-toolbar">
                        <select value={softwareFilter} onInput={(event) => setSoftwareFilter((event.currentTarget as HTMLSelectElement).value)}>
                            <option value="all">{tr('All')}</option>
                            <option value="hack">{tr('Hack')}</option>
                            <option value="decrypt">{tr('Decrypt')}</option>
                            <option value="search">{tr('Search')}</option>
                        </select>
                        <input
                            class="v2-loadout-search"
                            placeholder={tr('Search name or manufacturer...')}
                            value={softwareSearch}
                            onInput={(event) => setSoftwareSearch((event.currentTarget as HTMLInputElement).value)}
                        />
                    </div>
                    {filteredSoftware.length === 0 ? <p class="v2-muted">{tr('No programs found')}</p> : null}
                    {filteredSoftware.map((item) => (
                        <SoftwareCard
                            key={item.id}
                            item={item}
                            busy={softwareBusyId === item.id}
                            onInfo={() => setInfoSoftware(item)}
                            onInstall={() => {
                                setSoftwareBusyId(item.id);
                                void Promise.resolve(onEquipSoftware(item.id)).finally(() => setSoftwareBusyId(null));
                            }}
                            onUninstall={() => {
                                setSoftwareBusyId(item.id);
                                void Promise.resolve(onUnequipSoftware(item.id)).finally(() => setSoftwareBusyId(null));
                            }}
                        />
                    ))}
                </div>
            </details>

            <details
                class="v2-loadout-section"
                open={panelOpen['loadout.summary'] ?? true}
                onToggle={(event) => onPanelOpenChange('loadout.summary', (event.currentTarget as HTMLDetailsElement).open)}
            >
                <summary class="v2-loadout-section-head">
                    {tr('System Summary')}
                    <span class={`v2-muted ${loadout.analysis.canBoot ? 'v2-text-ok' : 'v2-text-error'}`}>
                        {loadout.analysis.canBoot ? tr('bootable') : tr('not bootable')}
                    </span>
                </summary>
                <div class="v2-loadout-section-body">
                    <div class="v2-loadout-res-stats">
                        <div class="v2-loadout-res-header">
                            <span>{tr('Type')}</span>
                            <span>{tr('Usage / Available')}</span>
                        </div>
                        {[...LOADOUT_RESOURCE_KEYS].map((key) => {
                            const available = loadout.analysis.supply[key] ?? 0;
                            const demand = loadout.analysis.demand[key === 'psu_power' ? 'psu_total' : key] ?? 0;
                            const ratio = available > 0 ? Math.min(demand / available, 1) : 0;
                            const tone = ratio > 0.95 ? 'red' : ratio > 0.75 ? 'yellow' : 'blue';
                            const filled = Math.round(ratio * TOTAL_CELLS);
                            return (
                                <div key={key} class="v2-loadout-res-row">
                                    <span class="v2-loadout-res-name">{tr(RESOURCE_LABEL[key] ?? key)}</span>
                                    <div class="v2-loadout-res-bar-wrap">
                                        <div class={`v2-loadout-res-edge ${tone}`} />
                                        <div class="v2-loadout-res-cells">
                                            {Array.from({ length: TOTAL_CELLS }, (_, index) => (
                                                <div key={index} class={`v2-loadout-res-cell ${index < filled ? 'filled' : 'empty'}-${tone}`} />
                                            ))}
                                        </div>
                                        <div class={`v2-loadout-res-edge ${tone}`} />
                                    </div>
                                    <span class="v2-loadout-res-val">
                                        <span class="v2-loadout-res-highlight">{formatted(demand)} / {formatted(available)}</span>
                                        {' '}{RESOURCE_UNIT[key] ?? ''}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </details>


            <Modal open={infoHardware !== null} title={infoHardware?.name ?? tr('Hardware')} onClose={() => setInfoHardware(null)}>
                {infoHardware ? (
                    <div class="v2-loadout-info-body">
                        {infoHardware.image ? <img class="v2-loadout-info-image" src={infoHardware.image} alt="" /> : null}
                        <p class="v2-muted">{infoHardware.description ?? tr('No description available.')}</p>
                        <div class="v2-loadout-info-specs">{specRows(infoHardware, undefined, tr)}</div>
                    </div>
                ) : null}
            </Modal>
            <Modal open={replaceSlot !== null} title={tr('Change {slot}', { slot: SLOT_LABEL[replaceSlot ?? ''] ?? tr('Hardware') })} onClose={() => setReplaceSlot(null)}>
                <div class="v2-loadout-replace-modal">
                    <input
                        class="v2-loadout-search"
                        placeholder={tr('Search...')}
                        value={replaceSearch}
                        onInput={(event) => setReplaceSearch((event.currentTarget as HTMLInputElement).value)}
                    />
                    {replaceOptions.length === 0 ? <p class="v2-muted">{tr('No replacements found')}</p> : null}
                    {replaceOptions.map((item) => (
                        <div key={item.id} class="v2-loadout-replace-item">
                            <div>
                                <strong>{item.name}</strong>
                                <div class="v2-loadout-replace-specs">{specRows(item, replaceCurrent, tr)}</div>
                            </div>
                            <div class="v2-loadout-hw-actions">
                                <button
                                    type="button"
                                    disabled={hardwareBusyId === item.id}
                                    onClick={() => {
                                        setHardwareBusyId(item.id);
                                        void Promise.resolve(onEquipHardware(item.id)).finally(() => {
                                            setHardwareBusyId(null);
                                            setReplaceSlot(null);
                                        });
                                    }}
                                >
                                    {hardwareBusyId === item.id ? '...' : tr('CHANGE')}
                                </button>
                                <button type="button" onClick={() => { setInfoHardware(item); setReplaceSlot(null); }}>{tr('INFO')}</button>
                            </div>
                        </div>
                    ))}
                </div>
            </Modal>
            <Modal open={infoSoftware !== null} title={infoSoftware?.name ?? tr('Software')} onClose={() => setInfoSoftware(null)}>
                {infoSoftware ? (
                    <div class="v2-loadout-info-body">
                        {infoSoftware.image ? <img class="v2-loadout-info-image" src={infoSoftware.image} alt="" /> : null}
                        <p class="v2-muted">{infoSoftware.description ?? tr('No description available.')}</p>
                        <SoftwareDetails item={infoSoftware} />
                    </div>
                ) : null}
            </Modal>
        </section>
    );
}

function LoadoutFeedbackLine({
    feedback,
    scope,
    placeholder,
}: {
    readonly feedback: LoadoutFeedback | null | undefined;
    readonly scope: LoadoutFeedbackScope;
    readonly placeholder?: string;
}) {
    const active = feedback && feedback.scope === scope ? feedback : null;
    const message = active?.message ?? placeholder;
    if (!message) return null;
    const tone = active?.tone === 'error'
        ? 'v2-text-error'
        : active?.tone === 'ok'
            ? 'v2-text-ok'
            : active?.tone === 'warn' ? 'v2-text-warn' : '';
    return <p class={`v2-muted v2-loadout-feedback ${tone}`}>{message}</p>;
}

export function LoadoutNotes() {
    const tr = useT();
    return (
        <ol class="v2-loadout-notes">
            <li>{tr('Software performance is limited by hardware except the PSU. When software cannot reach its full performance, check the System Summary to find the hardware component that is insufficient.')}</li>
            <li>{tr('Most software is only valid for specific targets (servers, file types, and so on). Check the software details before using it.')}</li>
            <li>{tr('Other hardware consumes PSU power. If hardware cannot be installed, consider increasing PSU power.')}</li>
        </ol>
    );
}
