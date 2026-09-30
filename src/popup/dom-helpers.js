export function _h(tag, attrs, ...children) {
    const e = document.createElement(tag);
    if (attrs) {
        for (const [k, v] of Object.entries(attrs)) {
            if (k === 'className') e.className = v;
            else if (k === 'textContent') e.textContent = v;
            else if (k === 'title') e.title = v;
            else if (k.startsWith('on')) e.addEventListener(k.slice(2).toLowerCase(), v);
            else if (k === 'style' && typeof v === 'string') e.style.cssText = v;
            else if (k === 'dataset' && typeof v === 'object') { for (const [dk, dv] of Object.entries(v)) e.dataset[dk] = dv; }
            else e.setAttribute(k, v);
        }
    }
    for (const c of children) {
        if (c == null || c === false) continue;
        if (typeof c === 'string' || typeof c === 'number') e.appendChild(document.createTextNode(String(c)));
        else if (c instanceof Node) e.appendChild(c);
        else if (Array.isArray(c)) c.forEach(x => { if (x instanceof Node) e.appendChild(x); else if (x != null && x !== false) e.appendChild(document.createTextNode(String(x))); });
    }
    return e;
}

export function _noData(...parts) {
    const d = document.createElement('div');
    d.className = 'no-decisions';
    parts.forEach((p, i) => { if (i > 0) d.appendChild(document.createElement('br')); d.appendChild(document.createTextNode(p)); });
    return d;
}

export function _clearEl(el) { el.textContent = ''; }

export function _setMsg(el, cls, ...parts) { el.replaceChildren(_h('div', {className: cls}, ...parts.flatMap((p,i) => i > 0 ? [document.createElement('br'), p] : [p]))); }

export function _safeSetHtml(el, html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    el.replaceChildren(...doc.body.childNodes);
}

export { _h as el, _clearEl as clearEl, _noData as noDataMsg };
