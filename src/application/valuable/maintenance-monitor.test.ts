import { describe, expect, it } from 'vitest';
import { MaintenanceMonitor } from './maintenance-monitor.js';

describe('MaintenanceMonitor', () => {
    it('records maintenance and resolves a waiting force loop', async () => {
        const monitor = new MaintenanceMonitor();
        const waiting = monitor.waitForStarted('server-1', 1000);
        monitor.record('server-1');
        await expect(waiting).resolves.toBe(true);
        expect(monitor.hasStarted('server-1')).toBe(true);
    });

    it('resolves false on timeout and keeps unrelated servers independent', async () => {
        const monitor = new MaintenanceMonitor();
        await expect(monitor.waitForStarted('server-1', 1)).resolves.toBe(false);
        monitor.record('server-2');
        expect(monitor.hasStarted('server-1')).toBe(false);
        expect(monitor.hasStarted('server-2')).toBe(true);
    });

    it('can be cleared', () => {
        const monitor = new MaintenanceMonitor();
        monitor.record('server-1');
        monitor.clear('server-1');
        expect(monitor.hasStarted('server-1')).toBe(false);
    });
});
