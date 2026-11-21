import type { SettingsV1 } from '../../../contracts/storage.js';
import { AutomationCard } from '../../components/AutomationCard.js';
import { useT } from '../../i18n-context.js';

export type HackToggleKey = 'autoDecryptEnabled' | 'autoIceWallEnabled' | 'autoSimpleDecryptEnabled';

export interface HackingAutomationCardProps {
    readonly settings: SettingsV1 | null;
    readonly expanded: boolean;
    readonly onOpenChange: (open: boolean) => void;
    readonly onToggle: (key: HackToggleKey) => void | Promise<void>;
}

const ROWS: readonly { key: HackToggleKey; label: string }[] = [
    { key: 'autoDecryptEnabled', label: 'Auto Terminal Hack' },
    { key: 'autoIceWallEnabled', label: 'Auto ICE Wall Hacking' },
    { key: 'autoSimpleDecryptEnabled', label: 'Auto Simple Decrypt Hacking' },
];

export function HackingAutomationCard({ settings, expanded, onOpenChange, onToggle }: HackingAutomationCardProps) {
    const tr = useT();
    return (
        <AutomationCard
            title={tr('Hacking Automation')}
            description={tr('Automatically solve hacking minigames when they appear.')}
            alwaysAvailable
            expanded={expanded}
            onOpenChange={onOpenChange}
        >
            {ROWS.map((row) => {
                const enabled = settings?.[row.key] ?? false;
                const label = tr(row.label);
                return (
                    <div key={row.key} class="v2-automation-mode">
                        <span class="v2-auto-complete-title">{label}</span>
                        <button
                            type="button"
                            class="v2-switch"
                            role="switch"
                            aria-checked={enabled}
                            aria-label={label}
                            title={enabled ? tr('Disable {name}', { name: label }) : tr('Enable {name}', { name: label })}
                            onClick={() => void onToggle(row.key)}
                        >
                            <span />
                        </button>
                    </div>
                );
            })}
        </AutomationCard>
    );
}
