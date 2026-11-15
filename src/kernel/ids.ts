export type ServerId = string & { readonly __brand: 'ServerId' };
export type EdgeId = string & { readonly __brand: 'EdgeId' };

export function asServerId(value: string): ServerId {
    return value as ServerId;
}

export function asEdgeId(value: string): EdgeId {
    return value as EdgeId;
}
