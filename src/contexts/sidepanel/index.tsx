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
const windowMode = new URLSearchParams(window.location.search).get('mode') === 'window';

render(<SidePanelApp portal={portal} windowMode={windowMode} />, root);
