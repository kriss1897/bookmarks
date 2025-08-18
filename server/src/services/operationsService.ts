import { BookmarkRepository } from '../db/repository.js';
import type {
  Operation,
  NewOperation,
  TreeSnapshot,
  NewTreeSnapshot,
  SyncMetadata,
  NewSyncMetadata,
} from '../db/schema.js';
import { BookmarkService } from './bookmarksService.js';

export class OperationsService {
  private repository: BookmarkRepository;
  private bookmarks: BookmarkService;

  constructor() {
    this.repository = new BookmarkRepository();
    this.bookmarks = new BookmarkService(this);
  }

  // Operation operations
  async recordOperation(operationData: NewOperation): Promise<Operation> {
    return await this.repository.createOperation(operationData);
  }

  async getOperations(limit: number = 100): Promise<Operation[]> {
    return await this.repository.getOperations(limit);
  }

  async getOperationsAfter(timestamp: Date): Promise<Operation[]> {
    return await this.repository.getOperationsAfter(timestamp);
  }

  async getNodeOperations(nodeId: string): Promise<Operation[]> {
    return await this.repository.getOperationsByNode(nodeId);
  }

  async getOperationById(operationId: string) {
    return await this.repository.getOperationById(operationId);
  }

  // Tree snapshot operations
  async createSnapshot(snapshotData: NewTreeSnapshot): Promise<TreeSnapshot> {
    return await this.repository.createSnapshot(snapshotData);
  }

  async getLatestSnapshot(namespace: string): Promise<TreeSnapshot | null> {
    return await this.repository.getLatestSnapshot(namespace);
  }

  async getSnapshots(limit: number = 10): Promise<TreeSnapshot[]> {
    return await this.repository.getSnapshots(limit);
  }

  // Sync metadata operations
  async getSyncMetadata(
    deviceId: string,
    namespace: string = 'default',
  ): Promise<SyncMetadata | null> {
    return await this.repository.getSyncMetadata(deviceId, namespace);
  }

  async updateSyncMetadata(
    deviceId: string,
    data: Partial<NewSyncMetadata> & { namespace?: string },
  ): Promise<SyncMetadata> {
    return await this.repository.updateSyncMetadata(deviceId, data);
  }

  // Apply operation envelope coming from client
  async applyOperationEnvelope(
    namespace: string,
    envelope: {
      id: string;
      ts: number;
      op: { type: string; [k: string]: any };
    },
  ): Promise<{
    success: boolean;
    operationId: string;
    message?: string;
    error?: string;
    data?: any;
  }> {
    // Idempotency: if operation already exists, return success
    const existing = await this.getOperationById(envelope.id);
    if (existing) {
      return {
        success: true,
        operationId: envelope.id,
        message: 'Operation already applied',
      };
    }

    const type = envelope.op.type;
    try {
      let data: any = null;
      switch (type) {
        case 'create_folder': {
          const { id, parentId = null, title, isOpen = true, index, orderKey } = envelope.op;
          data = await this.bookmarks.createFolder(
            namespace,
            {
              id,
              parentId,
              orderKey: orderKey || undefined,
            },
            {
              title,
              isOpen,
            },
          );
          break;
        }
        case 'create_bookmark': {
          const {
            id,
            parentId = null,
            title,
            url,
            index,
            orderKey,
            description,
            favicon,
          } = envelope.op;
          data = await this.bookmarks.createBookmark(
            namespace,
            {
              id,
              parentId,
              orderKey: orderKey || undefined,
            },
            {
              title,
              url,
              description,
              favicon,
            },
          );
          break;
        }
        case 'move_node':
        case 'move_item_to_folder': {
          const { nodeId, toFolderId, index, orderKey } = envelope.op;
          data = await this.bookmarks.moveNode(namespace, nodeId, toFolderId || null, orderKey);
          break;
        }
        case 'update_node': {
          const { nodeId, parentId, orderKey } = envelope.op as any;
          if (!nodeId) throw new Error('update_node: nodeId is required');
          const existing = await this.repository.getNode(nodeId, namespace);
          if (!existing) throw new Error(`Node not found: ${nodeId}`);
          const nodeUpdates: Partial<any> = {};
          if (parentId !== undefined) nodeUpdates.parentId = parentId;
          if (orderKey !== undefined) nodeUpdates.orderKey = orderKey;
          const updated =
            existing.kind === 'folder'
              ? await this.repository.updateFolder(nodeId, nodeUpdates, {})
              : await this.repository.updateBookmark(nodeId, nodeUpdates, {});
          data = { nodeId, parentId: updated?.parentId, orderKey: updated?.orderKey };
          break;
        }
        case 'open_folder':
        case 'close_folder': {
          const folderId =
            type === 'open_folder' || type === 'close_folder' ? envelope.op.folderId : undefined;

          if (!folderId) {
            throw new Error('folderId is required for folder open/close operations');
          }

          const isOpen = type === 'open_folder';
          data = await this.bookmarks.updateNode(namespace, folderId, {}, { isOpen });
          break;
        }
        case 'remove_node': {
          const { nodeId } = envelope.op;
          const ok = await this.bookmarks.deleteNode(namespace, nodeId);
          data = { deleted: ok };
          break;
        }
        case 'mark_folder_loaded':
        case 'hydrate_node':
        case 'mark_folder_not_loaded': {
          // Client-only state ops; ignore on server
          data = { skipped: true };
          break;
        }
        default:
          return {
            success: false,
            operationId: envelope.id,
            error: `Unsupported operation type: ${type}`,
          };
      }

      // Record client-provided operation id with namespace
      await this.recordOperation({
        id: envelope.id,
        namespace,
        type: this.mapOpTypeToDbType(type),
        nodeId: this.extractNodeIdFromOp(envelope.op),
        data: JSON.stringify(envelope.op),
        timestamp: new Date(envelope.ts),
        deviceId: 'client',
        sessionId: 'client-sync',
      });

      return { success: true, operationId: envelope.id, message: 'Operation applied', data };
    } catch (err: any) {
      return { success: false, operationId: envelope.id, error: err?.message || 'Unknown error' };
    }
  }

  private mapOpTypeToDbType(type: string): 'create' | 'update' | 'delete' | 'move' {
    switch (type) {
      case 'create_folder':
      case 'create_bookmark':
        return 'create';
      case 'move_node':
      case 'move_item_to_folder':
      case 'reorder':
        return 'move';
      case 'update_node':
      case 'remove_node':
        return 'delete';
      case 'open_folder':
      case 'close_folder':
        return 'update';
      default:
        return 'update';
    }
  }

  private extractNodeIdFromOp(op: { type: string; [k: string]: any }): string {
    switch (op.type) {
      case 'create_folder':
      case 'create_bookmark':
        return op.id;
      case 'move_node':
      case 'move_item_to_folder':
        return op.nodeId;
      case 'reorder':
        return (op as any).nodeId || (op as any).folderId;
      case 'update_node':
        return (op as any).nodeId;
      case 'open_folder':
      case 'close_folder':
        return op.folderId;
      case 'remove_node':
        return op.nodeId;
      default:
        return op.id || op.nodeId || 'unknown';
    }
  }
}

export default OperationsService;
