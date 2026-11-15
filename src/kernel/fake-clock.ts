import type { TimerHandle } from './clock.js';

type ScheduledTask = {
    readonly id: number;
    readonly at: number;
    readonly fn: () => void;
};

/**
 * Deterministic clock for application/infrastructure tests.
 * It intentionally does not model wall-clock drift or event-loop ordering beyond
 * insertion order for equal timestamps.
 */
export class FakeClock {
    private current: number;
    private nextId = 1;
    private tasks: ScheduledTask[] = [];

    constructor(startAt = 0) {
        this.current = startAt;
    }

    now(): number {
        return this.current;
    }

    setTimeout(fn: () => void, ms: number): TimerHandle {
        const id = this.nextId++;
        this.tasks.push({ id, at: this.current + Math.max(0, ms), fn });
        return id as unknown as TimerHandle;
    }

    clearTimeout(handle: TimerHandle): void {
        const id = Number(handle);
        this.tasks = this.tasks.filter((task) => task.id !== id);
    }

    advance(ms: number): void {
        const target = this.current + Math.max(0, ms);
        while (true) {
            this.tasks.sort((a, b) => a.at - b.at || a.id - b.id);
            const next = this.tasks[0];
            if (!next || next.at > target) break;
            this.tasks.shift();
            this.current = next.at;
            next.fn();
        }
        this.current = target;
    }
}
