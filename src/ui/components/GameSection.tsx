import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { useT } from '../i18n-context.js';

export interface GameSectionProps {
    readonly title: string;
    readonly description?: string;
    readonly defaultOpen?: boolean;
    readonly expanded?: boolean;
    readonly onOpenChange?: (open: boolean) => void;
    readonly className?: string;
    readonly actions?: ComponentChildren;
    readonly children: ComponentChildren;
}

/**
 * Collapsible Game page section. It mirrors the Automation card header, but has
 * no enable/disable switch because these are plain game tools.
 */
export function GameSection({ title, description, defaultOpen = false, expanded, onOpenChange, className, actions, children }: GameSectionProps) {
    const tr = useT();
    const [internalOpen, setInternalOpen] = useState(defaultOpen);
    const open = expanded ?? internalOpen;
    const setOpen = (next: boolean) => {
        if (expanded === undefined) setInternalOpen(next);
        onOpenChange?.(next);
    };
    return (
        <section class={`v2-card v2-automation-card v2-automation-available v2-game-section${className ? ` ${className}` : ''}`}>
            <header class="v2-automation-header">
                <div class="v2-automation-heading">
                    <h2>{title}</h2>
                    {description ? <p class="v2-muted">{description}</p> : null}
                </div>
                {actions ? <span class="v2-game-section-actions">{actions}</span> : null}
                <button
                    type="button"
                    class="v2-collapse-button"
                    aria-expanded={open}
                    aria-label={open ? tr('Collapse {name}', { name: title }) : tr('Expand {name}', { name: title })}
                    onClick={() => setOpen(!open)}
                >
                    <span>{open ? '▲' : '▼'}</span>
                </button>
            </header>
            {open ? <div class="v2-automation-body v2-game-section-body">{children}</div> : null}
        </section>
    );
}
