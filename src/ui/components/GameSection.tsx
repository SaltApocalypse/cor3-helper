import type { ComponentChildren } from 'preact';
import { PanelCard } from './PanelCard.js';

export interface GameSectionProps {
    readonly title: string;
    readonly description?: string;
    readonly defaultOpen?: boolean;
    readonly expanded?: boolean;
    readonly onOpenChange?: (open: boolean) => void;
    readonly className?: string;
    readonly actions?: ComponentChildren;
    /** Small control (for example an `InfoTip`) rendered next to the title. */
    readonly titleAccessory?: ComponentChildren;
    readonly children: ComponentChildren;
}

/**
 * Collapsible Game page section. The shared PanelCard owns the header, body and
 * collapse behavior; this wrapper keeps the existing GameSection API.
 */
export function GameSection({ title, description, defaultOpen = false, expanded, onOpenChange, className, actions, titleAccessory, children }: GameSectionProps) {
    return (
        <PanelCard
            title={title}
            description={description}
            defaultOpen={defaultOpen}
            expanded={expanded}
            onOpenChange={onOpenChange}
            className={`v2-automation-card v2-automation-available v2-game-section${className ? ` ${className}` : ''}`}
            headerClassName="v2-automation-header"
            bodyClassName="v2-automation-body v2-game-section-body"
            actions={actions}
            titleAccessory={titleAccessory}
        >
            {children}
        </PanelCard>
    );
}
