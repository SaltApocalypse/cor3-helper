import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { BridgeServer } from '../../infrastructure/bridge/bridge-server.js';
import type { Logger } from '../../infrastructure/logging/logger.js';

const BACKGROUND_DIR = join(process.cwd(), 'src/contexts/background');

/**
 * The background context is split into modules, but the bridge surface must
 * stay identical. This snapshot fails when a handler is lost or renamed
 * during a move. It scans source files instead of importing the background
 * entry point, because importing it would initialise Chrome globals.
 */
const EXPECTED_BRIDGE_TYPES = [
    'activity.state',
    'auth.execute',
    'auth.status',
    'auto-finish.cancel',
    'auto-finish.disable',
    'auto-finish.enable',
    'auto-finish.progress',
    'auto-finish.run',
    'auto-finish.status',
    'auto-jobs.disable',
    'auto-jobs.enable',
    'auto-jobs.snapshot',
    'auto-jobs.status',
    'automation.logs',
    'daily.autoDisable',
    'daily.autoEnable',
    'daily.autoStatus',
    'daily.cancelHack',
    'daily.hack',
    'daily.view',
    'devtools.bridgeLogs',
    'devtools.clearBridgeLogs',
    'devtools.clearLogs',
    'devtools.clearWsLogs',
    'devtools.logs',
    'devtools.snapshot',
    'devtools.wsLogs',
    'devtools.wsSend',
    'drone.autoDisable',
    'drone.autoEnable',
    'drone.autoRun',
    'drone.autoStatus',
    'drone.launch',
    'drone.repair',
    'drone.view',
    'expeditions.autoCancel',
    'expeditions.autoDisable',
    'expeditions.autoEnable',
    'expeditions.autoLaunch',
    'expeditions.autoRespond',
    'expeditions.autoRun',
    'expeditions.autoSend',
    'expeditions.autoStatus',
    'expeditions.claimRewards',
    'expeditions.configure',
    'expeditions.respond',
    'expeditions.view',
    'inventory.previewFilter',
    'inventory.sellFilter',
    'inventory.sellItem',
    'inventory.sort',
    'inventory.view',
    'job.complete',
    'job.dismiss',
    'job.dismissFailed',
    'job.history',
    'job.queue',
    'job.queueCancel',
    'job.queueProgress',
    'job.run',
    'job.syncAllMarkets',
    'job.syncMarket',
    'job.take',
    'loadout.apply',
    'loadout.equipHardware',
    'loadout.equipSoftware',
    'loadout.unequipSoftware',
    'loadout.view',
    'mail.autoDisable',
    'mail.autoEnable',
    'mail.autoRun',
    'mail.autoStatus',
    'mail.claimAll',
    'mail.claimPending',
    'mail.claimSource',
    'mail.view',
    'market.cached',
    'market.options',
    'network.diagnostics',
    'network.discover',
    'network.map',
    'network.marketPath',
    'network.marketSync',
    'network.queueStatus',
    'network.readiness',
    'network.servers',
    'network.summary',
    'overview.state',
    'settings.export',
    'settings.get',
    'settings.import',
    'settings.reset',
    'settings.update',
    'specialists.purchase',
    'specialists.view',
    'system.diagnostics',
    'system.ping',
    'system.updateCheck',
    'valuable.cancel',
    'valuable.progress',
    'valuable.report',
    'valuable.search',
    'valuable.sell',
] as const;

function sourceFiles(dir: string): string[] {
    const result: string[] = [];
    for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) {
            result.push(...sourceFiles(path));
        } else if (path.endsWith('.ts') && !path.endsWith('.test.ts')) {
            result.push(path);
        }
    }
    return result;
}

function registeredBridgeTypes(): string[] {
    const types = new Set<string>();
    for (const file of sourceFiles(BACKGROUND_DIR)) {
        const source = readFileSync(file, 'utf8');
        for (const match of source.matchAll(/\.register\(\s*'([^']+)'/g)) {
            types.add(match[1]!);
        }
    }
    return [...types].sort();
}

describe('background bridge contract', () => {
    it('keeps every registered bridge type', () => {
        expect(registeredBridgeTypes()).toEqual([...EXPECTED_BRIDGE_TYPES]);
    });

    it('exposes registered types from BridgeServer', () => {
        const logger: Logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
        const server = new BridgeServer('background', logger);
        server.register('system.ping', z.object({}).strict(), async () => ({ ok: true, value: null }));
        expect(server.listTypes()).toEqual(['system.ping']);
    });
});
