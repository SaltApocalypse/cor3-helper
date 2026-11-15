import type { ComponentChildren } from 'preact';

export interface ToggleSwitchProps {
    readonly checked: boolean;
    readonly disabled?: boolean;
    readonly label: string;
    readonly onChange?: (next: boolean) => void | Promise<void>;
    readonly children?: ComponentChildren;
}

/** Shared switch used by settings and the popup helper-mode card. */
export function ToggleSwitch({ checked, disabled, label, onChange, children }: ToggleSwitchProps) {
    return (
        <button
            type="button"
            class="v2-switch"
            role="switch"
            aria-checked={checked}
            aria-label={label}
            title={label}
            disabled={disabled}
            onClick={() => void onChange?.(!checked)}
        >
            {children ?? <span />}
        </button>
    );
}
