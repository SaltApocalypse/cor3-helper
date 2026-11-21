/**
 * Health-aware storage reads. A repository must distinguish a key that is
 * genuinely absent from data that exists but cannot be trusted.
 */
export type StorageReadResult<T> =
    | { readonly status: 'ok'; readonly value: T }
    | { readonly status: 'missing' }
    | { readonly status: 'corrupt'; readonly error?: string }
    | { readonly status: 'unavailable'; readonly error?: string };
