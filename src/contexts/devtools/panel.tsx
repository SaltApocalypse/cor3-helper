import { render } from 'preact';
import { BridgeClient } from '../../infrastructure/bridge/bridge-client.js';
import { ChromeRuntimeBridgeTransport } from '../../infrastructure/bridge/chrome-runtime-transport.js';
import { ChromeDevToolsPortal } from '../../infrastructure/browser/chrome-devtools-portal.js';
import { DevToolsPanel } from '../../ui/devtools/DevToolsPanel.js';
import { LanguageProvider } from '../../ui/i18n-context.js';

const root = document.getElementById('app');
if (!root) throw new Error('Missing #app root');
const client = new BridgeClient(new ChromeRuntimeBridgeTransport('background'), 'devtools', 'background');
const portal = new ChromeDevToolsPortal(client);
void portal.language().then((language) => {
    render(<LanguageProvider language={language}><DevToolsPanel portal={portal} /></LanguageProvider>, root);
});
