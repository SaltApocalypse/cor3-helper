// Shared decision policy for mercenary expedition events and drone mission events.
//
// Aggressive: prefer higher loot first; on equal loot, prefer lower risk.
// Normal:     prefer lower risk first; on equal risk, prefer higher loot.
//
// Mercenary options expose lootModifier / riskModifier.
// Drone options expose effect.lootDelta / effect.riskDelta.
export function optionLoot(opt) {
    if (!opt) return 0;
    const v = opt.lootModifier !== undefined
        ? opt.lootModifier
        : (opt.effect ? opt.effect.lootDelta : 0);
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

export function optionRisk(opt) {
    if (!opt) return 0;
    const v = opt.riskModifier !== undefined
        ? opt.riskModifier
        : (opt.effect ? opt.effect.riskDelta : 0);
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

export function pickBestOption(options, aggressive) {
    if (!Array.isArray(options) || options.length === 0) return null;
    let best = null;
    let bestLoot = 0;
    let bestRisk = 0;

    for (const opt of options) {
        if (!opt) continue;
        const loot = optionLoot(opt);
        const risk = optionRisk(opt);

        if (!best) {
            best = opt;
            bestLoot = loot;
            bestRisk = risk;
            continue;
        }

        let better = false;
        if (aggressive) {
            if (loot !== bestLoot) better = loot > bestLoot;
            else if (risk !== bestRisk) better = risk < bestRisk;
        } else {
            if (risk !== bestRisk) better = risk < bestRisk;
            else if (loot !== bestLoot) better = loot > bestLoot;
        }

        if (better) {
            best = opt;
            bestLoot = loot;
            bestRisk = risk;
        }
    }
    return best;
}
