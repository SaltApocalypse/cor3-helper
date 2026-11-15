import { AutomationCard } from '../../components/AutomationCard.js';
import { DebugConsole, type DebugLogLine } from '../../components/DebugConsole.js';
import { useT } from '../../i18n-context.js';

export interface AutomationDebugCardProps {
    readonly expanded: boolean;
    readonly onOpenChange: (open: boolean) => void;
    readonly lines: readonly DebugLogLine[];
    readonly loading: boolean;
    readonly live: boolean;
    readonly onOpen: () => void | Promise<void>;
    readonly onRefresh: () => void;
    readonly onCopy: (text: string) => void | Promise<void>;
    readonly onExport: (text: string) => void;
}

/**
 * Top-level Automation debug console. It intentionally has no automation
 * switch: it aggregates logs from Auto Jobs, Auto Daily, Auto Drone, Auto
 * Expedition, mailbox collect, and other automation runs.
 */
export function AutomationDebugCard({
    expanded,
    onOpenChange,
    lines,
    loading,
    live,
    onOpen,
    onRefresh,
    onCopy,
    onExport,
}: AutomationDebugCardProps) {
    const tr = useT();
    return (
        <AutomationCard
            title={tr('Debug')}
            description={tr('Merged background and automation run logs.')}
            alwaysAvailable
            expanded={expanded}
            onOpenChange={onOpenChange}
        >
            <DebugConsole
                embedded
                lines={lines}
                loading={loading}
                live={live}
                onOpen={onOpen}
                onRefresh={onRefresh}
                onCopy={onCopy}
                onExport={onExport}
            />
        </AutomationCard>
    );
}
