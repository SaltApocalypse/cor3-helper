// Shared detail search logic for devtools-panel and devtools-log-viewer
// Works in raw/pretty AND tree view modes

// Module-level search state
let detailSearchMatches = [];
let detailSearchCurrent = -1;
let detailSearchQuery = '';

// References set by init()
let _detailBody = null;
let _detailSearchCount = null;
let _getDetailFormat = null;

export function initDetailSearch(detailBody, detailSearchCount, getDetailFormat) {
    _detailBody = detailBody;
    _detailSearchCount = detailSearchCount;
    _getDetailFormat = getDetailFormat;
}

export function resetDetailSearch() {
    detailSearchMatches = [];
    detailSearchCurrent = -1;
    detailSearchQuery = '';
    if (_detailSearchCount) _detailSearchCount.textContent = '';
}

export function performDetailSearch(query) {
    detailSearchQuery = query;
    detailSearchMatches = [];
    detailSearchCurrent = -1;
    _detailSearchCount.textContent = '';
    if (!query) return;

    if (_getDetailFormat() === 'tree') {
        performTreeSearch(query);
        return;
    }

    const text = _detailBody.textContent;
    const lower = text.toLowerCase();
    const queryLower = query.toLowerCase();
    let idx = 0;
    while (idx < lower.length) {
        const found = lower.indexOf(queryLower, idx);
        if (found === -1) break;
        detailSearchMatches.push({ start: found, end: found + query.length });
        idx = found + 1;
    }

    if (detailSearchMatches.length === 0) {
        _detailSearchCount.textContent = '0 matches';
        return;
    }

    detailSearchCurrent = 0;
    highlightDetailMatches();
}

function performTreeSearch(query) {
    const queryLower = query.toLowerCase();
    const nodes = _detailBody.querySelectorAll('.tree-node');
    detailSearchMatches = [];
    nodes.forEach(node => {
        const text = node.textContent.toLowerCase();
        if (text.includes(queryLower)) {
            detailSearchMatches.push({ node });
        }
    });
    if (detailSearchMatches.length === 0) {
        _detailSearchCount.textContent = '0 matches';
        return;
    }
    detailSearchCurrent = 0;
    highlightTreeMatch();
}

function highlightTreeMatch() {
    _detailBody.querySelectorAll('.tree-node').forEach(n => n.style.background = '');
    if (detailSearchMatches.length === 0) return;
    const m = detailSearchMatches[detailSearchCurrent];
    if (!m || !m.node) return;
    let el = m.node;
    while (el && el !== _detailBody) {
        if (el.classList && el.classList.contains('tree-children') && el.classList.contains('collapsed')) {
            el.classList.remove('collapsed');
            const prev = el.previousElementSibling;
            if (prev) {
                const tog = prev.querySelector('.tree-toggle');
                if (tog) tog.textContent = '\u25BC';
                const pv = prev.querySelector('.tree-preview');
                if (pv) pv.textContent = '';
            }
        }
        el = el.parentElement;
    }
    m.node.style.background = '#f9e2af33';
    m.node.scrollIntoView({ block: 'center', behavior: 'smooth' });
    _detailSearchCount.textContent = `${detailSearchCurrent + 1}/${detailSearchMatches.length}`;
}

function highlightDetailMatches() {
    if (detailSearchMatches.length === 0) return;

    const text = _detailBody.textContent;
    const fragment = document.createDocumentFragment();
    let lastEnd = 0;

    for (let i = 0; i < detailSearchMatches.length; i++) {
        const m = detailSearchMatches[i];
        if (m.start > lastEnd) {
            fragment.appendChild(document.createTextNode(text.substring(lastEnd, m.start)));
        }
        const span = document.createElement('span');
        span.className = 'search-highlight' + (i === detailSearchCurrent ? ' current' : '');
        span.textContent = text.substring(m.start, m.end);
        if (i === detailSearchCurrent) span.id = 'currentSearchMatch';
        fragment.appendChild(span);
        lastEnd = m.end;
    }
    if (lastEnd < text.length) {
        fragment.appendChild(document.createTextNode(text.substring(lastEnd)));
    }

    _detailBody.replaceChildren(fragment);
    _detailSearchCount.textContent = `${detailSearchCurrent + 1}/${detailSearchMatches.length}`;

    const current = document.getElementById('currentSearchMatch');
    if (current) current.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

export function nextDetailMatch(searchInputValue) {
    if (detailSearchMatches.length === 0) {
        performDetailSearch(searchInputValue);
        return;
    }
    detailSearchCurrent = (detailSearchCurrent + 1) % detailSearchMatches.length;
    if (_getDetailFormat() === 'tree') {
        highlightTreeMatch();
    } else {
        highlightDetailMatches();
    }
}
