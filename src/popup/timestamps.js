import { showLastUpdated } from './utils.js';
import { onLangChange } from './i18n.js';

const dailyLastUpdated = document.getElementById('dailyLastUpdated');
const coreMarketLastUpdated = document.getElementById('coreMarketLastUpdated');
const darkMarketLastUpdated = document.getElementById('darkMarketLastUpdated');
const soyuzMarketLastUpdated = document.getElementById('soyuzMarketLastUpdated');
const usolMarketLastUpdated = document.getElementById('usolMarketLastUpdated');
const expeditionLastUpdated = document.getElementById('expeditionLastUpdated');
const personalDroneLastUpdated = document.getElementById('personalDroneLastUpdated');
const inventoryLastUpdated = document.getElementById('inventoryLastUpdated');
const archivedExpLastUpdated = document.getElementById('archivedExpLastUpdated');
const loadoutLastUpdated = document.getElementById('loadoutLastUpdated');

export function refreshAllTimestamps() {
    showLastUpdated(dailyLastUpdated, 'dailyOpsUpdatedAt');
    showLastUpdated(coreMarketLastUpdated, 'marketDataUpdatedAt');
    showLastUpdated(darkMarketLastUpdated, 'darkMarketDataUpdatedAt');
    showLastUpdated(soyuzMarketLastUpdated, 'soyuzMarketDataUpdatedAt');
    showLastUpdated(usolMarketLastUpdated, 'usolMarketDataUpdatedAt');
    showLastUpdated(expeditionLastUpdated, 'expeditionsDataUpdatedAt');
    showLastUpdated(personalDroneLastUpdated, 'droneDataUpdatedAt');
    if (inventoryLastUpdated) showLastUpdated(inventoryLastUpdated, 'stashDataUpdatedAt');
    if (archivedExpLastUpdated) showLastUpdated(archivedExpLastUpdated, 'archivedExpeditionsUpdatedAt');
    if (loadoutLastUpdated) showLastUpdated(loadoutLastUpdated, 'loadoutUpdatedAt');
}

onLangChange(() => refreshAllTimestamps());
