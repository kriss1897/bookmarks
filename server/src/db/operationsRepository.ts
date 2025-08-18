import { desc, eq, and } from 'drizzle-orm';
import { db } from './index.js';
import { operations, treeSnapshots, syncMetadata } from './schema.js';
import type {
  Operation,
  NewOperation,
  TreeSnapshot,
  NewTreeSnapshot,
  SyncMetadata,
  NewSyncMetadata,
} from './schema.js';

export class OperationsRepository {
  async createOperation(operationData: NewOperation): Promise<Operation> {
    const [operation] = await db.insert(operations).values(operationData).returning();
    return operation;
  }

  async getOperations(limit: number = 100): Promise<Operation[]> {
    return await db.select().from(operations).orderBy(desc(operations.timestamp)).limit(limit);
  }

  async getOperationsAfter(timestamp: Date): Promise<Operation[]> {
    return await db
      .select()
      .from(operations)
      .where(eq(operations.timestamp, timestamp))
      .orderBy(operations.timestamp);
  }

  async getOperationsByNode(nodeId: string): Promise<Operation[]> {
    return await db
      .select()
      .from(operations)
      .where(eq(operations.nodeId, nodeId))
      .orderBy(desc(operations.timestamp));
  }

  async getOperationById(operationId: string): Promise<Operation | null> {
    const [op] = await db.select().from(operations).where(eq(operations.id, operationId));
    return op || null;
  }

  async createSnapshot(snapshotData: NewTreeSnapshot): Promise<TreeSnapshot> {
    const [snapshot] = await db.insert(treeSnapshots).values(snapshotData).returning();
    return snapshot;
  }

  async getLatestSnapshot(namespace: string): Promise<TreeSnapshot | null> {
    const [snapshot] = await db
      .select()
      .from(treeSnapshots)
      .where(eq(treeSnapshots.namespace, namespace))
      .orderBy(desc(treeSnapshots.timestamp))
      .limit(1);
    return snapshot || null;
  }

  async getSnapshots(limit: number = 10): Promise<TreeSnapshot[]> {
    return await db
      .select()
      .from(treeSnapshots)
      .orderBy(desc(treeSnapshots.timestamp))
      .limit(limit);
  }

  async getSyncMetadata(
    deviceId: string,
    namespace: string = 'default',
  ): Promise<SyncMetadata | null> {
    const [metadata] = await db
      .select()
      .from(syncMetadata)
      .where(and(eq(syncMetadata.deviceId, deviceId), eq(syncMetadata.namespace, namespace)));
    return metadata || null;
  }

  async updateSyncMetadata(
    deviceId: string,
    data: Partial<NewSyncMetadata> & { namespace?: string },
  ): Promise<SyncMetadata> {
    const namespace = data.namespace || 'default';
    const existing = await this.getSyncMetadata(deviceId, namespace);

    if (existing) {
      const [updated] = await db
        .update(syncMetadata)
        .set(data)
        .where(and(eq(syncMetadata.deviceId, deviceId), eq(syncMetadata.namespace, namespace)))
        .returning();
      return updated;
    } else {
      const [created] = await db
        .insert(syncMetadata)
        .values({
          id: `sync-${deviceId}-${Date.now()}`,
          deviceId,
          namespace,
          ...data,
        })
        .returning();
      return created;
    }
  }
}
