import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useT } from '../i18n-context.js';

export interface AutomationCardProps {
    readonly title: string;
    readonly description?: string;
    readonly enabled?: boolean;
    readonly busy?: boolean;
    readonly persistentSwitch?: boolean;
    readonly alwaysAvailable?: boolean;
    readonly defaultOpen?: boolean;
    readonly expanded?: boolean;
    readonly onOpenChange?: (open: boolean) => void;
    readonly onEnable?: () => void | Promise<void>;
    readonly onDisable?: () => void | Promise<void>;
    readonly children: ComponentChildren;
}

export function AutomationCard({
    title,
    description,
    enabled = false,
    busy = false,
    persistentSwitch = false,
    alwaysAvailable = false,
    defaultOpen = false,
    expanded,
    onOpenChange,
    onEnable,
    onDisable,
    children,
}: AutomationCardProps) {
    const [internalOpen, setInternalOpen] = useState(defaultOpen);
    const [confirmingDisable, setConfirmingDisable] = useState(false);
    const tr = useT();
    const previousEnabled = useRef(enabled);
    const available = alwaysAvailable || enabled;
    const canCollapse = available;
    const open = expanded ?? internalOpen;

    const setOpen = (next: boolean) => {
        if (expanded === undefined) setInternalOpen(next);
        onOpenChange?.(next);
    };

    useEffect(() => {
        if (persistentSwitch && enabled && !previousEnabled.current) setOpen(true);
        previousEnabled.current = enabled;
    }, [enabled, persistentSwitch]);

    return (
        <section class={`v2-card v2-automation-card${available ? ' v2-automation-available' : ''}`}>
            <header class="v2-automation-header">
                <div class="v2-automation-heading">
                    <h2>{title}</h2>
                    {description ? <p class="v2-muted">{description}</p> : null}
                </div>
                {persistentSwitch && (onEnable || onDisable) ? (
                    <button
                        type="button"
                        class="v2-switch"
                        role="switch"
                        aria-checked={enabled}
                        aria-label={enabled ? tr('Disable {name}', { name: title }) : tr('Enable {name}', { name: title })}
                        title={enabled ? tr('Disable {name}', { name: title }) : tr('Enable {name}', { name: title })}
                        disabled={busy}
                        onClick={() => {
                            if (enabled) {
                                void onDisable?.();
                            } else {
                                setOpen(true);
                                void onEnable?.();
                            }
                        }}
                    >
                        <span />
                    </button>
                ) : null}
                {!persistentSwitch && !available && onEnable ? (
                    <button
                        type="button"
                        class="v2-switch"
                        role="switch"
                        aria-checked="false"
                        aria-label={tr('Enable {name}', { name: title })}
                        disabled={busy}
                        onClick={() => {
                            setOpen(true);
                            void onEnable();
                        }}
                    >
                        <span />
                    </button>
                ) : null}
                {available && canCollapse ? (
                    <button
                        type="button"
                        class="v2-collapse-button"
                        aria-expanded={open}
                        aria-label={open ? tr('Collapse {name}', { name: title }) : tr('Expand {name}', { name: title })}
                        onClick={() => {
                            setOpen(!open);
                            setConfirmingDisable(false);
                        }}
                    >
                        <span>{open ? '▲' : '▼'}</span>
                    </button>
                ) : null}
            </header>

            {available && open ? (
                <div class="v2-automation-body">
                    {children}
                    {onDisable && !persistentSwitch ? (
                        <div class="v2-automation-danger">
                            <button
                                type="button"
                                class={confirmingDisable ? 'v2-danger' : ''}
                                disabled={busy}
                                onClick={() => {
                                    if (!confirmingDisable) {
                                        setConfirmingDisable(true);
                                        return;
                                    }
                                    setConfirmingDisable(false);
                                    setOpen(false);
                                    void onDisable();
                                }}
                            >
                                {confirmingDisable ? tr('Confirm disable automation') : tr('Disable automation')}
                            </button>
                            {confirmingDisable ? <span class="v2-muted">{tr('Click again to confirm.')}</span> : null}
                        </div>
                    ) : null}
                </div>
            ) : null}
        </section>
    );
}
