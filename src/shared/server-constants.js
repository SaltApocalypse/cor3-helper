export var HOME_SERVER_ID = '019c0a5b-eeeb-7d3e-b9c9-fd5c2ba7d399';

export var MARKET_IDS = {
    home: '019d3ea4-85bd-7389-904d-8f7c85841134',
    dark: '019d3ea4-85bd-7389-904d-908ba9194aa0',
    soyuz: '019da731-2db5-7d76-9447-1ea3b9b78001',
    usol: '019e4065-6ae8-760d-8724-58ab4f2cf7d7'
};

export var MARKET_SERVER_IDS = {
    dark: '019d29c5-4b37-79bf-b23e-304d8ea03c15',
    soyuz: '019da6f1-16f7-75a6-b6d3-0b1d5f92a108',
    usol: '019e4052-c317-7388-9d71-883ffb1560cd'
};

export var MARKET_DISPLAY_NAMES = { home: 'HOME', dark: 'D4RK', soyuz: 'SOYUZ', usol: 'USOL' };

export var MARKET_SERVER_NAMES = { dark: 'D4RK RM7CE', soyuz: 'SRM7-M', usol: 'URM7-M' };

export var MARKET_ID_TO_NAME = {
    '019d3ea4-85bd-7389-904d-8f7c85841134': 'HOME',
    '019d3ea4-85bd-7389-904d-908ba9194aa0': 'D4RK',
    '019da731-2db5-7d76-9447-1ea3b9b78001': 'SOYUZ',
    '019e4065-6ae8-760d-8724-58ab4f2cf7d7': 'USOL'
};

export var MARKET_SELL_ORDER = [
    { name: 'USOL', id: MARKET_IDS.usol, serverId: MARKET_SERVER_IDS.usol },
    { name: 'SOYUZ', id: MARKET_IDS.soyuz, serverId: MARKET_SERVER_IDS.soyuz },
    { name: 'D4RK', id: MARKET_IDS.dark, serverId: MARKET_SERVER_IDS.dark },
    { name: 'HOME', id: MARKET_IDS.home, serverId: null }
];

export var JOB_TYPE_PRIORITY = [
    'File Decryption',
    'Log Deletion',
    'File Elimination',
    'Log Download',
    'Data Download',
    'Decrypt & Extract',
    'IP Injection',
    'IP Cleanup',
    'Data Upload'
];

export var MARKET_RESET_DURATIONS_MS = {
    home: 6 * 60 * 60 * 1000,
    dark: 12 * 60 * 60 * 1000,
    soyuz: 10 * 60 * 60 * 1000,
    usol: 8 * 60 * 60 * 1000
};

export var LOG_JOB_TYPES = ['Log Deletion', 'Log Download'];

export function getMarketNameById(marketId) {
    return MARKET_ID_TO_NAME[marketId] || marketId;
}
