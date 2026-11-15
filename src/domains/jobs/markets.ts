export interface JobMarketDefinition {
    readonly key: string;
    readonly label: string;
    readonly marketId: string;
    /** Server to route to before requesting market data. */
    readonly routeServerId: string;
    /** Server to return to before calling job.complete. Null when no route is needed. */
    readonly completionServerId: string | null;
}

const HOME_SERVER_ID = '019c0a5b-eeeb-7d3e-b9c9-fd5c2ba7d399';

/**
 * Market routing metadata used by Auto Job. These are market access points,
 * not a static network path table; paths are still computed from the live map.
 */
export const JOB_MARKETS: readonly JobMarketDefinition[] = [
    {
        key: 'home',
        label: 'CORE',
        marketId: '019d3ea4-85bd-7389-904d-8f7c85841134',
        routeServerId: HOME_SERVER_ID,
        completionServerId: null,
    },
    {
        key: 'dark',
        label: 'D4RK',
        marketId: '019d3ea4-85bd-7389-904d-908ba9194aa0',
        routeServerId: '019d29c5-4b37-79bf-b23e-304d8ea03c15',
        completionServerId: '019d29c5-4b37-79bf-b23e-304d8ea03c15',
    },
    {
        key: 'soyuz',
        label: 'SOYUZ',
        marketId: '019da731-2db5-7d76-9447-1ea3b9b78001',
        routeServerId: '019da6f1-16f7-75a6-b6d3-0b1d5f92a108',
        completionServerId: '019da6f1-16f7-75a6-b6d3-0b1d5f92a108',
    },
    {
        key: 'usol',
        label: 'USOL',
        marketId: '019e4065-6ae8-760d-8724-58ab4f2cf7d7',
        routeServerId: '019e4052-c317-7388-9d71-883ffb1560cd',
        completionServerId: '019e4052-c317-7388-9d71-883ffb1560cd',
    },
];

export function jobMarketByKey(key: string): JobMarketDefinition | undefined {
    return JOB_MARKETS.find((market) => market.key === key);
}
