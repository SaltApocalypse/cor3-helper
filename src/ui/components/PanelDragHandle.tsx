import { useT } from '../i18n-context.js';
import { usePanelSortController } from './SortablePanelGroup.js';

export interface PanelDragHandleProps {
    /** Panel title, used for the accessible label and announcements. */
    readonly title: string;
}

/**
 * Grip handle shown in a panel header when the card belongs to a sortable
 * panel group. Dragging starts only here so the title stays clickable.
 */
export function PanelDragHandle({ title }: PanelDragHandleProps) {
    const controller = usePanelSortController();
    const tr = useT();
    if (!controller) return null;

    const onKeyDown = (event: KeyboardEvent) => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        const panelId = (event.currentTarget as HTMLElement).closest('[data-panel-id]')?.getAttribute('data-panel-id');
        if (!panelId) return;
        event.preventDefault();
        controller.movePanel(panelId, event.key === 'ArrowUp' ? -1 : 1, title);
    };

    return (
        <button
            type="button"
            class="v2-drag-handle"
            aria-label={tr('Reorder {name}', { name: title })}
            title={tr('Drag to reorder, or use the arrow keys')}
            onKeyDown={onKeyDown}
        >
            <svg
                viewBox="0 0 24 24"
                width="14"
                height="14"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
            >
                <circle cx="9" cy="12" r="1" />
                <circle cx="9" cy="5" r="1" />
                <circle cx="9" cy="19" r="1" />
                <circle cx="15" cy="12" r="1" />
                <circle cx="15" cy="5" r="1" />
                <circle cx="15" cy="19" r="1" />
            </svg>
        </button>
    );
}
