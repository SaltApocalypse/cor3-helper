// Shared tree view renderer for devtools-panel and devtools-log-viewer
// Chrome Network tab style JSON previews

import { stripSioPrefix } from './devtools-msg-utils.js';

export function objectPreview(value, maxLen) {
    if (value === null || typeof value !== 'object') return '';
    try {
        const s = JSON.stringify(value);
        return s.length > maxLen ? s.substring(0, maxLen) + '\u2026' : s;
    } catch (e) { return ''; }
}

export function renderTreeNode(parent, value, key, expanded) {
    const node = document.createElement('div');
    node.className = 'tree-node';

    if (value !== null && typeof value === 'object') {
        const isArray = Array.isArray(value);
        const entries = isArray ? value.map((v, i) => [i, v]) : Object.entries(value);
        const openBracket = isArray ? '[' : '{';
        const closeBracket = isArray ? ']' : '}';

        const toggle = document.createElement('span');
        toggle.className = 'tree-toggle';
        toggle.textContent = expanded ? '\u25BC' : '\u25B6';
        node.appendChild(toggle);

        if (key !== null) {
            const keySpan = document.createElement('span');
            keySpan.className = 'tree-key';
            keySpan.textContent = JSON.stringify(String(key)) + ': ';
            node.appendChild(keySpan);
        }

        const bracket = document.createElement('span');
        bracket.className = 'tree-bracket';
        if (entries.length === 0) {
            bracket.textContent = openBracket + closeBracket;
        } else {
            bracket.textContent = openBracket;
        }
        node.appendChild(bracket);

        const previewSpan = document.createElement('span');
        previewSpan.className = 'tree-preview';
        previewSpan.style.color = '#6c7086';
        if (entries.length > 0) {
            previewSpan.textContent = expanded ? '' : ' ' + objectPreview(value, 120);
        }
        node.appendChild(previewSpan);

        const children = document.createElement('div');
        children.className = 'tree-children' + (expanded ? '' : ' collapsed');

        for (const [k, v] of entries) {
            renderTreeNode(children, v, k, false);
        }

        const closeLine = document.createElement('div');
        closeLine.className = 'tree-node';
        const closeBr = document.createElement('span');
        closeBr.className = 'tree-bracket';
        closeBr.textContent = closeBracket;
        closeLine.appendChild(closeBr);
        children.appendChild(closeLine);

        parent.appendChild(node);
        parent.appendChild(children);

        toggle.addEventListener('click', () => {
            const isCollapsed = children.classList.toggle('collapsed');
            toggle.textContent = isCollapsed ? '\u25B6' : '\u25BC';
            previewSpan.textContent = isCollapsed && entries.length > 0 ? ' ' + objectPreview(value, 120) : '';
        });
    } else {
        const indent = document.createElement('span');
        indent.style.display = 'inline-block';
        indent.style.width = '14px';
        node.appendChild(indent);

        if (key !== null) {
            const keySpan = document.createElement('span');
            keySpan.className = 'tree-key';
            keySpan.textContent = JSON.stringify(String(key)) + ': ';
            node.appendChild(keySpan);
        }

        const valSpan = document.createElement('span');
        if (typeof value === 'string') {
            valSpan.className = 'tree-string';
            valSpan.textContent = JSON.stringify(value);
        } else if (typeof value === 'number') {
            valSpan.className = 'tree-number';
            valSpan.textContent = String(value);
        } else if (typeof value === 'boolean') {
            valSpan.className = 'tree-boolean';
            valSpan.textContent = String(value);
        } else {
            valSpan.className = 'tree-null';
            valSpan.textContent = 'null';
        }
        node.appendChild(valSpan);
        parent.appendChild(node);
    }
}

export function buildTreeView(raw) {
    let data;
    const stripped = stripSioPrefix(raw);
    if (stripped !== raw && stripped.startsWith('[')) {
        try { data = JSON.parse(stripped); } catch (e) { return null; }
    } else if (raw.startsWith('0{')) {
        try { data = JSON.parse(raw.substring(1)); } catch (e) { return null; }
    } else {
        try { data = JSON.parse(raw); } catch (e) { return null; }
    }

    const container = document.createElement('div');
    container.className = 'tree-view';
    renderTreeNode(container, data, null, true);
    return container;
}
