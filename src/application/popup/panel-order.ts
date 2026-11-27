/**
 * Order merging for draggable page panels.
 *
 * Saved order can be stale: new panels are added, panels become conditional
 * (market jobs, timers) or a page is renamed. Rendering must never depend on
 * saved ids that no longer exist, and new ids must still show up.
 */
export function mergePanelOrder(
    defaultIds: readonly string[],
    savedIds: readonly string[] | undefined,
    visibleIds: readonly string[],
): string[] {
    const visible = new Set(visibleIds);
    const seen = new Set<string>();
    const merged: string[] = [];

    const append = (id: string): void => {
        if (!visible.has(id) || seen.has(id)) return;
        seen.add(id);
        merged.push(id);
    };

    for (const id of savedIds ?? []) append(id);
    for (const id of defaultIds) append(id);
    // Defensive: keep any visible id that was not listed in the defaults.
    for (const id of visibleIds) append(id);

    return merged;
}

/** True when two orders contain the same ids in the same positions. */
export function isSamePanelOrder(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((id, index) => b[index] === id);
}
