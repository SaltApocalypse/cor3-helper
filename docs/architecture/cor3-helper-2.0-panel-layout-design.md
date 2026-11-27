# Panel card layout and drag-to-reorder (2.0 rewrite)

Status: implemented at `2.0.10-salta.325`.

## Goal

Every top-level panel card on Overview, Progress, Automation, Game, Settings and Developer
can be reordered by dragging a grip handle on the left of its title. The order is persisted
per page and survives reloads, settings import/export and conditional cards appearing or
disappearing.

## Shared card shell

`src/ui/components/PanelCard.tsx` provides `PanelCard` / `PanelHeader`:

- one header layout: drag handle, title, optional `titleAccessory` (for example `InfoTip`),
  description, `badge`, `actions`, `controls` (automation switch) and the collapse button;
- body rendering and collapse state are owned by `PanelCard`;
- `bodyAlwaysRendered` supports cards whose summary stays visible while collapsed
  (`ExtensionStatusCard`);
- `GameSection` and `AutomationCard` are thin wrappers that keep their public API, so pages
  did not need to change their card props.

Nested content (`InfoPanel`, `DebugConsole`, `JobMarketList`, maintenance sub-sections) is
not a page card and does not participate in reordering.

## Sorting

- Library: `sortablejs@1.15.7` (MIT), typed by `@types/sortablejs`. It is framework
  agnostic, so it fits the Preact 11 setup without `preact/compat`; dnd-kit was rejected
  because it is React-only.
- `SortablePanelGroup` (`src/ui/components/SortablePanelGroup.tsx`) receives
  `items: { id, node }[]`, the saved order and an `onReorder` callback.
- Each card is wrapped in a `[data-panel-id]` slot; only `.v2-drag-handle` starts a drag,
  so the title keeps its collapse/expand behavior.
- Order is read from the DOM and persisted once per drop, never per move.
- `forceFallback` is enabled for consistent behavior in the side panel and detached window.
- `PanelDragHandle` renders only when a `PanelSortContext` is present, which keeps nested
  cards from showing a useless handle.

## Persistence

- `panelOrderState: Record<pageKey, string[]>` in the settings schema (default `{}`).
- `useSettings` exposes `panelOrder`, `reorderPanels(pageKey, ids)` and
  `resetPanelOrder()`. Reordering updates the local settings immediately and persists in
  the background.
- `mergePanelOrder(defaultIds, savedIds, visibleIds)` keeps saved positions for visible
  cards, appends new cards in default order, ignores removed ids and tolerates conditional
  cards (Market jobs, Timers) being hidden when the page renders.
- Settings → Basic settings → Settings backup has a two-click "Reset panel order" action
  that only clears `panelOrderState`; the rest of the settings are untouched.

## Accessibility

- The grip is a focusable button with an accessible label and a keyboard tooltip.
- `ArrowUp` / `ArrowDown` on the focused grip moves the card and focuses the same control
  after re-render.
- `SortablePanelGroup` announces the new position through an `aria-live="polite"` status
  region.

## Verification

`npm run typecheck`, `npm run lint`, `npm test` (125 files / 1039 tests) and `npm run build`
pass at `2.0.10-salta.325`. New coverage: panel-order merge rules (`panel-order.test.ts`).
