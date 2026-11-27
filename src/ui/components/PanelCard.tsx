import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { useT } from '../i18n-context.js';
import { PanelDragHandle } from './PanelDragHandle.js';

export interface PanelHeaderProps {
    readonly title: string;
    readonly description?: string | undefined;
    readonly titleAccessory?: ComponentChildren | undefined;
    readonly badge?: ComponentChildren | undefined;
    readonly actions?: ComponentChildren | undefined;
    readonly controls?: ComponentChildren | undefined;
    /** Extra content rendered before the title, after the drag handle. */
    readonly leading?: ComponentChildren | undefined;
    readonly collapsible?: boolean | undefined;
    readonly collapsed?: boolean | undefined;
    readonly onToggle?: (() => void) | undefined;
    readonly collapseLabel?: string | undefined;
    readonly expandLabel?: string | undefined;
    readonly className?: string | undefined;
}

export interface PanelCardProps extends PanelHeaderProps {
    readonly className?: string | undefined;
    readonly headerClassName?: string | undefined;
    readonly bodyClassName?: string | undefined;
    readonly defaultOpen?: boolean | undefined;
    readonly expanded?: boolean | undefined;
    readonly onOpenChange?: ((open: boolean) => void) | undefined;
    /** Keep the body mounted even while the section is collapsed. */
    readonly bodyAlwaysRendered?: boolean | undefined;
    readonly children: ComponentChildren;
}

/**
 * Shared page-card header. Keeps the title, description, accessory controls and
 * collapse affordance in one place so every page uses the same layout.
 */
export function PanelHeader({
    title,
    description,
    titleAccessory,
    badge,
    actions,
    controls,
    leading,
    collapsible = true,
    collapsed = false,
    onToggle,
    collapseLabel,
    expandLabel,
    className,
}: PanelHeaderProps) {
    const tr = useT();
    return (
        <header class={`v2-panel-header${className ? ` ${className}` : ''}`}>
            <PanelDragHandle title={title} />
            {leading ? <span class="v2-panel-leading">{leading}</span> : null}
            <div class="v2-panel-heading">
                <h2 class="v2-panel-title">
                    <span class="v2-panel-title-text">{title}</span>
                    {titleAccessory ? <span class="v2-title-accessory">{titleAccessory}</span> : null}
                </h2>
                {description ? <p class="v2-muted v2-panel-description">{description}</p> : null}
            </div>
            {badge ? <span class="v2-panel-badge">{badge}</span> : null}
            {actions ? <span class="v2-panel-actions">{actions}</span> : null}
            {controls ? <span class="v2-panel-controls">{controls}</span> : null}
            {collapsible ? (
                <button
                    type="button"
                    class="v2-collapse-button v2-panel-collapse"
                    aria-expanded={!collapsed}
                    aria-label={
                        collapsed
                            ? (expandLabel ?? tr('Expand {name}', { name: title }))
                            : (collapseLabel ?? tr('Collapse {name}', { name: title }))
                    }
                    onClick={onToggle}
                >
                    <span>{collapsed ? '▼' : '▲'}</span>
                </button>
            ) : null}
        </header>
    );
}

/**
 * The common page-card shell: header + body. Page-specific cards (automation,
 * game sections, overview panels) compose this instead of re-implementing the
 * header, collapse state and future drag handle placement.
 */
export function PanelCard({
    title,
    description,
    titleAccessory,
    badge,
    actions,
    controls,
    leading,
    collapsible = true,
    onToggle,
    collapseLabel,
    expandLabel,
    className,
    headerClassName,
    bodyClassName,
    defaultOpen = false,
    expanded,
    onOpenChange,
    bodyAlwaysRendered = false,
    children,
}: PanelCardProps) {
    const [internalOpen, setInternalOpen] = useState(defaultOpen);
    const open = expanded ?? internalOpen;
    const setOpen = (next: boolean) => {
        if (expanded === undefined) setInternalOpen(next);
        onOpenChange?.(next);
    };
    const bodyVisible = !collapsible || bodyAlwaysRendered || open;

    return (
        <section class={`v2-card v2-panel-card${className ? ` ${className}` : ''}`}>
            <PanelHeader
                title={title}
                description={description}
                titleAccessory={titleAccessory}
                badge={badge}
                actions={actions}
                controls={controls}
                leading={leading}
                collapsible={collapsible}
                collapsed={!open}
                onToggle={onToggle ?? (() => setOpen(!open))}
                collapseLabel={collapseLabel}
                expandLabel={expandLabel}
                className={headerClassName}
            />
            {bodyVisible ? (
                <div class={`v2-panel-body${bodyClassName ? ` ${bodyClassName}` : ''}`}>{children}</div>
            ) : null}
        </section>
    );
}
