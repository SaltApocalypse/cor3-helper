import { render } from 'preact';
import { SidePanelApp } from '../../ui/app/SidePanelApp.js';
import { BridgeClient } from '../../infrastructure/bridge/bridge-client.js';
import { ChromeRuntimeBridgeTransport } from '../../infrastructure/bridge/chrome-runtime-transport.js';
import { ChromePopupPortal } from '../../infrastructure/browser/chrome-popup-portal.js';

const root = document.getElementById('app');
if (!root) throw new Error('Missing #app root');

const transport = new ChromeRuntimeBridgeTransport('background');
const client = new BridgeClient(transport, 'popup', 'background');
const portal = new ChromePopupPortal(client);
const mode = new URLSearchParams(window.location.search).get('mode');
const windowMode = mode === 'window';
const popupMode = mode === 'popup';

if (popupMode) document.body.classList.add('v2-popup-mode');

render(<SidePanelApp portal={portal} windowMode={windowMode} popupMode={popupMode} />, root);
