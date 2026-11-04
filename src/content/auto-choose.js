// Auto-resolve mercenary expedition decisions.
// Mercenary automation always uses the aggressive policy. The master
// autoSendMerc.enabled switch gates all mercenary automation, including this.
import { pickBestOption } from '../shared/decision-policy.js';

const contentAutoChosenDecisions = new Set();

export function checkAutoChooseFromContent(decisions) {
    if (!decisions || decisions.length === 0) return;

    chrome.storage.sync.get('autoSendMerc', (result) => {
        const merc = result.autoSendMerc || {};
        if (!merc.enabled) return;

        for (const d of decisions) {
            if (!d || d.isResolved || !Array.isArray(d.decisionOptions)) continue;
            if (contentAutoChosenDecisions.has(d.messageId)) continue;
            if (d.decisionDeadline && new Date(d.decisionDeadline).getTime() <= Date.now()) continue;

            const best = pickBestOption(d.decisionOptions, true);
            if (!best) continue;

            contentAutoChosenDecisions.add(d.messageId);
            console.log('[COR3 Helper] Auto-resolve decision:', best.label, '(aggressive)');
            window.postMessage({
                type: 'COR3_RESPOND_DECISION',
                expeditionId: d.expeditionId,
                messageId: d.messageId,
                selectedOption: best.id
            }, '*');
        }
    });
}
