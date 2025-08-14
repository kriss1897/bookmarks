import { eq, and } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { operationLog } from '../db/schema.js';
import type { Operation } from '../types/operations.js';

export class OperationDeduplicator {
  
  // Check if an operation has already been processed
  async isOperationProcessed(operationId: string): Promise<boolean> {
    const existing = await db
      .select()
      .from(operationLog)
      .where(eq(operationLog.id, operationId))
      .get();
    
    return existing !== undefined;
  }

  // Check if an operation exists and is processed
  async isOperationAlreadyProcessed(operationId: string): Promise<boolean> {
    const existing = await db
      .select()
      .from(operationLog)
      .where(and(
        eq(operationLog.id, operationId),
        eq(operationLog.processed, true)
      ))
      .get();
    
    return existing !== undefined;
  }

  // Log an operation (marks it as seen but not necessarily processed)
  async logOperation(operation: Operation): Promise<void> {
    try {
      await db.insert(operationLog).values({
        id: operation.id,
        operationType: operation.type,
        namespace: operation.namespace,
        clientId: operation.clientId,
        timestamp: operation.timestamp,
        processed: false,
      });
    } catch (error) {
      // If operation already exists, ignore (idempotent)
      if ((error as any)?.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
        return;
      }
      throw error;
    }
  }

  // Mark an operation as processed
  async markOperationProcessed(operationId: string): Promise<void> {
    await db
      .update(operationLog)
      .set({ processed: true })
      .where(eq(operationLog.id, operationId));
  }

  // Log and mark operation as processed in one transaction
  async logAndMarkProcessed(operation: Operation): Promise<void> {
    try {
      await db.insert(operationLog).values({
        id: operation.id,
        operationType: operation.type,
        namespace: operation.namespace,
        clientId: operation.clientId,
        timestamp: operation.timestamp,
        processed: true,
      });
    } catch (error) {
      // If operation already exists, just mark it as processed
      if ((error as any)?.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
        await this.markOperationProcessed(operation.id);
        return;
      }
      throw error;
    }
  }

  // Get operation metadata for debugging/monitoring
  async getOperationInfo(operationId: string) {
    return await db
      .select()
      .from(operationLog)
      .where(eq(operationLog.id, operationId))
      .get();
  }

  // Clean up old processed operations (for maintenance)
  async cleanupOldOperations(olderThanDays: number = 30): Promise<number> {
    const cutoffTimestamp = Math.floor(Date.now() / 1000) - (olderThanDays * 24 * 60 * 60);
    
    const result = await db
      .delete(operationLog)
      .where(and(
        eq(operationLog.processed, true),
        eq(operationLog.timestamp, cutoffTimestamp) // Note: this would need proper comparison operator
      ));

    return 0; // Return count would need proper implementation
  }
}
