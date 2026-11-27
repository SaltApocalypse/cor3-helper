import { createCoreRuntime, PHASE, VERSION } from './composition/core.js';
import { createGameRuntime } from './composition/game.js';
import { createAutomationRuntime } from './composition/automation.js';
import { registerSystemHandlers } from './handlers/system.js';
import { registerDevtoolsHandlers } from './handlers/devtools.js';
import { registerSettingsHandlers } from './handlers/settings.js';
import { registerAuthHandlers } from './handlers/auth.js';
import { registerNetworkHandlers } from './handlers/network.js';
import { registerMarketHandlers } from './handlers/market.js';
import { registerLoadoutHandlers } from './handlers/loadout.js';
import { registerJobHandlers } from './handlers/jobs.js';
import { registerAutoJobsHandlers } from './handlers/auto-jobs.js';
import { registerAutoFinishHandlers } from './handlers/auto-finish.js';
import { registerExpeditionHandlers } from './handlers/expeditions.js';
import { registerDroneHandlers } from './handlers/drone.js';
import { registerDailyHandlers } from './handlers/daily.js';
import { registerMailHandlers } from './handlers/mail.js';
import { registerInventoryHandlers } from './handlers/inventory.js';
import { registerSpecialistHandlers } from './handlers/specialists.js';
import { registerValuableHandlers } from './handlers/valuable.js';
import { registerAlarmRouter } from './alarms.js';
import { registerMessaging } from './messaging.js';
import { registerUpdateCheckLifecycle } from './update-check-lifecycle.js';
import { registerActionMenu } from './action-menu.js';
import { openStandaloneWindow } from '../../infrastructure/browser/standalone-window.js';
import { SETTINGS_STORAGE_KEY } from '../../infrastructure/storage/settings-repository.js';
import { startBackground } from './bootstrap.js';

const core = createCoreRuntime();
const game = createGameRuntime(core);
const automation = createAutomationRuntime(core, game);

registerSystemHandlers(core.server, { core, game, automation });
registerDevtoolsHandlers(core.server, { core });
registerSettingsHandlers(core.server, { core, automation });
registerAuthHandlers(core.server, { core });
registerNetworkHandlers(core.server, { core, game });
registerMarketHandlers(core.server, { core, automation });
registerLoadoutHandlers(core.server, { core, game });
registerJobHandlers(core.server, { core, game, automation });
registerAutoJobsHandlers(core.server, { core, automation });
registerAutoFinishHandlers(core.server, { core, automation });
registerExpeditionHandlers(core.server, { core, game, automation });
registerDroneHandlers(core.server, { core, game, automation });
registerDailyHandlers(core.server, { core, automation });
registerMailHandlers(core.server, { core, game, automation });
registerInventoryHandlers(core.server, { core, game, automation });
registerSpecialistHandlers(core.server, { core, game });
registerValuableHandlers(core.server, { core, automation });

registerAlarmRouter(automation, core.logger);
registerMessaging(core, automation);
registerUpdateCheckLifecycle({ runtime: chrome.runtime, service: core.updateCheck, logger: core.logger });
const actionMenu = registerActionMenu({
    menus: chrome.contextMenus,
    runtime: chrome.runtime,
    readLanguage: async () => (await core.settings.get()).uiLanguage,
    openWindow: openStandaloneWindow,
    logger: core.logger,
});
// The menu title follows the UI language, including imports and resets.
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && SETTINGS_STORAGE_KEY in changes) void actionMenu.refresh();
});

core.transport.start((request) => core.server.handle(request));

console.info('[cor3-helper 2.0] background composition root ready', { version: VERSION, phase: PHASE });

void startBackground(core, automation);
