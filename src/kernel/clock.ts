export type TimerHandle = ReturnType<typeof setTimeout>;

export interface Clock {
    now(): number;
    setTimeout(fn: () => void, ms: number): TimerHandle;
    clearTimeout(handle: TimerHandle): void;
}

export class SystemClock implements Clock {
    now(): number {
        return Date.now();
    }

    setTimeout(fn: () => void, ms: number): TimerHandle {
        return setTimeout(fn, ms);
    }

    clearTimeout(handle: TimerHandle): void {
        clearTimeout(handle);
    }
}
