import type { ComponentChildren } from 'preact';
import { useEffect } from 'preact/hooks';
import { useT } from '../i18n-context.js';

export interface ModalProps {
    readonly open: boolean;
    readonly title: string;
    readonly onClose: () => void;
    readonly children: ComponentChildren;
}

export function Modal({ open, title, onClose, children }: ModalProps) {
    const tr = useT();
    useEffect(() => {
        if (!open) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [open, onClose]);

    if (!open) return null;
    return (
        <div class="v2-modal-backdrop" role="presentation" onClick={onClose}>
            <section
                class="v2-modal"
                role="dialog"
                aria-modal="true"
                aria-label={title}
                onClick={(event) => event.stopPropagation()}
            >
                <header class="v2-modal-header">
                    <h2>{title}</h2>
                    <button type="button" class="v2-modal-close" aria-label={tr('Close')} onClick={onClose}>×</button>
                </header>
                <div class="v2-modal-body">{children}</div>
            </section>
        </div>
    );
}
