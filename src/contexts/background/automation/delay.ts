import { sleep } from '../../../kernel/sleep.js';
import type { Result } from '../../../kernel/result.js';

export function pause(ms: number): Promise<void> {
    return sleep(ms);
}

/** v1's humanDelay: keeps successive game commands out of the same rate-limit window. */
export function humanDelay(minMs = 450, maxMs = 900, random: () => number = Math.random): Promise<void> {
    return pause(minMs + Math.floor(random() * Math.max(1, maxMs - minMs + 1)));
}

const READ_RETRY_DELAYS_MS = [1_000, 3_000, 10_000];

export async function readWithRetry<T, E extends { readonly code: string; readonly message: string }>(
    operation: () => Promise<Result<T, E>>,
    attempts = 3,
): Promise<Result<T, E>> {
    let last: Result<T, E> | null = null;
    for (let attempt = 0; attempt < attempts; attempt++) {
        last = await operation();
        if (last.ok) return last;
        if (attempt < attempts - 1) await pause(READ_RETRY_DELAYS_MS[Math.min(attempt, READ_RETRY_DELAYS_MS.length - 1)] ?? 10_000);
    }
    return last ?? await operation();
}
