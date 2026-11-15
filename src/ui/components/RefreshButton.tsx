import { useT } from '../i18n-context.js';

export interface RefreshButtonProps {
    readonly label?: string;
    readonly disabled?: boolean | undefined;
    readonly onClick: () => void | Promise<void>;
    readonly className?: string;
}

/** Icon-only refresh control used across the side panel. */
export function RefreshButton({ label, disabled, onClick, className }: RefreshButtonProps) {
    const tr = useT();
    const resolvedLabel = label ?? tr('Refresh');
    return (
        <button
            type="button"
            class={`v2-icon-button${className ? ` ${className}` : ''}`}
            title={resolvedLabel}
            aria-label={resolvedLabel}
            disabled={disabled}
            onClick={() => void onClick()}
        >
            ↻
        </button>
    );
}
