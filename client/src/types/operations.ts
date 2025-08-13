export interface Operation {
  id: string; // UUID
  clientId: string;
  namespace: string;
  type: OperationType;
  payload: OperationPayload;
  clientCreatedAt: number; // ms timestamp
  status: OperationStatus;
  retryCount?: number;
}

export const OperationType = {
  CREATE_BOOKMARK: 'CREATE_BOOKMARK',
  UPDATE_BOOKMARK: 'UPDATE_BOOKMARK', 
  DELETE_ITEM: 'DELETE_ITEM',
  CREATE_FOLDER: 'CREATE_FOLDER',
  UPDATE_FOLDER: 'UPDATE_FOLDER',
  MOVE_ITEM: 'MOVE_ITEM'
} as const;

export type OperationType = typeof OperationType[keyof typeof OperationType];

export const OperationStatus = {
  PENDING: 'pending',
  SYNCED: 'synced', 
  FAILED: 'failed'
} as const;

export type OperationStatus = typeof OperationStatus[keyof typeof OperationStatus];

// Union type for all operation payloads
export type OperationPayload = 
  | CreateBookmarkPayload
  | UpdateBookmarkPayload
  | DeleteItemPayload
  | CreateFolderPayload
  | UpdateFolderPayload
  | MoveItemPayload;

// Operation payloads for different types
export interface CreateBookmarkPayload {
  id: string; // temp ID initially
  name: string;
  url: string;
  parentId?: string;
  isFavorite?: boolean;
  orderIndex: string;
}

export interface UpdateBookmarkPayload {
  id: string;
  name?: string;
  url?: string;
  isFavorite?: boolean;
}

export interface DeleteItemPayload {
  id: string;
}

export interface CreateFolderPayload {
  id: string; // temp ID initially
  name: string;
  parentId?: string;
  orderIndex: string;
}

export interface UpdateFolderPayload {
  id: string;
  name?: string;
  isOpen?: boolean;
}

export interface MoveItemPayload {
  id: string;
  newParentId?: string;
  targetOrderIndex: string; // New order index computed on client
}

// Worker message types
export interface WorkerMessage {
  type: string;
  id?: string; // For request/response correlation
  data?: Record<string, unknown>;
}

export interface EnqueueOperationMessage extends WorkerMessage {
  type: 'enqueueOperation';
  data: {
    namespace: string;
    operation: Operation;
  };
}

export interface SyncNowMessage extends WorkerMessage {
  type: 'syncNow';
  data: {
    namespace?: string;
  };
}

export interface SubscribeMessage extends WorkerMessage {
  type: 'subscribe';
  data: {
    namespace: string;
  };
}

export interface GetStatusMessage extends WorkerMessage {
  type: 'getStatus';
  data: {
    namespace?: string;
  };
}

// Worker response types
export interface DataChangedMessage extends WorkerMessage {
  type: 'dataChanged';
  data: {
    namespace: string;
  };
}

export interface PendingCountMessage extends WorkerMessage {
  type: 'pendingCount';
  data: {
    namespace: string;
    count: number;
  };
}

export interface SyncStatusMessage extends WorkerMessage {
  type: 'syncStatus';
  data: {
    namespace: string;
    status: 'syncing' | 'synced' | 'error';
    error?: string;
  };
}

export interface ErrorMessage extends WorkerMessage {
  type: 'error';
  data: {
    reason: string;
    operationId?: string;
  };
}

// Sync API types
export interface SyncRequest {
  clientId: string;
  operations: Operation[];
}

export interface SyncResponse {
  applied: AppliedOperation[];
  updatedItems?: Record<string, unknown>[];
  serverTime: number;
}

export interface AppliedOperation {
  operationId: string;
  status: 'success' | 'rejected';
  reason?: string;
  mappedIds?: Record<string, number>; // tempId -> realId
}

// Utility functions
export function generateClientId(): string {
  const stored = localStorage.getItem('clientId');
  if (stored) return stored;
  
  const clientId = crypto.randomUUID();
  localStorage.setItem('clientId', clientId);
  return clientId;
}
