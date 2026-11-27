import type { ComponentChildren } from 'preact';
import { createContext } from 'preact';
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import Sortable from 'sortablejs';
import { isSamePanelOrder, mergePanelOrder } from '../../application/popup/panel-order.js';
import { useT } from '../i18n-context.js';

export interface SortablePanelItem {
    readonly id: string;
    readonly node: ComponentChildren;
}

export interface PanelSortController {
    /** Move the owning panel one position up (-1) or down (1). */
    readonly movePanel: (panelId: string, offset: -1 | 1, label?: string) => void;
}

const PanelSortContext = createContext<PanelSortController | null>(null);

/**
 * Returns the reorder controller when the card is a direct child of a
 * `SortablePanelGroup`, or `null` for nested/non-sortable cards. The drag
 * handle renders only when a controller is present.
 */
export function usePanelSortController(): PanelSortController | null {
    return useContext(PanelSortContext);
}

export interface SortablePanelGroupProps {
    readonly pageKey: string;
    readonly items: readonly SortablePanelItem[];
    /** Saved id order for this page; missing/unknown ids are merged safely. */
    readonly order?: readonly string[] | undefined;
    readonly onReorder: (ids: readonly string[]) => void;
    readonly className?: string | undefined;
}

function readOrder(container: HTMLElement): string[] {
    return Array.from(container.querySelectorAll<HTMLElement>(':scope > [data-panel-id]'))
        .map((node) => node.dataset.panelId ?? '')
        .filter((id) => id !== '');
}

/**
 * Vertical list of top-level page cards with SortableJS drag ordering.
 *
 * Only the grip handle starts a drag; the title keeps its normal
 * collapse/expand click. Order is persisted once per drop, never per move.
 */
export function SortablePanelGroup({ pageKey, items, order, onReorder, className }: SortablePanelGroupProps) {
    const tr = useT();
    const containerRef = useRef<HTMLDivElement | null>(null);
    const onReorderRef = useRef(onReorder);
    onReorderRef.current = onReorder;

    const defaultIds = useMemo(() => items.map((item) => item.id), [items]);
    const orderedIds = useMemo(() => mergePanelOrder(defaultIds, order, defaultIds), [defaultIds, order]);
    const orderedIdsRef = useRef(orderedIds);
    orderedIdsRef.current = orderedIds;

    const nodesById = useMemo(() => new Map(items.map((item) => [item.id, item.node])), [items]);

    const [announcement, setAnnouncement] = useState('');

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const instance = Sortable.create(container, {
            handle: '.v2-drag-handle',
            draggable: '[data-panel-id]',
            animation: 150,
            forceFallback: true,
            fallbackOnBody: true,
            fallbackTolerance: 3,
            ghostClass: 'v2-panel-ghost',
            chosenClass: 'v2-panel-chosen',
            dragClass: 'v2-panel-drag',
            onEnd: () => {
                const next = readOrder(container);
                if (next.length === 0 || isSamePanelOrder(next, orderedIdsRef.current)) return;
                onReorderRef.current(next);
            },
        });
        return () => instance.destroy();
    }, [pageKey]);

    const movePanel = useCallback(
        (panelId: string, offset: -1 | 1, label?: string) => {
            const current = orderedIdsRef.current;
            const from = current.indexOf(panelId);
            const to = from + offset;
            if (from < 0 || to < 0 || to >= current.length) return;
            const next = [...current];
            const [moved] = next.splice(from, 1);
            if (moved === undefined) return;
            next.splice(to, 0, moved);
            onReorderRef.current(next);
            setAnnouncement(tr('Moved {name} to position {position}', { name: label ?? panelId, position: to + 1 }));
        },
        [tr],
    );

    const controller = useMemo<PanelSortController>(() => ({ movePanel }), [movePanel]);

    return (
        <PanelSortContext.Provider value={controller}>
            <div
                ref={containerRef}
                class={`v2-sortable-panels${className ? ` ${className}` : ''}`}
                data-panel-group={pageKey}
            >
                {orderedIds.map((id) => (
                    <div key={id} class="v2-panel-slot" data-panel-id={id}>
                        {nodesById.get(id)}
                    </div>
                ))}
            </div>
            <p class="v2-sr-only" role="status" aria-live="polite">
                {announcement}
            </p>
        </PanelSortContext.Provider>
    );
}
