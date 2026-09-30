import { _h, _noData, _clearEl, _safeSetHtml } from './dom-helpers.js';
import { getCor3Tab } from './utils.js';
import { refreshAllTimestamps } from './timestamps.js';
import { state } from './state.js';

const inventoryContainer = document.getElementById('inventoryContainer');
const inventorySectionToggle = document.getElementById('inventorySectionToggle');
const inventorySectionBody = document.getElementById('inventorySectionBody');
const spaceInfo = document.getElementById('spaceInfo');
const refreshInventoryBtn = document.getElementById('refreshInventoryBtn');
const specialistTimerInfo = document.getElementById('specialistTimerInfo');

inventorySectionToggle.addEventListener('click', () => {
    inventorySectionToggle.classList.toggle('open');
    inventorySectionBody.classList.toggle('open');
});

refreshInventoryBtn.addEventListener('click', () => requestAndLoadInventory());

export async function requestAndLoadInventory() {
    inventoryContainer.replaceChildren(_noData('Requesting inventory from server...'));
    spaceInfo.textContent = '-- / --';
    try {
        const tab = await getCor3Tab();
        if (tab) {
            await chrome.tabs.sendMessage(tab.id, { action: "requestStash" });
            await chrome.tabs.sendMessage(tab.id, { action: "requestSpecialists" });
        }
    } catch (e) {}
    setTimeout(() => {
        loadInventory();
        loadSpecialistTimers();
        refreshAllTimestamps();
    }, 2500);
}

export async function loadInventory() {
    const { stashData } = await chrome.storage.local.get('stashData');
    renderInventory(stashData);
}

export async function loadSpecialistTimers() {
    try {
        const { specialistsData } = await chrome.storage.local.get('specialistsData');
        renderSpecialistTimers(specialistsData);
    } catch (e) {
        specialistTimerInfo.style.display = 'none';
    }
}

async function renderSpecialistTimers(data) {
    if (state._specialistTimerInterval) { clearInterval(state._specialistTimerInterval); state._specialistTimerInterval = null; }
    specialistTimerInfo.style.display = 'none';
    _clearEl(specialistTimerInfo);

    if (!data || !data.specialists || !Array.isArray(data.specialists)) return;

    let activeTemp = null;
    let activeSpecialist = null;
    for (const specialist of data.specialists) {
        if (!specialist.temporary || !Array.isArray(specialist.temporary)) continue;
        for (const temp of specialist.temporary) {
            if (temp.owned && temp.expiresAt) {
                activeTemp = temp;
                activeSpecialist = specialist;
                break;
            }
        }
        if (activeTemp) break;
    }

    if (!activeTemp || !activeTemp.expiresAt) return;

    const expiresAt = new Date(activeTemp.expiresAt).getTime();
    const gracePeriodEndAt = activeTemp.gracePeriodEndAt ? new Date(activeTemp.gracePeriodEndAt).getTime() : null;
    const bonusSlots = activeTemp.bonusSlots || '?';
    const isInGrace = activeTemp.status === 'IN_GRACE';

    let extendPriceId = null;
    let extendCredits = null;
    if (activeTemp.prices && activeTemp.prices.length > 0) {
        var creditsOnly = activeTemp.prices.find(function (p) { return !p.items || p.items.length === 0; });
        var priceEntry = creditsOnly || activeTemp.prices[0];
        extendPriceId = priceEntry.id;
        extendCredits = priceEntry.credits;
    }

    var itemsToLose = 0;
    if (isInGrace) {
        try {
            var result = await chrome.storage.local.get('stashData');
            var stash = result.stashData;
            if (stash) {
                var capacity = stash.maxCapacity || 0;
                var used = stash.currentUsage || (stash.items ? stash.items.length : 0);
                var overflow = used - capacity;
                if (overflow > 0) itemsToLose = overflow;
            }
        } catch (e) {}
    }

    function formatCountdown(ms) {
        if (ms <= 0) return 'EXPIRED';
        var d = Math.floor(ms / 86400000);
        var h = Math.floor((ms % 86400000) / 3600000);
        var m = Math.floor((ms % 3600000) / 60000);
        var s = Math.floor((ms % 60000) / 1000);
        var parts = [];
        if (d > 0) parts.push(d + 'd');
        parts.push(h + 'h');
        parts.push(m + 'm');
        parts.push(s + 's');
        return parts.join(' ');
    }

    function updateTimers() {
        var now = Date.now();
        var expiryRemaining = expiresAt - now;
        var graceRemaining = gracePeriodEndAt ? gracePeriodEndAt - now : null;
        var detailsEl = _h('div', {className: 'item-details'},
            _h('div', {className: 'item-name', style: 'margin-bottom: 6px;'}, 'Stash Expansion Service'),
            _h('div', {className: 'item-badges'}, _h('span', {className: 'rented-tag' + (isInGrace ? ' grace' : '')}, 'Rented: ' + bonusSlots))
        );

        if (isInGrace) {
            var graceBox = _h('div', {className: 'stash-grace-box'},
                _h('div', {className: 'stash-grace-header'}, 'THE RENT HAS ENDED'),
                _h('div', {className: 'stash-grace-body'},
                    _h('div', {className: 'stash-grace-row'}, _h('span', null, 'Items to lose'), _h('span', {className: 'grace-value'}, String(itemsToLose))),
                    _h('div', {className: 'stash-grace-row'}, _h('span', null, 'Expired slots'), _h('span', {className: 'grace-value'}, String(bonusSlots))),
                    _h('div', {className: 'stash-grace-row'}, _h('span', null, 'Left time'), _h('span', {className: 'grace-value'}, formatCountdown(graceRemaining || 0)))
                )
            );
            detailsEl.appendChild(graceBox);
            if (extendPriceId) {
                detailsEl.appendChild(_h('div', {style: 'display:flex;justify-content:flex-end;margin-top:4px;'},
                    _h('button', {className: 'stash-extend-btn', id: 'stashExtendBtn'}, 'Extend (\ud83d\udcb0' + (extendCredits || '?').toLocaleString() + ')')
                ));
            }
        } else {
            detailsEl.appendChild(_h('div', {className: 'specialist-timer-row'}, 'Expires in: ', _h('span', {className: 'specialist-timer'}, formatCountdown(expiryRemaining))));
            if (graceRemaining !== null) {
                detailsEl.appendChild(_h('div', {className: 'specialist-timer-row'}, 'Grace period ends: ', _h('span', {className: 'specialist-grace'}, formatCountdown(graceRemaining))));
            }
        }

        specialistTimerInfo.replaceChildren(_h('div', {className: 'item-card tier-quest'},
            _h('img', {src: 'https://cdn.cor3.gg/corie/characters/avatars/veran_avatar.png', alt: 'Specialist', loading: 'lazy'}),
            detailsEl
        ));
        specialistTimerInfo.style.display = '';

        var extBtn = document.getElementById('stashExtendBtn');
        if (extBtn && extendPriceId) {
            extBtn.addEventListener('click', function () {
                extBtn.disabled = true;
                extBtn.textContent = 'Extending...';
                getCor3Tab().then(function (tab) {
                    if (!tab) { extBtn.disabled = false; extBtn.textContent = 'Extend (💰' + (extendCredits || '?').toLocaleString() + ')'; return; }
                    chrome.tabs.sendMessage(tab.id, {
                        action: 'purchaseSpecialist',
                        specialistType: activeSpecialist.specialistType || 'ENGINEER',
                        kind: activeTemp.kind || 'TEMPORARY',
                        level: activeTemp.level,
                        priceId: extendPriceId
                    }).then(function () {
                        extBtn.textContent = 'Sent! Refreshing...';
                        setTimeout(function () {
                            chrome.tabs.sendMessage(tab.id, { action: 'requestSpecialists' });
                        }, 2000);
                        setTimeout(function () { loadSpecialistTimers(); }, 4000);
                    }).catch(function () {
                        extBtn.disabled = false;
                        extBtn.textContent = 'Extend (💰' + (extendCredits || '?').toLocaleString() + ')';
                    });
                });
            });
        }

        if (expiryRemaining <= 0 && (graceRemaining === null || graceRemaining <= 0)) {
            if (state._specialistTimerInterval) { clearInterval(state._specialistTimerInterval); state._specialistTimerInterval = null; }
        }
    }

    updateTimers();
    state._specialistTimerInterval = setInterval(updateTimers, 1000);
}

function renderInventory(data) {
    _clearEl(inventoryContainer);

    if (!data || !data.items || data.items.length === 0) {
        inventoryContainer.replaceChildren(_noData('No items found.', 'Make sure you have the cor3.gg tab open.'));
        spaceInfo.textContent = '-- / --';
        return;
    }

    const used = data.currentUsage || data.items.length;
    const max = data.maxCapacity || '?';
    spaceInfo.textContent = `${used} / ${max}`;

    let totalSellValue = 0;
    for (const item of data.items) {
        if (item.canSell && item.sellPrice) totalSellValue += item.sellPrice;
    }
    const totalValueEl = document.getElementById('totalValue');
    if (totalValueEl) totalValueEl.textContent = totalSellValue > 0 ? `(💰 ${totalSellValue.toLocaleString()})` : '';

    const RARITY_ORDER = { legendary: 0, quest: 1, epic: 2, rare: 3, common: 4 };
    const sortedItems = [...data.items].sort((a, b) => {
        const ra = RARITY_ORDER[(a.tier || 'common').toLowerCase()] ?? 5;
        const rb = RARITY_ORDER[(b.tier || 'common').toLowerCase()] ?? 5;
        if (ra !== rb) return ra - rb;
        const pa = (a.canSell && a.sellPrice) ? a.sellPrice : 0;
        const pb = (b.canSell && b.sellPrice) ? b.sellPrice : 0;
        return pb - pa;
    });

    var invItemMap = [];
    for (const item of sortedItems) {
        const card = document.createElement('div');
        const tierClass = 'tier-' + (item.tier || 'common').toLowerCase();
        card.className = 'item-card ' + tierClass;

        const tierTagClass = 'tier-tag tier-tag-' + (item.tier || 'common').toLowerCase();

        const badgesEl = _h('div', {className: 'item-badges'}, _h('span', {className: tierTagClass}, item.tier || 'COMMON'));
        if (item.canCraft) badgesEl.appendChild(_h('span', {className: 'badge badge-craft'}, 'CRAFT'));
        if (item.canUse) badgesEl.appendChild(_h('span', {className: 'badge badge-use'}, 'USE'));

        const invIdx = invItemMap.length;
        invItemMap.push(item);

        const infoBtn = _h('button', {className: 'market-item-info-btn inv-info-btn', dataset: {invIdx: String(invIdx)}, style: 'width: 10%;padding-left: 4px;'});
        _safeSetHtml(infoBtn, '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><g clip-path="url(#mi2)"><path d="M3.759 1.2H12.243c.703 0 1.3.246 1.81.75.502.503.748 1.095.748 1.797v8.495c0 .71-.246 1.305-.748 1.807-.51.505-1.107.751-1.81.751H3.76c-.71 0-1.306-.246-1.809-.749-.502-.502-.749-1.097-.749-1.808V3.747c0-.703.246-1.295.75-1.798.502-.503 1.098-.75 1.808-.75z" stroke="currentColor" stroke-width="0.8"></path><path d="M6.994 3.837h2.002v1.992H6.994V3.837zM6.994 7.124h2.002v5.049H6.994V7.124z" fill="currentColor"></path></g><defs><clipPath id="mi2"><rect width="16" height="16" fill="currentColor"></rect></clipPath></defs></svg>');

        const detailsEl = _h('div', {className: 'item-details'},
            _h('div', {style: 'display: flex; justify-content: space-between; align-items: center;'},
                _h('div', {className: 'item-name'}, item.name),
                infoBtn
            ),
            badgesEl
        );
        if (item.canSell && item.sellPrice) {
            detailsEl.appendChild(_h('div', {className: 'item-action-row'},
                _h('div', {className: 'item-price'}, '\ud83d\udcb0 ' + item.sellPrice.toLocaleString()),
                _h('button', {className: 'sell-btn', dataset: {itemId: item.id, itemName: item.name}, title: 'Sell 1x ' + item.name}, '\ud83d\udcb0 Sell')
            ));
        }

        if (item.imageUrl) card.appendChild(_h('img', {src: item.imageUrl, alt: item.name, loading: 'lazy'}));
        card.appendChild(detailsEl);
        inventoryContainer.appendChild(card);
    }

    inventoryContainer.querySelectorAll('.sell-btn').forEach(btn => {
        let confirmTimeout = null;
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const itemId = btn.dataset.itemId;
            if (!btn.classList.contains('sell-confirm')) {
                btn.classList.add('sell-confirm');
                btn.textContent = '✓ Confirm';
                confirmTimeout = setTimeout(() => { btn.classList.remove('sell-confirm'); btn.textContent = '💰 Sell'; }, 3000);
                return;
            }
            if (confirmTimeout) clearTimeout(confirmTimeout);
            btn.classList.remove('sell-confirm');
            btn.disabled = true;
            btn.textContent = '⏳';
            try {
                const tab = await getCor3Tab();
                if (tab) await chrome.tabs.sendMessage(tab.id, { action: 'sellItem', itemId, quantity: 1 });
            } catch (err) {
                cor3LogError('popup.js', err, { action: 'sellItem' });
            }
        });
    });

    inventoryContainer.querySelectorAll('.inv-info-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = parseInt(btn.dataset.invIdx, 10);
            if (!isNaN(idx) && invItemMap[idx]) showInventoryInfoPopup(invItemMap[idx]);
        });
    });
}

function showInventoryInfoPopup(item) {
    const popup = document.getElementById('inventoryInfoPopup');
    const overlay = document.getElementById('inventoryInfoOverlay');
    if (!popup || !overlay) return;

    const INFO_SVG = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="color:currentColor"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.5"/><path d="M12 17V12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="12" cy="8" r="0.75" fill="currentColor"/></svg>';

    let h = '<div class="info-title">' + INFO_SVG + ' ' + (item.name || 'Unknown').toUpperCase() + '</div>';
    h += '<div class="info-desc">';
    if (item.imageUrl) h += '<img src="' + item.imageUrl + '" alt="">';
    h += '<span>' + (item.description || 'No description available.') + '</span>';
    h += '</div>';

    const tags = item.tags || [];
    if (tags.length > 0) {
        h += '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:8px;border-top:1px solid rgba(96,108,124,0.5);padding-top:8px;">';
        for (const tag of tags) {
            h += '<span style="font-size:9px;padding:2px 8px;border-radius:10px;background:rgba(118,193,209,0.15);color:rgba(118,193,209,1);border:1px solid rgba(118,193,209,0.3);">' + tag + '</span>';
        }
        h += '</div>';
    }

    h += '<div class="info-specs">';
    if (item.tier) h += '<div class="info-spec-item"><div class="info-spec-label">Rarity</div><div class="info-spec-val">' + item.tier + '</div></div>';
    if (item.sellPrice) h += '<div class="info-spec-item"><div class="info-spec-label">Sell Price</div><div class="info-spec-val">' + item.sellPrice.toLocaleString() + '</div></div>';
    if (item.canCraft) h += '<div class="info-spec-item"><div class="info-spec-label">Craftable</div><div class="info-spec-val">Yes</div></div>';
    if (item.canUse) h += '<div class="info-spec-item"><div class="info-spec-label">Usable</div><div class="info-spec-val">Yes</div></div>';
    h += '</div>';

    _safeSetHtml(popup, h);
    popup.classList.add('open');
    overlay.classList.add('open');
    const close = () => { popup.classList.remove('open'); overlay.classList.remove('open'); overlay.removeEventListener('click', close); };
    overlay.addEventListener('click', close);
}

export function initInventoryStorageListener() {
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (changes.stashData) { loadInventory(); loadSpecialistTimers(); refreshAllTimestamps(); }
        if (changes.specialistsData) { loadSpecialistTimers(); }
    });
}

// Self-initialize
loadInventory();
loadSpecialistTimers();
initInventoryStorageListener();
