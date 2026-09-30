// Auto-Choose Decisions (content-side, works even when popup is closed)

const contentAutoChosenDecisions = new Set();

export function checkAutoChooseFromContent(decisions) {
    if (!decisions || decisions.length === 0) return;
    chrome.storage.sync.get('decisionModifiers', (result) => {
        const mods = result.decisionModifiers;
        if (!mods || !mods.autoChoose) return;
        const noWait = !!mods.noWaitAutoChoose;
        const baseLootMod = mods.enabled !== false ? (mods.loot ?? 3) : 1;
        const baseRiskMod = mods.enabled !== false ? (mods.risk ?? -2) : -1;
        const getRidOfVeterans = !!mods.getRidOfVeterans;

        // Load expedition data for veteran check
        chrome.storage.local.get('expeditionsData', (expResult) => {
            const expeditions = expResult.expeditionsData || [];

            for (const d of decisions) {
                if (d.isResolved || !d.decisionDeadline || !Array.isArray(d.decisionOptions)) continue;
                if (contentAutoChosenDecisions.has(d.messageId)) continue;
                const dl = new Date(d.decisionDeadline);
                const remaining = dl - Date.now();
                if (remaining <= 0) continue;
                if (!noWait && remaining > 60000) continue;

                // Check veteran override
                let lootMod = baseLootMod;
                let riskMod = baseRiskMod;
                if (getRidOfVeterans && d.expeditionId) {
                    const exp = expeditions.find(e => e.id === d.expeditionId);
                    if (exp && exp.mercenary && (exp.mercenary.rank || '').toUpperCase() === 'VETERAN') {
                        lootMod = 1;
                        riskMod = 10;
                    }
                }

                let bestOpt = null;
                let bestScore = -Infinity;
                for (const opt of d.decisionOptions) {
                    const score = Math.round((opt.lootModifier * lootMod) + ((opt.riskModifier * riskMod) * (((d.riskScore + Math.abs(opt.riskModifier)) / 10) || 1)));
                    if (score > bestScore) { bestScore = score; bestOpt = opt; }
                }
                if (bestOpt) {
                    contentAutoChosenDecisions.add(d.messageId);
                    console.log('[COR3 Helper] Auto-choose (content): picking "' + bestOpt.label + '" (score: ' + bestScore + ')');
                    window.postMessage({
                        type: 'COR3_RESPOND_DECISION',
                        expeditionId: d.expeditionId,
                        messageId: d.messageId,
                        selectedOption: bestOpt.id
                    }, '*');
                }
            }
        });
    });
}
