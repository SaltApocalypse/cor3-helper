import { bridgeEnvelopeSchema, type BridgeEnvelope } from '../../contracts/bridge.js';
import type { ContextName } from '../../contracts/bridge.js';
import type { BridgeClientTransport } from './bridge-client.js';
import type { BridgeServerTransport } from './bridge-server.js';

/**
 * Page-world bridge transport using window.postMessage.
 * It is intentionally limited to the page/content contexts; extension contexts
 * use ChromeRuntimeBridgeTransport instead.
 */
export class WindowBridgeTransport implements BridgeClientTransport, BridgeServerTransport {
    constructor(
        private readonly target: ContextName,
        private readonly token?: string,
    ) {
        if (token) {
            // Content owns the capability token for this page instance. The
            // main-world listener accepts bridge envelopes only after hello.
            // A malicious same-origin script can observe this message, so this
            // raises the bar but does not replace a privileged execution world.
            window.postMessage({ type: 'V2_BRIDGE_HELLO', bridgeToken: token }, '*');
        }
    }

    send(request: BridgeEnvelope): Promise<unknown> {
        return new Promise((resolve, reject) => {
            const timer = window.setTimeout(() => {
                window.removeEventListener('message', listener);
                reject(new Error('Page bridge request timed out'));
            }, request.timeoutMs ?? 5000);

            const listener = (event: MessageEvent): void => {
                if (event.source !== window || event.origin !== window.location.origin) return;
                const parsed = bridgeEnvelopeSchema.safeParse(event.data);
                if (!parsed.success || parsed.data.replyTo !== request.id) return;
                if (this.token && parsed.data.bridgeToken !== this.token) return;
                window.clearTimeout(timer);
                window.removeEventListener('message', listener);
                resolve(event.data);
            };

            window.addEventListener('message', listener);
            window.postMessage(this.token ? { ...request, bridgeToken: this.token } : request, '*');
        });
    }

    start(handler: (request: unknown) => Promise<BridgeEnvelope | null>): () => void {
        let expectedToken: string | null = null;
        const listener = (event: MessageEvent): void => {
            if (event.source !== window || event.origin !== window.location.origin) return;
            const hello = event.data as { type?: unknown; bridgeToken?: unknown } | null;
            if (hello?.type === 'V2_BRIDGE_HELLO' && typeof hello.bridgeToken === 'string') {
                expectedToken = hello.bridgeToken;
                return;
            }
            const parsed = bridgeEnvelopeSchema.safeParse(event.data);
            if (!parsed.success || parsed.data.target !== this.target) return;
            if (expectedToken === null || parsed.data.bridgeToken !== expectedToken) return;
            void handler(event.data)
                .then((response) => {
                    if (response) window.postMessage({ ...response, bridgeToken: expectedToken }, '*');
                })
                .catch(() => {});
        };
        window.addEventListener('message', listener);
        return () => window.removeEventListener('message', listener);
    }
}
