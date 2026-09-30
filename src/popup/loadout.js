import { _h, _noData, _safeSetHtml } from './dom-helpers.js';
import { getCor3Tab } from './utils.js';
import { refreshAllTimestamps } from './timestamps.js';
import { state, zoomList } from './state.js';

const loadoutError = document.getElementById('loadoutError');
const loadoutHwContainer = document.getElementById('loadoutHwContainer');
const loadoutOverviewContainer = document.getElementById('loadoutOverviewContainer');
const loadoutSwContainer = document.getElementById('loadoutSwContainer');
const loadoutSwCount = document.getElementById('loadoutSwCount');
const refreshLoadoutBtn = document.getElementById('refreshLoadoutBtn');
const loadoutHwToggle = document.getElementById('loadoutHwToggle');
const loadoutHwBody = document.getElementById('loadoutHwBody');
const loadoutOverviewToggle = document.getElementById('loadoutOverviewToggle');
const loadoutOverviewBody = document.getElementById('loadoutOverviewBody');
const loadoutSwToggle = document.getElementById('loadoutSwToggle');
const loadoutSwBody = document.getElementById('loadoutSwBody');
const loadoutSwSort = document.getElementById('loadoutSwSort');
const loadoutSwSearch = document.getElementById('loadoutSwSearch');

let cachedLoadoutData = null;

loadoutHwToggle.addEventListener('click', () => { loadoutHwToggle.classList.toggle('open'); loadoutHwBody.classList.toggle('open'); });
loadoutOverviewToggle.addEventListener('click', () => { loadoutOverviewToggle.classList.toggle('open'); loadoutOverviewBody.classList.toggle('open'); });
loadoutSwToggle.addEventListener('click', () => { loadoutSwToggle.classList.toggle('open'); loadoutSwBody.classList.toggle('open'); });

const LOADOUT_SPEC_MAP = {
    cpuFrequency: 'CPU Frequency', cpuCores: 'CPU Cores', cpuConsuming: 'Power Consuming',
    gpuPower: 'GPU Power', gpuMemory: 'GPU Memory', gpuConsuming: 'Power Consuming',
    ramFrequency: 'RAM Frequency', ramMemory: 'RAM Memory',
    psuPower: 'PSU Power', psuProtection: 'PSU Protection',
    cpu_frequency: 'CPU Frequency', cpu_cores: 'CPU Cores',
    gpu_power: 'GPU Power', gpu_memory: 'GPU Memory',
    ram_frequency: 'RAM Frequency', ram_memory: 'RAM Memory',
    psu_power: 'PSU Power', psu_total: 'PSU Total'
};
const LOADOUT_UNIT_MAP = {
    cpu_frequency: 'GHz', cpuFrequency: 'GHz',
    cpu_cores: 'Count', cpuCores: 'Count',
    gpu_power: 'PFLOPS', gpuPower: 'PFLOPS',
    gpu_memory: 'TB', gpuMemory: 'TB',
    ram_frequency: 'GHz', ramFrequency: 'GHz',
    ram_memory: 'TB', ramMemory: 'TB',
    psu_power: 'kW', psuPower: 'kW',
    psu_total: 'kW', cpuConsuming: 'kW', gpuConsuming: 'kW'
};
function loadoutSpecLabel(key) { return LOADOUT_SPEC_MAP[key] || key; }
function loadoutUnitLabel(key) { return LOADOUT_UNIT_MAP[key] || ''; }

const LOADOUT_INFO_SVG = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="color:currentColor"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.5"/><path d="M12 17V12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="12" cy="8" r="0.75" fill="currentColor"/></svg>';
const LOADOUT_INFO_SQUARE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none"><g clip-path="url(#li)"><path d="M3.759 1.2H12.243c.703 0 1.3.246 1.81.75.502.503.748 1.095.748 1.797v8.495c0 .71-.246 1.305-.748 1.807-.51.505-1.107.751-1.81.751H3.76c-.71 0-1.306-.246-1.809-.749-.502-.502-.749-1.097-.749-1.808V3.747c0-.703.246-1.295.75-1.798.502-.503 1.098-.75 1.808-.75z" stroke="currentColor" stroke-width="0.8"/><path d="M6.994 3.837h2.002v1.992H6.994V3.837zM6.994 7.124h2.002v5.049H6.994V7.124z" fill="currentColor"/></g><defs><clipPath id="li"><rect width="16" height="16" fill="currentColor"/></clipPath></defs></svg>';
const LOADOUT_CHANGE_SVG = '<svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg"><mask id="mc" maskUnits="userSpaceOnUse" x="0" y="0" width="15" height="15" style="mask-type:alpha"><rect width="15" height="15" fill="#D9D9D9"/></mask><g mask="url(#mc)"><path d="M4.375 13.125L1.25 10L4.375 6.875L5.26562 7.75L3.64062 9.375H13.125V10.625H3.64062L5.26562 12.25L4.375 13.125ZM10.625 8.125L9.73438 7.25L11.3594 5.625H1.875V4.375H11.3594L9.73438 2.75L10.625 1.875L13.75 5L10.625 8.125Z" fill="#76C1D1"/></g></svg>';
const LOADOUT_INSTALL_SVG = '<svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg"><mask id="mi" maskUnits="userSpaceOnUse" x="0" y="0" width="15" height="15" style="mask-type:alpha"><rect width="15" height="15" fill="#D9D9D9"/></mask><g mask="url(#mi)"><path d="M7.5 9.894L3.95 6.345l1.167-1.18L6.67 6.728V2.2h1.656v4.528l1.554-1.563 1.167 1.18L7.5 9.894zM3.855 12.8c-.461 0-.853-.16-1.174-.482A1.614 1.614 0 012.2 11.144V9.27h1.656v1.875h7.288V9.27H12.8v1.875c0 .461-.16.853-.482 1.174-.321.322-.713.482-1.174.482H3.855z" fill="#00CDAB"/></g></svg>';
const LOADOUT_UNINSTALL_SVG = '<svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg"><mask id="mu" maskUnits="userSpaceOnUse" x="0" y="0" width="15" height="15" style="mask-type:alpha"><rect width="15" height="15" fill="#D9D9D9"/></mask><g mask="url(#mu)"><path d="M4.277 13.425a1.614 1.614 0 01-1.174-.482 1.614 1.614 0 01-.482-1.174V3.847H1.793V2.191h3.628V1.363H9.56v.828h3.646v1.656h-.828v7.922c0 .461-.16.853-.482 1.174-.321.322-.713.482-1.174.482H4.277zm6.445-9.578H4.277v7.922h6.445V3.847zM5.466 10.616h1.453V4.991H5.466v5.625zm2.614 0h1.453V4.991H8.08v5.625z" fill="#FF5050"/></g></svg>';

const HW_SPEC_DISPLAY = {
    cpuFrequency: ['Frequency', 'GHz'],
    cpuCores: ['Cores count', 'count'],
    cpuConsuming: ['Power consuming', 'kW'],
    gpuPower: ['Power', 'PFLOPS'],
    gpuMemory: ['Memory', 'TB'],
    gpuConsuming: ['Power consuming', 'kW'],
    ramFrequency: ['Frequency', 'GHz'],
    ramMemory: ['Memory', 'TB'],
    psuPower: ['Power', 'kW'],
    psuProtection: ['Protection', '%']
};

function hwSpecRows(specs, vuln) {
    let h = '';
    Object.entries(specs).forEach(([k, v]) => {
        const d = HW_SPEC_DISPLAY[k];
        if (!d) return;
        h += '<div class="loadout-hw-stat-row"><span>' + d[0] + ' ' + d[1] + '</span><span class="stat-val">' + v + '</span></div>';
    });
    if (vuln !== undefined && vuln !== null) {
        h += '<div class="loadout-hw-stat-row"><span>Vulnerability %</span><span class="stat-val">' + vuln + '</span></div>';
    }
    return h;
}

function hwSpecRowsSmall(specs, vuln, cls) {
    let h = '';
    Object.entries(specs).forEach(([k, v]) => {
        const d = HW_SPEC_DISPLAY[k];
        if (!d) return;
        h += '<div class="' + cls + '"><span>' + d[0] + ' ' + d[1] + '</span><span class="stat-val">' + v + '</span></div>';
    });
    if (vuln !== undefined && vuln !== null) {
        h += '<div class="' + cls + '"><span>Vulnerability %</span><span class="stat-val">' + vuln + '</span></div>';
    }
    return h;
}

function showHwInfoPopup(item) {
    const popup = document.getElementById('hwInfoPopup');
    const overlay = document.getElementById('hwInfoOverlay');
    let h = '<div class="info-title">' + LOADOUT_INFO_SVG + ' ' + (item.name || '').toUpperCase() + '</div>';
    h += '<div class="info-desc">';
    const matchedSubstr = item.name ? Object.keys(zoomList).find(substring => item.name.includes(substring)) : "";
    let zoomHWImg = '';
    if (matchedSubstr) {
        zoomHWImg = `style="transform:scale(${zoomList[matchedSubstr]});object-fit:contain;"`;
    }
    if (item.image) h += `<div style="overflow:clip;"><img ${zoomHWImg} src="${item.image}" alt=""></div>`;
    h += '<span>' + (item.description || 'No description available.') + '</span>';
    h += '</div>';
    h += '<div class="info-specs">';
    const specs = item.specs || {};
    Object.entries(specs).forEach(([k, v]) => {
        const d = HW_SPEC_DISPLAY[k];
        if (!d) return;
        h += '<div class="info-spec-item"><div class="info-spec-label">' + d[0] + '</div><div class="info-spec-val">' + v + ' ' + d[1] + '</div></div>';
    });
    if (item.itemVulnerability !== undefined) {
        h += '<div class="info-spec-item"><div class="info-spec-label">Vulnerability</div><div class="info-spec-val">' + item.itemVulnerability + ' %</div></div>';
    }
    h += '</div>';
    _safeSetHtml(popup, h);
    popup.classList.add('open');
    overlay.classList.add('open');
    const close = () => { popup.classList.remove('open'); overlay.classList.remove('open'); overlay.removeEventListener('click', close); };
    overlay.addEventListener('click', close);
}

function renderLoadoutHardware(data) {
    if (!data || !data.equippedHardware) {
        loadoutHwContainer.replaceChildren(_noData('No hardware data'));
        return;
    }
    const hw = data.equippedHardware;
    const avail = data.ownedHardware || [];
    const cats = ['cpu', 'gpu', 'ram', 'psu'];
    let html = '';
    cats.forEach(cat => {
        const item = hw[cat];
        if (!item) return;
        const replacements = avail.filter(a => a.category && a.category.toLowerCase() === cat && a.id !== item.id);
        html += '<div class="loadout-hw-card">';
        html += '<div class="loadout-hw-left">';
        html += '<div class="loadout-hw-header">';
        html += '<div class="loadout-hw-cat">' + (item.category || cat.toUpperCase()) + '</div>';
        html += '<div class="loadout-hw-name">' + (item.name || 'Unknown') + '</div>';
        html += '</div>';
        html += '<div class="loadout-hw-stats">' + hwSpecRows(item.specs || {}, item.itemVulnerability) + '</div>';
        html += '</div>';
        html += '<div class="loadout-hw-right">';
        html += '<button class="loadout-hw-change-btn" data-cat="' + cat + '">' + LOADOUT_CHANGE_SVG + 'CHANGE</button>';
        html += '<button class="loadout-hw-info-btn" data-hw-cat="' + cat + '">' + LOADOUT_INFO_SVG + 'INFO</button>';
        html += '</div>';
        html += '</div>';
        html += '<div class="loadout-hw-replace-list" data-cat="' + cat + '">';
        html += '<input type="text" class="loadout-hw-replace-search" placeholder="Search..." data-cat="' + cat + '">';
        html += '<div class="replace-items-wrap" data-cat="' + cat + '">';
        replacements.forEach(r => {
            html += '<div class="loadout-hw-replace-item" data-search-name="' + (r.name || '').toLowerCase() + '">';
            html += '<div class="replace-left">';
            html += '<div class="replace-header">';
            html += '<div class="replace-cat">' + (r.category || cat.toUpperCase()) + '</div>';
            html += '<div class="replace-name">' + (r.name || '') + '</div>';
            html += '</div>';
            html += '<div class="replace-stats">' + hwSpecRowsSmall(r.specs || {}, r.itemVulnerability, 'replace-stat-row') + '</div>';
            html += '</div>';
            html += '<div class="replace-right">';
            html += '<button class="replace-btn" data-id="' + r.id + '">' + LOADOUT_CHANGE_SVG + 'CHANGE</button>';
            html += '<button class="replace-info-btn" data-hw-id="' + r.id + '">' + LOADOUT_INFO_SVG + '<span style="margin-top: 1px;">INFO</span></button>';
            html += '</div>';
            html += '</div>';
        });
        html += '</div>';
        html += '</div>';
    });
    if (html) { _safeSetHtml(loadoutHwContainer, html); } else { loadoutHwContainer.replaceChildren(_noData('No hardware equipped')); }

    loadoutHwContainer.querySelectorAll('.loadout-hw-change-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const cat = btn.dataset.cat;
            const list = loadoutHwContainer.querySelector('.loadout-hw-replace-list[data-cat="' + cat + '"]');
            if (list) list.classList.toggle('open');
        });
    });

    loadoutHwContainer.querySelectorAll('.loadout-hw-replace-search').forEach(input => {
        input.addEventListener('input', () => {
            const cat = input.dataset.cat;
            const val = input.value.toLowerCase().trim();
            const wrap = loadoutHwContainer.querySelector('.replace-items-wrap[data-cat="' + cat + '"]');
            if (!wrap) return;
            wrap.querySelectorAll('.loadout-hw-replace-item').forEach(item => {
                item.style.display = !val || item.dataset.searchName.includes(val) ? '' : 'none';
            });
        });
    });

    loadoutHwContainer.querySelectorAll('.replace-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            clearLoadoutError();
            const moduleConfigId = btn.dataset.id;
            btn.disabled = true;
            btn.textContent = '...';
            try {
                const tab = await getCor3Tab();
                if (tab) await chrome.tabs.sendMessage(tab.id, { action: "equipHardware", moduleConfigId });
            } catch (err) { showLoadoutError('Equip failed: ' + err.message); }
        });
    });

    loadoutHwContainer.querySelectorAll('.loadout-hw-info-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const cat = btn.dataset.hwCat;
            const item = hw[cat];
            if (item) showHwInfoPopup(item);
        });
    });

    loadoutHwContainer.querySelectorAll('.replace-info-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.dataset.hwId;
            const item = avail.find(a => a.id === id);
            if (item) showHwInfoPopup(item);
        });
    });
}

function renderLoadoutOverview(data) {
    if (!data || !data.resources) {
        loadoutOverviewContainer.replaceChildren(_noData('No resource data'));
        return;
    }
    const res = data.resources;
    const supply = res.supply || {};
    const demand = res.demand || {};
    const TOTAL_CELLS = 20;
    const UNIT_LABELS = { cpu_frequency: 'GHZ', cpu_cores: 'COUNT', gpu_power: 'PFLOPS', gpu_memory: 'TB', ram_frequency: 'GHZ', ram_memory: 'TB', psu_power: 'KW' };

    let html = '<div class="loadout-res-stats">';
    html += '<div class="loadout-res-header"><div class="loadout-res-header-cell">Type</div><div class="loadout-res-header-cell">Usage / Available</div></div>';
    const keys = ['cpu_frequency', 'cpu_cores', 'gpu_power', 'gpu_memory', 'ram_frequency', 'ram_memory', 'psu_power'];
    keys.forEach(key => {
        const s = supply[key];
        const d = demand[key] || demand[key === 'psu_power' ? 'psu_total' : key] || 0;
        if (s === undefined) return;
        const ratio = s > 0 ? Math.min(d / s, 1) : 0;
        let colorFill = '';
        if (ratio > 0.95) { colorFill = 'red' }
        else if (ratio > 0.75) { colorFill = 'yellow' }
        else { colorFill = 'blue' }

        const filledCount = Math.round(ratio * TOTAL_CELLS);
        const unit = UNIT_LABELS[key] || '';
        html += '<div class="loadout-res-row">';
        html += '<div class="loadout-res-name">' + loadoutSpecLabel(key) + '</div>';
        html += '<div class="loadout-res-bar-wrap">';
        html += '<div class="loadout-res-bar-edge ' + colorFill + '"></div>';
        html += '<div class="loadout-res-bar-cells">';
        for (let i = 0; i < TOTAL_CELLS; i++) {
            html += '<div class="loadout-res-bar-cell ' + (i < filledCount ? 'filled-' : 'empty-') + colorFill + '"></div>';
        }
        html += '</div>';
        html += '<div class="loadout-res-bar-edge ' + colorFill + '"></div>';
        html += '</div>';
        const dFmt = Number.isInteger(d) ? d : parseFloat(d.toFixed(2));
        const sFmt = Number.isInteger(s) ? s : parseFloat(s.toFixed(2));
        html += '<div class="loadout-res-vals"><span class="res-highlight">' + dFmt + ' / ' + sFmt + '</span> ' + unit + '</div>';
        html += '</div>';
    });
    html += '</div>';
    _safeSetHtml(loadoutOverviewContainer, html);
}

function loadoutToolSvg(type) {
    const t = (type || '').toUpperCase();
    if (t === 'DECRYPT') return '<svg class="loadout-sw-tool-icon" width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M14.28 6.929c-.018.67.407 1.005 1.276 1.005h5.455L14.28 1.2V6.93zM4.428 1.2c-.96 0-1.439.475-1.439 1.425v18.75c0 .95.48 1.425 1.44 1.425h15.158c.95 0 1.425-.475 1.425-1.425V9.712h-5.456c-.94 0-1.633-.212-2.076-.638-.679-.47-1.004-1.204-.977-2.2V1.2H4.428zm3.88 10.169l1.046 1.059-2.579 2.593 2.592 2.593-1.058 1.06-3.637-3.653 3.637-3.652zm3.678 0h1.52l-1.466 7.304h-1.52l1.466-7.304zm2.66 1.059l1.072-1.06 3.637 3.653-3.664 3.652-1.045-1.059 2.606-2.579-2.606-2.607z" fill="#F1F4F5"/></svg>';
    if (t === 'HACK') return '<svg class="loadout-sw-tool-icon" width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M11.259 11.23H6.067v6.844c0 .811.285 1.496.855 2.055.569.574 1.257.861 2.063.861h2.275V11.23zm6.674 0h-5.192v9.76h2.275c.811 0 1.499-.287 2.063-.861.57-.56.854-1.244.854-2.055V11.23zm1.965 3.203h-.862v1.594h.862c.866 0 1.3.436 1.3 1.307v3.936H22.8v-3.936c0-1.934-.967-2.9-2.902-2.9zm2.759-2h-3.598v1.217h3.598V12.44zm-1.466-5.955c0 .866-.431 1.3-1.293 1.3h-1.323v1.601h1.323c1.925 0 2.887-.967 2.887-2.9V2.73h-1.595v3.755zM4.964 14.433H4.102c-1.935 0-2.902.967-2.902 2.9v3.937h1.602v-3.936c0-.871.434-1.307 1.3-1.307h.862v-1.594zm-.023-1.994v-1.217H1.344v1.217h3.597zM5.425 9.386V7.784H4.102c-.862 0-1.293-.433-1.293-1.3V2.731H1.215v3.754c0 1.934.963 2.901 2.887 2.901h1.323zM6.725 6.334v3.143h10.55V6.334c0-.403-.063-.813-.189-1.232a3.063 3.063 0 00-.574-1.08c-.509-.509-1.129-.763-1.86-.763H9.347c-.73 0-1.35.254-1.859.763a3.063 3.063 0 00-.574 1.08c-.126.42-.189.83-.189 1.232z" fill="white"/></svg>';
    if (t === 'SEARCH') return '<svg class="loadout-sw-tool-icon" width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M17.171 3.934C15.348 2.111 13.144 1.2 10.56 1.2 7.979 1.2 5.775 2.111 3.948 3.934 2.125 5.761 1.214 7.967 1.214 10.552c-.001 2.58.91 4.782 2.734 6.605 1.827 1.827 4.231 2.74 6.812 2.74 1.759 0 3.342-.422 4.749-1.267.278-.167.549-.351.812-.552l1.765 1.765-.001-.005 2.962 2.962 1.939-1.977-2.962-2.956.054-.06-.06.06-1.743-1.738c1.224-1.607 1.836-3.466 1.836-5.578 0-2.584-.914-4.69-2.74-6.517zm.574 6.617c0 1.983-.702 3.674-2.106 5.074-1.4 1.404-3.094 2.106-5.08 2.106-1.982 0-3.675-.702-5.079-2.106-1.4-1.4-2.101-3.091-2.101-5.074 0-1.986.7-3.681 2.101-5.085C6.884 4.066 8.577 3.366 10.56 3.366c1.986 0 3.679.7 5.079 2.1 1.404 1.405 2.106 3.1 2.106 5.085z" fill="white"/></svg>';
    return '<svg class="loadout-sw-tool-icon" width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="white" stroke-width="1.5"/><path d="M12 8v4l2 2" stroke="white" stroke-width="1.5" stroke-linecap="round"/></svg>';
}

function getSwToolGroup(sw) {
    const specs = sw.specs || [];
    const order = { hack: 0, decrypt: 1, search: 2, view: 3, load: 4 };
    let best = 99;
    specs.forEach(s => {
        const t = (s.type || '').toLowerCase();
        if (order[t] !== undefined && order[t] < best) best = order[t];
    });
    return best;
}

function swMatchesFilter(sw, filterVal) {
    if (filterVal === 'all') return true;
    const specs = sw.specs || [];
    return specs.some(s => (s.type || '').toLowerCase() === filterVal);
}

function renderLoadoutSoftware(data) {
    if (!data) {
        loadoutSwContainer.replaceChildren(_noData('No software data'));
        return;
    }
    const equipped = data.equippedSoftware || [];
    const available = data.ownedSoftware || [];
    const softwarePower = (data.resources && data.resources.softwarePower) || [];
    const equippedIds = new Set(equipped.map(s => s.id));
    const all = [];
    equipped.forEach(s => all.push({ ...s, installed: true }));
    available.filter(s => !equippedIds.has(s.id)).forEach(s => all.push({ ...s, installed: false }));

    const filterVal = loadoutSwSort.value;
    const searchVal = (loadoutSwSearch.value || '').toLowerCase().trim();

    let filtered = all.filter(s => swMatchesFilter(s, filterVal));
    if (searchVal) filtered = filtered.filter(s => (s.name || '').toLowerCase().includes(searchVal) || (s.manufacturer || '').toLowerCase().includes(searchVal));

    const installedItems = filtered.filter(s => s.installed).sort((a, b) => getSwToolGroup(a) - getSwToolGroup(b));
    const uninstalledItems = filtered.filter(s => !s.installed).sort((a, b) => getSwToolGroup(a) - getSwToolGroup(b));
    const sorted = [...installedItems, ...uninstalledItems];

    const installedCount = equipped.length;
    const totalCount = all.length;
    loadoutSwCount.textContent = '(' + installedCount + '/' + totalCount + ')';

    if (sorted.length === 0) {
        loadoutSwContainer.replaceChildren(_noData('No programs found'));
        return;
    }

    let html = '';
    sorted.forEach(sw => {
        const pwInfo = softwarePower.find(p => p.moduleId === sw.id);
        const specs = sw.specs || [];
        const consuming = sw.consuming || {};

        html += '<div class="loadout-sw-card' + (sw.installed ? ' installed' : '') + '">';
        html += '<div class="loadout-sw-header">';
        html += '<div class="loadout-sw-row">';
        html += '<div style="overflow:hidden;border-radius:4px;width:40px;height:40px;">';
        html += '<img class="loadout-sw-img"'
        const matchedSubstring = Object.keys(zoomList).find(substring => sw.name.includes(substring));
        if (matchedSubstring) {
            html += `style="transform:scale(${zoomList[matchedSubstring]});"`;
        }
        html += ' src="' + (sw.image || '') + '" alt="' + (sw.name || '') + '"></div>';
        html += '<div class="loadout-sw-name">' + (sw.name || 'Unknown') + '</div>';
        html += '</div>';
        if (sw.installed) {
            html += '<button class="loadout-sw-install-btn uninstall" data-id="' + sw.id + '" data-action="uninstall">' + LOADOUT_UNINSTALL_SVG + 'UNINSTALL</button>';
        } else {
            html += '<button class="loadout-sw-install-btn install" data-id="' + sw.id + '" data-action="install">' + LOADOUT_INSTALL_SVG + 'INSTALL</button>';
        }
        html += '</div>';

        const funcLines = specs.map(spec => {
            const typeLabel = (spec.type || '').toUpperCase();
            let line = '<div>';
            line += '<span class="func-label">FUNC:</span>';
            line += '<span class="func-tags">' + typeLabel;
            if (spec.power) line += ' ' + spec.power[0] + '/' + spec.power[1];
            line += '</span>';
            line += '</div>';
            return line;
        });
        html += '<div class="loadout-sw-func">';
        html += '<div class="func-left">' + funcLines.join(' ') + '</div>';
        html += '<button class="loadout-sw-info-btn" data-sw-id="' + sw.id + '">' + LOADOUT_INFO_SVG + ' <span style="margin-top: 1px;">INFO</span></button>';
        html += '</div>';

        html += '<div class="loadout-sw-details" data-details-id="' + sw.id + '">';
        html += '<div class="loadout-sw-details-header">Basic Required</div>';

        const consumeKeys = ['cpu_frequency', 'cpu_cores', 'gpu_power', 'gpu_memory', 'ram_frequency', 'ram_memory'];
        const noAllocKeys = new Set(['cpu_frequency', 'ram_frequency']);
        const supply = (data.resources && data.resources.supply) || {};
        let hasConsume = false;

        if (sw.installed) {
            const rowList = [];
            let minPct = 100;
            let minPctIndex = 0;
            let counter = 0;
            consumeKeys.forEach(ck => {
                const vals = consuming[ck];
                if (!vals || !Array.isArray(vals) || vals.length < 2) return;
                hasConsume = true;
                const unit = loadoutUnitLabel(ck);
                let allocV, minV, maxV;
                if (noAllocKeys.has(ck)) {
                    allocV = null;
                    minV = vals[0];
                    maxV = vals[1];
                } else {
                    allocV = vals[0];
                    minV = vals.length >= 2 ? vals[1] : vals[0];
                    maxV = vals.length >= 3 ? vals[2] : vals[vals.length - 1];
                }
                let otherBaseDemand = 0;
                equipped.forEach(otherSw => {
                    if (otherSw.id === sw.id) return;
                    const otherVals = otherSw.consuming && otherSw.consuming[ck];
                    if (!otherVals || !Array.isArray(otherVals)) return;
                    otherBaseDemand += (otherVals.length === 3 ? otherVals[0] : 0);
                });
                const availableV = (supply[ck] || 0) - otherBaseDemand;
                let pct;
                if (maxV > minV) {
                    pct = Math.max(0, Math.min(((availableV - minV) / (maxV - minV)), 1)) * 100;
                } else {
                    pct = availableV >= minV ? 100 : 0;
                }
                if (pct < minPct) {
                    minPct = pct;
                    minPctIndex = counter;
                }
                rowList.push({
                    'label': loadoutSpecLabel(ck),
                    'supplyV': supply[ck] || 0,
                    'allocV': allocV,
                    'unit': unit,
                    'minV': minV,
                    'maxV': maxV,
                    'pct': pct
                });
                counter++;
            });

            counter = 0;
            let color = 'blue';
            rowList.forEach(obj => {
                html += '<div class="loadout-sw-stat-row">';
                html += '<span class="stat-name">' + obj['label'];
                if (obj['allocV'] !== null) {
                    html += ' <span class="stat-alloc">(' + obj['allocV'].toFixed(2) + ' ' + obj['unit'] + ')</span>';
                } else if (obj['unit']) {
                    html += ' <span class="stat-alloc">(' + obj['unit'] + ')</span>';
                }
                html += '</span>';
                html += '<span class="stat-val">' + obj['minV'].toFixed(2) + '/' + obj['maxV'].toFixed(2) + '</span>';
                html += '</div>';
                if (counter === minPctIndex && obj['pct'] !== 100) { color = 'yellow'}
                else { color = 'blue' }
                html += '<div class="loadout-sw-stat-bar"><div class="stat-bar-fill-' + color + '" style="width:' + obj['pct'].toFixed(1) + '%"></div></div>';
                counter++;
            });

            if (!hasConsume) html += '<div style="font-size:9px;color:rgba(107,120,136,1);">No consumption data</div>';
        } else {
            consumeKeys.forEach(ck => {
                const vals = consuming[ck];
                if (!vals || !Array.isArray(vals) || vals.length < 2) return;
                hasConsume = true;
                const unit = loadoutUnitLabel(ck);
                let minV, maxV;
                if (noAllocKeys.has(ck)) { minV = vals[0]; maxV = vals[1]; }
                else { minV = vals.length >= 2 ? vals[1] : vals[0]; maxV = vals.length >= 3 ? vals[2] : vals[vals.length - 1]; }
                html += '<div class="loadout-sw-stat-row">';
                html += '<span class="stat-name">' + loadoutSpecLabel(ck);
                if (unit) html += ' <span class="stat-alloc">(' + unit + ')</span>';
                html += '</span>';
                html += '<span class="stat-val">' + minV.toFixed(2) + '/' + maxV.toFixed(2) + '</span>';
                html += '</div>';
                html += '<div class="loadout-sw-stat-bar"><div class="stat-bar-fill"></div></div>';
            });
            if (!hasConsume) html += '<div style="font-size:9px;color:rgba(107,120,136,1);">No consumption data</div>';
        }

        html += '<div class="loadout-sw-tool-section">';
        specs.forEach(spec => {
            const typeLabel = (spec.type || '').toUpperCase() + ' TOOL';
            html += '<div class="loadout-sw-tool-row">';
            html += '<div>' + loadoutToolSvg(spec.type) + '</div>';
            html += '<div>';
            html += '<div class="loadout-sw-tool-name">' + typeLabel + '</div>';
            html += '<div class="loadout-sw-tool-detail">';
            if (spec.fileTypes && spec.fileTypes.length > 0) {
                html += spec.fileTypes.length + ' files';
                html += ' <span class="info-tooltip">' + LOADOUT_INFO_SQUARE_SVG + '<span class="tooltip-text">' + spec.fileTypes.join(', ') + '</span></span>';
            }
            if (spec.serverTypes && spec.serverTypes.length > 0) {
                html += spec.serverTypes.length + ' servers';
                html += ' <span class="info-tooltip">' + LOADOUT_INFO_SQUARE_SVG + '<span class="tooltip-text">' + spec.serverTypes.join(', ') + '</span></span>';
            }
            html += '</div>';
            html += '</div>';
            html += '</div>';
            if (spec.power) {
                const pwEntry = pwInfo && pwInfo.abilities ? pwInfo.abilities.find(a => a.type === spec.type) : null;
                html += '<div class="loadout-sw-power-row">';
                html += '<span class="power-label">Power</span>';
                if (pwEntry) {
                    html += '<span class="power-val" style="color:rgba(0,205,171,1);font-weight:bold;">' + pwEntry.computedPower + '/' + spec.power[1] + '</span>';
                } else {
                    html += '<span class="power-val">' + spec.power[0] + '/' + spec.power[1] + '</span>';
                }
                html += '</div>';
                const pwPct = spec.power[1] > 0 ? Math.min(((pwEntry ? pwEntry.computedPower : spec.power[0]) / spec.power[1]) * 100, 100) : 0;
                if (sw.installed) {
                    html += '<div class="loadout-sw-stat-bar"><div class="stat-bar-fill-blue" style="width:' + pwPct.toFixed(1) + '%"></div></div>';
                } else {
                    html += '<div class="loadout-sw-stat-bar"><div class="stat-bar-fill"></div></div>';
                }
            }
        });
        html += '</div>';

        if (pwInfo && pwInfo.ratio !== undefined) {
            html += '<div class="loadout-sw-stat-row" style="margin-top:4px;border-top:1px solid rgba(44,52,62,1);padding-top:4px;"><span class="stat-name">Performance Ratio</span><span class="stat-val">' + (pwInfo.ratio * 100).toFixed(1) + '%</span></div>';
        }

        html += '</div>';
        html += '</div>';
    });
    _safeSetHtml(loadoutSwContainer, html);

    loadoutSwContainer.querySelectorAll('.loadout-sw-install-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            clearLoadoutError();
            const moduleConfigId = btn.dataset.id;
            const action = btn.dataset.action;
            btn.disabled = true;
            btn.textContent = '...';
            try {
                const tab = await getCor3Tab();
                if (tab) {
                    if (action === 'install') {
                        await chrome.tabs.sendMessage(tab.id, { action: "equipSoftware", moduleConfigId });
                    } else {
                        await chrome.tabs.sendMessage(tab.id, { action: "unequipSoftware", moduleConfigId });
                    }
                }
            } catch (err) { showLoadoutError((action === 'install' ? 'Install' : 'Uninstall') + ' failed: ' + err.message); }
        });
    });

    loadoutSwContainer.querySelectorAll('.loadout-sw-info-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const swId = btn.dataset.swId;
            const card = btn.closest('.loadout-sw-card');
            if (!card) return;
            const details = card.querySelector('.loadout-sw-details[data-details-id="' + swId + '"]');
            if (details) details.classList.toggle('open');
        });
    });
}

export function showLoadoutError(msg) {
    loadoutError.textContent = msg;
    loadoutError.style.display = 'block';
    setTimeout(() => { loadoutError.style.display = 'none'; }, 10000);
}

function clearLoadoutError() {
    loadoutError.textContent = '';
    loadoutError.style.display = 'none';
}

export function renderLoadout(data) {
    if (!data) {
        loadoutHwContainer.replaceChildren(_noData('No loadout data yet'));
        loadoutOverviewContainer.replaceChildren(_noData('No loadout data yet'));
        loadoutSwContainer.replaceChildren(_noData('No loadout data yet'));
        return;
    }
    cachedLoadoutData = data;
    renderLoadoutHardware(data);
    renderLoadoutOverview(data);
    renderLoadoutSoftware(data);
}

export async function loadLoadout() {
    const { loadoutData, loadoutError: storedError } = await chrome.storage.local.get(['loadoutData', 'loadoutError']);
    if (storedError) showLoadoutError(storedError.message || JSON.stringify(storedError));
    renderLoadout(loadoutData || null);
}

export async function refreshLoadout() {
    try {
        const tab = await getCor3Tab();
        if (!tab) throw new Error('No cor3.gg tab');
        await chrome.tabs.sendMessage(tab.id, { action: "requestLoadout" });
        setTimeout(() => { loadLoadout(); refreshAllTimestamps(); }, 3000);
    } catch (e) {
        setTimeout(() => { loadLoadout(); refreshAllTimestamps(); }, 500);
    }
}

refreshLoadoutBtn.addEventListener('click', () => { clearLoadoutError(); refreshLoadout(); });
loadoutSwSort.addEventListener('change', () => { if (cachedLoadoutData) renderLoadoutSoftware(cachedLoadoutData); });
loadoutSwSearch.addEventListener('input', () => { if (cachedLoadoutData) renderLoadoutSoftware(cachedLoadoutData); });

export function initLoadoutStorageListener() {
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (changes.loadoutData) { renderLoadout(changes.loadoutData.newValue); refreshAllTimestamps(); }
        if (changes.loadoutError && changes.loadoutError.newValue) {
            showLoadoutError(changes.loadoutError.newValue.message || JSON.stringify(changes.loadoutError.newValue));
        }
    });
}

// Self-initialize
loadLoadout();
initLoadoutStorageListener();
