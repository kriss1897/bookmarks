// Operation types for the bookmark application (matches server)
export type OperationType = 
  | 'createBookmark' 
  | 'createFolder' 
  | 'updateBookmark' 
  | 'updateFolder' 
  | 'deleteBookmark' 
  | 'deleteFolder' 
  | 'moveBookmark' 
  | 'moveFolder';

// Base operation interface (matches server)
export interface Operation {
  id: string;
  type: OperationType;
  namespace: string;
  payload: OperationPayload;
  clientId: string;
  timestamp: number;
}

// Union type for all operation payloads (matches server)
export type OperationPayload = 
  | CreateBookmarkPayload
  | CreateFolderPayload
  | UpdateBookmarkPayload
  | UpdateFolderPayload
  | DeleteBookmarkPayload
  | DeleteFolderPayload
  | MoveBookmarkPayload
  | MoveFolderPayload;

// Create bookmark operation (matches server)
export interface CreateBookmarkPayload {
  id: string; // Client-generated UUID
  name: string; // Will map to title
  url: string;
  parentId?: string;
  isFavorite?: boolean;
  orderIndex: string;
}

// Create folder operation (matches server)
export interface CreateFolderPayload {
  id: string; // Client-generated UUID
  name: string;
  parentId?: string;
  orderIndex: string;
}

// Update bookmark operation (matches server)
export interface UpdateBookmarkPayload {
  id: string;
  name?: string; // Will map to title
  url?: string;
  isFavorite?: boolean;
}

// Update folder operation (matches server)
export interface UpdateFolderPayload {
  id: string;
  name?: string;
  isOpen?: boolean;
}

// Delete bookmark operation (matches server)
export interface DeleteBookmarkPayload {
  id: string;
}

// Delete folder operation (matches server)
export interface DeleteFolderPayload {
  id: string;
}

// Move bookmark operation (matches server)
export interface MoveBookmarkPayload {
  id: string;
  newParentId?: string;
  targetOrderIndex: string;
}

// Move folder operation (matches server)
export interface MoveFolderPayload {
  id: string;
  newParentId?: string;
  targetOrderIndex: string;
}

// Sync response from server (matches server)
export interface SyncResponse {
  applied: {
    operationId: string;
    status: 'success' | 'failed';
    serverId?: string;
    tempId?: string;
    error?: string;
    data?: unknown; // Server response data (e.g., created item)
    duplicate?: boolean; // Whether operation was already processed
  }[];
  updatedItems: Record<string, unknown>[];
  mappings: Record<string, string>;
  serverTimestamp: number;
}

// Client-specific extensions for operation queue
export interface QueuedOperation extends Operation {
  status: OperationStatus;
  retryCount?: number;
  queuedAt: number; // When operation was queued locally
}

export const OperationStatus = {
  PENDING: 'pending',
  SYNCING: 'syncing',
  SYNCED: 'synced', 
  FAILED: 'failed'
} as const;

export type OperationStatus = typeof OperationStatus[keyof typeof OperationStatus];

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
    operation: Omit<Operation, 'clientId'>; // clientId added by worker
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
    type?: 'serverUpdate' | 'localUpdate';
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

// Utility functions
export function generateClientId(): string {
  const stored = localStorage.getItem('clientId');
  if (stored) return stored;
  
  const clientId = crypto.randomUUID();
  localStorage.setItem('clientId', clientId);
  return clientId;
}
