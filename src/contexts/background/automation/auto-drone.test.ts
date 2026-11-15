import { describe, expect, it, vi } from 'vitest';
import { settingsV1Schema } from '../../../contracts/storage.js';
import { AUTO_DRONE_RETRY_ALARM } from './alarm-ids.js';
import { AutoDroneCoordinator, isTransientDroneFailure, type AutoDroneDeps } from './auto-drone.js';

function makeCoordinator(runOnce: ReturnType<typeof vi.fn>) {
    const settings = settingsV1Schema.parse({ autoDroneEnabled: true, helperMode: false });
    const scheduler = {
        create: vi.fn(),
        clear: vi.fn(async () => undefined),
        get: vi.fn(async () => null),
    };
    const state = {
        acquireLease: vi.fn(async () => true),
        releaseLease: vi.fn(async () => undefined),
        get: vi.fn(async () => ({ payload: {} })),
        set: vi.fn(async () => undefined),
    };
    const deps = {
        settings: { get: vi.fn(async () => settings), update: vi.fn(async () => settings) },
        scheduler,
        logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        clock: { now: () => 1_000 },
        state,
        droneAuto: { runOnce },
        featureAvailability: { get: vi.fn(async () => ({ droneExpedition: true })) },
        runAutoMail: vi.fn(async () => undefined),
    } as unknown as AutoDroneDeps;
    return { coordinator: new AutoDroneCoordinator(deps), scheduler, state };
}

describe('AutoDroneCoordinator startup status', () => {
    it('classifies socket and startup failures as transient', () => {
        expect(isTransientDroneFailure('GAME_NO_SOCKET', 'No game WebSocket is available')).toBe(true);
        expect(isTransientDroneFailure('GAME_TIMEOUT', 'Timed out waiting for drone view')).toBe(true);
        expect(isTransientDroneFailure('DRONE_FAILED', 'Drone is destroyed')).toBe(false);
    });

    it('does not flash an old error after a worker restart', () => {
        const { coordinator } = makeCoordinator(vi.fn());
        coordinator.restore({ last: { at: 500, status: 'error', message: 'old error' } });
        expect(coordinator.lastRun()).toMatchObject({ status: 'error', at: 500 });
        expect(coordinator.lastViewedAt()).toBe(500);
    });

    it('records startup socket failures as waiting and schedules a retry', async () => {
        const { coordinator, scheduler } = makeCoordinator(vi.fn(async () => ({
            ok: false as const,
            error: { code: 'GAME_NO_SOCKET', message: 'No game WebSocket is available' },
        })));
        await coordinator.run();
        expect(coordinator.lastRun()).toMatchObject({
            status: 'waiting',
            message: 'No game WebSocket is available',
        });
        expect(scheduler.create).toHaveBeenCalledWith(AUTO_DRONE_RETRY_ALARM, { when: 61_000 });
    });

    it('keeps real drone failures visible as errors', async () => {
        const { coordinator } = makeCoordinator(vi.fn(async () => ({
            ok: false as const,
            error: { code: 'DRONE_FAILED', message: 'Drone action failed' },
        })));
        await coordinator.run();
        expect(coordinator.lastRun()).toMatchObject({
            status: 'error',
            message: 'Drone action failed',
        });
    });
});
