import type { SettingsV1 } from '../../../contracts/storage.js';
import type { AutomationState } from '../../../infrastructure/storage/automation-state-store.js';
import type { Result } from '../../../kernel/result.js';
import { AUTO_EXPEDITION_ALARM, AUTO_EXPEDITION_RETRY_ALARM } from './alarm-ids.js';
import { ExpeditionCycle } from './expedition-cycle.js';
import type { AutoExpeditionDeps, AutoExpeditionLast, ExpeditionDecisionState, ExpeditionPreparation, ExpeditionRunState } from './expedition-types.js';

export type { AutoExpeditionLast, ExpeditionPreparation } from './expedition-types.js';

export class AutoExpeditionCoordinator {
    private readonly state: ExpeditionRunState = {
        running: false,
        last: null,
        preparation: null,
        preparationCancelled: false,
        lastViewAt: 0,
        lastDecision: null,
    };
    private readonly cycle: ExpeditionCycle;

    constructor(private readonly deps: AutoExpeditionDeps) {
        this.cycle = new ExpeditionCycle(deps, this.state);
    }

    isRunning(): boolean {
        return this.state.running;
    }

    lastRun(): AutoExpeditionLast | null {
        return this.state.last;
    }

    preparation(): ExpeditionPreparation | null {
        return this.state.preparation;
    }

    markViewSeen(): void {
        this.state.lastViewAt = this.deps.clock.now();
    }

    lastViewedAt(): number {
        return this.state.lastViewAt;
    }

    restore(state: AutomationState): void {
        const storedLast = state.payload.last;
        if (storedLast && typeof storedLast === 'object') {
            const entry = storedLast as Partial<AutoExpeditionLast>;
            if (typeof entry.at === 'number' && typeof entry.decisions === 'number' && typeof entry.launched === 'boolean') {
                this.state.last = {
                    at: entry.at,
                    decisions: entry.decisions,
                    launched: entry.launched,
                    error: typeof entry.error === 'string' ? entry.error : null,
                    ...(typeof entry.message === 'string' ? { message: entry.message } : {}),
                    ...(typeof entry.paid === 'number' ? { paid: entry.paid } : {}),
                    ...(typeof entry.selectedMerc === 'string' || entry.selectedMerc === null ? { selectedMerc: entry.selectedMerc } : {}),
                };
            }
        }
        const storedDecision = state.payload.decision;
        if (storedDecision && typeof storedDecision === 'object') {
            const entry = storedDecision as Partial<ExpeditionDecisionState>;
            if (typeof entry.id === 'string' && typeof entry.expeditionId === 'string' && Array.isArray(entry.options)) {
                this.state.lastDecision = entry as ExpeditionDecisionState;
            }
        }
        if (state.phase === 'preparing'
            && state.nextActionAt !== null
            && state.nextActionAt > this.deps.clock.now()) {
            const payload = state.payload;
            this.state.preparation = {
                id: state.runId ?? `expedition-prep-${state.startedAt}`,
                startedAt: state.startedAt || this.deps.clock.now(),
                until: state.nextActionAt,
                mercenaryName: typeof payload.mercenaryName === 'string' ? payload.mercenaryName : 'Mercenary',
                marketKey: typeof payload.marketKey === 'string' ? payload.marketKey : 'core',
                marketLabel: typeof payload.marketLabel === 'string' ? payload.marketLabel : 'CORE',
                totalCost: typeof payload.totalCost === 'number' ? payload.totalCost : 0,
                riskScore: typeof payload.riskScore === 'number' ? payload.riskScore : 0,
                insurance: payload.insurance === true,
                insuranceCost: typeof payload.insuranceCost === 'number' ? payload.insuranceCost : null,
                locationName: typeof payload.locationName === 'string' ? payload.locationName : 'Unknown location',
            };
        }
    }

    async status() {
        const current = await this.deps.settings.get();
        return {
            enabled: current.autoExpeditionEnabled,
            intervalMinutes: current.autoExpeditionIntervalMinutes,
            running: this.state.running,
            dataStale: this.state.lastViewAt === 0 || this.deps.clock.now() - this.state.lastViewAt > 5 * 60_000,
            preparation: this.state.preparation,
            last: this.state.last,
            decision: this.state.lastDecision,
        };
    }

    async enable(intervalMinutes?: number): Promise<Result<SettingsV1, { readonly code: string; readonly message: string }>> {
        const next = await this.deps.settings.update({
            autoExpeditionEnabled: true,
            ...(intervalMinutes !== undefined ? { autoExpeditionIntervalMinutes: intervalMinutes } : {}),
        });
        this.deps.scheduler.create(AUTO_EXPEDITION_ALARM, { periodInMinutes: next.autoExpeditionIntervalMinutes });
        // Apply the switch immediately; the 30 s preparation window follows.
        void this.run();
        return { ok: true, value: next };
    }

    async disable(): Promise<SettingsV1> {
        this.state.preparationCancelled = true;
        const next = await this.deps.settings.update({ autoExpeditionEnabled: false });
        await this.deps.scheduler.clear(AUTO_EXPEDITION_ALARM);
        await this.deps.scheduler.clear(AUTO_EXPEDITION_RETRY_ALARM);
        return next;
    }

    cancelPreparation(): void {
        if (this.state.preparation) {
            this.state.preparationCancelled = true;
            this.deps.logger.info('auto-expedition', 'Expedition preparation cancellation requested');
        }
    }

    /** Helper Mode / disable cancels the preparation window even before it starts. */
    cancelRun(): void {
        this.state.preparationCancelled = true;
    }

    async run(): Promise<void> {
        await this.cycle.run();
    }

    async respondDecision(expeditionId: string, messageId: string, optionId: string): Promise<Result<void, { readonly code: string; readonly message: string }>> {
        const result = await this.deps.service.respond(expeditionId, messageId, optionId);
        if (!result.ok) return result;
        const decision = this.state.lastDecision;
        if (decision && decision.id === messageId && decision.expeditionId === expeditionId) {
            this.state.lastDecision = {
                ...decision,
                chosenOptionId: optionId,
                resolvedAt: this.deps.clock.now(),
                resolvedBy: 'manual',
                autoRespondAt: null,
            };
            await this.deps.scheduler.clear(AUTO_EXPEDITION_RETRY_ALARM);
            await this.deps.state.set('auto-expedition', {
                phase: 'running',
                nextActionAt: null,
                payload: { last: this.state.last, decision: this.state.lastDecision },
            });
        }
        return result;
    }
}
