import { NetworkGraph } from '../../../domains/network/graph.js';
import type { NetworkSnapshotService } from '../../../application/network/snapshot-service.js';

export type ServerPriority = (serverName: string | null, job: { readonly serverId: string | null }) => number;

export async function buildServerPriority(snapshots: Pick<NetworkSnapshotService, 'get'>): Promise<ServerPriority> {
    const priorityByServer = new Map<string, number>();
    const idByServerName = new Map<string, string>();
    const snapshot = await snapshots.get();
    if (snapshot.ok) {
        const graph = new NetworkGraph(snapshot.value);
        for (const server of snapshot.value.servers.values()) {
            idByServerName.set(server.name, server.id);
            const route = graph.findRoute(server.id);
            priorityByServer.set(server.id, route.ok ? route.value.nodes.length : 1000);
        }
    }
    return (serverName, job) => {
        if (job.serverId) return priorityByServer.get(job.serverId) ?? 999;
        if (serverName) {
            const id = idByServerName.get(serverName);
            if (id) return priorityByServer.get(id) ?? 999;
        }
        return 998;
    };
}
