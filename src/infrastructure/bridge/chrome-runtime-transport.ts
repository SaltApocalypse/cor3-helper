import { bridgeEnvelopeSchema, type BridgeEnvelope } from '../../contracts/bridge.js';
import type { ContextName } from '../../contracts/bridge.js';
import type { BridgeClientTransport } from './bridge-client.js';
import type { BridgeServerTransport } from './bridge-server.js';

/**
 * Chrome runtime adapter. The same class can be used by the popup client and
 * background server. It validates only routing information; handlers perform
 * their own payload validation.
 */
export class ChromeRuntimeBridgeTransport implements BridgeClientTransport, BridgeServerTransport {
    constructor(private readonly target: ContextName) {}

    send(request: BridgeEnvelope): Promise<unknown> {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(request, (response: unknown) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                resolve(response);
            });
        });
    }

    start(handler: (request: unknown) => Promise<BridgeEnvelope | null>): () => void {
        const listener = (message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void): boolean => {
            if (sender.id !== chrome.runtime.id) return false;
            const parsed = bridgeEnvelopeSchema.safeParse(message);
            if (!parsed.success || parsed.data.target !== this.target) return false;
            void handler(message)
                .then((response) => {
                    if (response) sendResponse(response);
                })
                .catch(() => {});
            return true;
        };
        chrome.runtime.onMessage.addListener(listener);
        return () => chrome.runtime.onMessage.removeListener(listener);
    }
}
