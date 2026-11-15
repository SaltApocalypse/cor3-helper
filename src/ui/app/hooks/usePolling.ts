import { useEffect, useRef } from 'preact/hooks';

/**
 * Visibility-aware polling (H8 phase 7 / M10).
 *
 * Every side-panel polling loop runs through this hook so the timers pause
 * while the panel is hidden and refresh once when it becomes visible again.
 * Tasks are read from a ref: callers do not have to memoise them and a changed
 * closure never restarts the timer.
 */
export interface PollingOptions {
    /** Runs the loop only while true. */
    readonly enabled?: boolean;
    /** Skip work while the document is hidden (default true). */
    readonly pauseWhenHidden?: boolean;
    /** Run the task once when the loop is (re)enabled (default true). */
    readonly immediate?: boolean;
}

export interface PollingLoopOptions {
    readonly enabled?: boolean;
    readonly pauseWhenHidden?: boolean;
}

/** Delay {@link usePollingLoop} waits out while the panel is hidden. */
const HIDDEN_RECHECK_MS = 1000;

function pageHidden(): boolean {
    return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

export function usePolling(
    task: () => void | Promise<void>,
    intervalMs: number,
    options: PollingOptions = {},
): void {
    const { enabled = true, pauseWhenHidden = true, immediate = true } = options;
    const taskRef = useRef(task);
    taskRef.current = task;

    useEffect(() => {
        if (!enabled) return;
        const run = () => {
            if (pauseWhenHidden && pageHidden()) return;
            void taskRef.current();
        };
        if (immediate) run();
        const timer = setInterval(run, intervalMs);
        return () => clearInterval(timer);
    }, [enabled, immediate, intervalMs, pauseWhenHidden]);

    useEffect(() => {
        if (!enabled || !pauseWhenHidden || typeof document === 'undefined') return;
        const onVisibilityChange = () => {
            if (pageHidden()) return;
            void taskRef.current();
        };
        document.addEventListener('visibilitychange', onVisibilityChange);
        return () => document.removeEventListener('visibilitychange', onVisibilityChange);
    }, [enabled, pauseWhenHidden]);
}

/**
 * Self-scheduling loop for tasks whose next delay depends on the last result.
 * The task returns the delay before the next run, or `null` to stop.
 */
export function usePollingLoop(
    task: () => number | null | Promise<number | null>,
    options: PollingLoopOptions = {},
): void {
    const { enabled = true, pauseWhenHidden = true } = options;
    const taskRef = useRef(task);
    taskRef.current = task;

    useEffect(() => {
        if (!enabled) return;
        let disposed = false;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const schedule = (delayMs: number) => {
            timer = setTimeout(() => { void tick(); }, delayMs);
        };
        const tick = async (): Promise<void> => {
            if (disposed) return;
            if (pauseWhenHidden && pageHidden()) {
                schedule(HIDDEN_RECHECK_MS);
                return;
            }
            const delayMs = await taskRef.current();
            if (disposed || delayMs === null) return;
            schedule(delayMs);
        };
        const onVisibilityChange = () => {
            if (pageHidden()) return;
            if (timer !== null) clearTimeout(timer);
            void tick();
        };
        void tick();
        if (pauseWhenHidden && typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', onVisibilityChange);
        }
        return () => {
            disposed = true;
            if (timer !== null) clearTimeout(timer);
            if (pauseWhenHidden && typeof document !== 'undefined') {
                document.removeEventListener('visibilitychange', onVisibilityChange);
            }
        };
    }, [enabled, pauseWhenHidden]);
}
