/**
 * Serializes endpoint-changing operations. The game endpoint is a single
 * global resource; direct commands and multi-hop routes must not interleave.
 */
export interface EndpointMutexPort {
    run<T>(operation: () => Promise<T>): Promise<T>;
}

export class InMemoryEndpointMutex implements EndpointMutexPort {
    private chain: Promise<unknown> = Promise.resolve();

    run<T>(operation: () => Promise<T>): Promise<T> {
        const next = this.chain.then(operation, operation);
        this.chain = next.then(() => undefined, () => undefined);
        return next;
    }
}
