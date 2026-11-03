// Auto-resolve mercenary expedition decisions (content-side, works even when the popup is closed).
import { pickBestOption } from '../shared/decision-policy.js';

const contentAutoChosenDecisions = new Set();

export function checkAutoChooseFromContent(decisions) {
    if (!decisions || decisions.length === 0) return;

    chrome.storage.sync.get(['autoSendMerc', 'aggressiveDecisions', 'decisionModifiers'], (result) => {
        const merc = result.autoSendMerc || {};
        const enabled = merc.autoResolveDecisions !== undefined
            ? !!merc.autoResolveDecisions
            : !!(result.decisionModifiers && result.decisionModifiers.autoChoose);
        if (!enabled) return;

        const aggressive = !!result.aggressiveDecisions;

        for (const d of decisions) {
            if (!d || d.isResolved || !Array.isArray(d.decisionOptions)) continue;
            if (contentAutoChosenDecisions.has(d.messageId)) continue;
            if (d.decisionDeadline && new Date(d.decisionDeadline).getTime() <= Date.now()) continue;

            const best = pickBestOption(d.decisionOptions, aggressive);
            if (!best) continue;

            contentAutoChosenDecisions.add(d.messageId);
            console.log('[COR3 Helper] Auto-resolve decision:', best.label, '(' + (aggressive ? 'aggressive' : 'normal') + ')');
            window.postMessage({
                type: 'COR3_RESPOND_DECISION',
                expeditionId: d.expeditionId,
                messageId: d.messageId,
                selectedOption: best.id
            }, '*');
        }
    });
}
