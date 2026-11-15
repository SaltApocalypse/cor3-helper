import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { useT } from '../i18n-context.js';
import { Modal } from './Modal.js';

export interface InfoTipProps {
    readonly text?: string;
    readonly children?: ComponentChildren;
    readonly label?: string;
    readonly title?: string;
}

/**
 * Small "i" affordance that opens an explanation modal. The modal dims and
 * blurs the page behind it, and closes on backdrop click, the close button,
 * or Escape.
 */
export function InfoTip({ text, children, label, title }: InfoTipProps) {
    const tr = useT();
    const [open, setOpen] = useState(false);
    const resolvedLabel = label ?? tr('More information');
    const resolvedTitle = title ?? tr('Information');
    return (
        <>
            <button
                type="button"
                class="v2-info-tip-button"
                aria-label={resolvedLabel}
                aria-expanded={open}
                onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setOpen(true);
                }}
            >
                i
            </button>
            <Modal open={open} title={resolvedTitle} onClose={() => setOpen(false)}>
                {children ?? <p class="v2-muted">{text}</p>}
            </Modal>
        </>
    );
}
