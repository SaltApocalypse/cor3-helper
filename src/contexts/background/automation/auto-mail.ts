import type { SettingsV1 } from '../../../contracts/storage.js';
import type { MailService } from '../../../application/mail/service.js';
import type { AutomationStateStore } from '../../../infrastructure/storage/automation-state-store.js';
import type { AutomationLogger, SchedulerPort, SettingsPort } from '../../../application/automation/ports.js';
import { AUTO_MAIL_ALARM, AUTO_MAIL_RETRY_ALARM } from './alarm-ids.js';

export interface AutoMailLast {
    readonly at: number;
    readonly claimed: number;
    readonly failed: number;
    readonly stashFull: boolean;
    readonly error: string | null;
}

const TRANSIENT_MAIL_FAILURE = /no cor3\.gg tab|no game websocket|socket|timed? ?out|timeout|connection|network|bridge|mail[_\s-]?(?:busy|timeout)|not[-\s]?reachable|temporary|try again/i;

export function isTransientMailFailure(code: string, message: string): boolean {
    return code === 'MAIL_TIMEOUT' || code === 'MAIL_BUSY' || TRANSIENT_MAIL_FAILURE.test(`${code} ${message}`);
}

export interface AutoMailDeps {
    readonly settings: SettingsPort;
    readonly scheduler: SchedulerPort;
    readonly logger: AutomationLogger;
    readonly clock: { now(): number };
    readonly state: AutomationStateStore;
    readonly mail: Pick<MailService, 'claimPending'>;
    readonly isInventorySorting: () => boolean;
}

export class AutoMailCoordinator {
    private running = false;
    private last: AutoMailLast | null = null;

    constructor(private readonly deps: AutoMailDeps) {}

    isRunning(): boolean {
        return this.running;
    }

    lastRun(): AutoMailLast | null {
        return this.last;
    }

    restore(payload: Readonly<Record<string, unknown>>): void {
        const stored = payload.last;
        if (!stored || typeof stored !== 'object') return;
        const entry = stored as Partial<{ at: number; claimed: number; failed: number; stashFull: boolean; error: string | null }>;
        if (typeof entry.at === 'number' && typeof entry.claimed === 'number' && typeof entry.failed === 'number' && typeof entry.stashFull === 'boolean') {
            this.last = {
                at: entry.at,
                claimed: entry.claimed,
                failed: entry.failed,
                stashFull: entry.stashFull,
                error: typeof entry.error === 'string' ? entry.error : null,
            };
        }
    }

    async status() {
        const current = await this.deps.settings.get();
        return {
            enabled: current.mailAutoClaimEnabled,
            intervalMinutes: current.mailAutoClaimIntervalMinutes,
            running: this.running,
            last: this.last,
        };
    }

    async enable(): Promise<SettingsV1> {
        const next = await this.deps.settings.update({
            mailAutoClaimEnabled: true,
            mailAutoClaimIntervalMinutes: 45,
        });
        this.deps.scheduler.create(AUTO_MAIL_ALARM, { periodInMinutes: 45 });
        // Enabling the switch performs one immediate collection before the
        // regular 45-minute alarm takes over.
        await this.run();
        return next;
    }

    async disable(): Promise<SettingsV1> {
        const next = await this.deps.settings.update({ mailAutoClaimEnabled: false });
        await this.deps.scheduler.clear(AUTO_MAIL_ALARM);
        await this.deps.scheduler.clear(AUTO_MAIL_RETRY_ALARM);
        return next;
    }

    async run(): Promise<void> {
        if (this.running) return;
        const owner = `auto-mail:${crypto.randomUUID()}`;
        const lease = await this.deps.state.acquireLease('auto-mail', owner, 5 * 60_000);
        if (!lease) {
            this.deps.logger.info('auto-mail', 'Mailbox collect skipped: lease held by another worker');
            return;
        }
        this.running = true;
        try {
            const current = await this.deps.settings.get();
            if (!current.mailAutoClaimEnabled || current.helperMode) return;
            if (this.deps.isInventorySorting()) {
                this.deps.logger.info('auto-mail', 'Mailbox auto-collect skipped while the warehouse sorter is running');
                return;
            }
            this.deps.logger.info('auto-mail', 'Mailbox collect started');
            const result = await this.deps.mail.claimPending();
            if (result.ok) {
                this.last = {
                    at: this.deps.clock.now(),
                    claimed: result.value.claimed,
                    failed: result.value.failed.length,
                    stashFull: result.value.stashFull,
                    error: null,
                };
                this.deps.logger.info('auto-mail', 'Mailbox collect finished', {
                    claimed: result.value.claimed,
                    failed: result.value.failed.length,
                    stashFull: result.value.stashFull,
                    fallbackUsed: result.value.fallbackUsed,
                    errors: result.value.failed.map((entry) => entry.message).slice(0, 5),
                });
                if (result.value.stashFull || result.value.failed.length > 0) {
                    // v1 kept failed messages queued for a later pass instead of
                    // waiting the full 45-minute interval.
                    this.deps.scheduler.create(AUTO_MAIL_RETRY_ALARM, { when: this.deps.clock.now() + 5 * 60_000 });
                }
            } else {
                this.last = { at: this.deps.clock.now(), claimed: 0, failed: 0, stashFull: false, error: result.error.message };
                this.deps.logger.warn('auto-mail', 'Mailbox collect failed', {
                    code: result.error.code,
                    message: result.error.message,
                });
                if (isTransientMailFailure(result.error.code, result.error.message)) {
                    this.deps.scheduler.create(AUTO_MAIL_RETRY_ALARM, { when: this.deps.clock.now() + 5 * 60_000 });
                }
            }
            await this.deps.state.set('auto-mail', {
                phase: result.ok ? 'done' : 'blocked',
                lastError: result.ok ? null : result.error.message,
                payload: { last: this.last },
            });
        } finally {
            this.running = false;
            await this.deps.state.releaseLease('auto-mail', owner);
        }
    }
}
