import type { 
  Operation, 
  SyncResponse,
  CreateBookmarkPayload,
  CreateFolderPayload,
  UpdateBookmarkPayload,
  UpdateFolderPayload,
  DeleteBookmarkPayload,
  DeleteFolderPayload,
  MoveBookmarkPayload,
  MoveFolderPayload
} from '../types/operations';

// Database object interfaces
export interface StoredBookmark {
  id: string;
  name: string;
  url: string;
  parentId?: string;
  isFavorite: boolean;
  namespace: string;
  orderIndex: string;
  createdAt: number;
  updatedAt: number;
}

export interface StoredFolder {
  id: string;
  name: string;
  parentId?: string;
  isOpen: boolean;
  namespace: string;
  orderIndex: string;
  createdAt: number;
  updatedAt: number;
}

export interface FolderMetadata {
  hasLoadedChildren: boolean;
  lastLoadedAt: number;
  childrenCount: number;
}

export interface ServerItem {
  id: string;
  type: 'bookmark' | 'folder';
  namespace: string;
  parentId?: string | null;
  orderIndex?: string | null;
  createdAt: number;
  updatedAt: number;
  title?: string;
  url?: string;
  favorite?: boolean;
  name?: string;
  open?: boolean;
  children?: unknown[];
}

// Worker API interface exposed via Comlink
export interface WorkerAPI {
  // Connection management
  connect(namespace: string): Promise<void>;
  disconnect(namespace: string): Promise<void>;
  cleanup(namespace?: string): Promise<void>;
  
  // Operation queue management
  enqueueOperation(namespace: string, operation: Omit<Operation, 'clientId'>): Promise<void>;
  syncNow(namespace?: string): Promise<void>;
  subscribe(namespace: string): Promise<void>;
  getStatus(namespace?: string): Promise<WorkerStatus>;
  
  // Database operations
  getNamespaceItems(namespace: string): Promise<(StoredBookmark | StoredFolder)[]>;
  applyOperationOptimistically(operation: Operation): Promise<void>;
  getItemById(namespace: string, id: string | number): Promise<ServerItem | null>;
  reconcileWithServer(namespace: string, serverItems: ServerItem[]): Promise<void>;
  fetchInitialData(namespace: string): Promise<void>;
  
  // NEW: Incremental loading methods
  getRootItems(namespace: string): Promise<(StoredBookmark | StoredFolder)[]>;
  getFolderChildren(namespace: string, folderId: string): Promise<(StoredBookmark | StoredFolder)[]>;
  
  // Incremental data storage
  storeItem(namespace: string, item: unknown): Promise<void>;
  getFolderMetadata(namespace: string, folderId: string): Promise<FolderMetadata | null>;
  setFolderMetadata(namespace: string, folderId: string, metadata: FolderMetadata): Promise<void>;
  
  // Utility operations
  getPendingOperationsCount(namespace: string): Promise<number>;
  resetDatabase(): Promise<void>;
  
  // Event subscription
  addEventListener(event: WorkerEventType, handler: (data: unknown) => void): Promise<void>;
  removeEventListener(event: WorkerEventType, handler: (data: unknown) => void): Promise<void>;
}

export type WorkerEventType = 
  | 'dataChanged'
  | 'pendingCount'
  | 'syncStatus'
  | 'connectivityChanged'
  | 'connected'
  | 'disconnected'
  | 'reconnecting'
  | 'error'
  | 'event';

export interface WorkerStatus {
  namespace?: string;
  isOnline: boolean;
  pendingCount?: number;
  syncStatus?: string;
  clientId?: string;
}

export interface ConnectionManager {
  namespace: string;
  eventSource: EventSource | null;
  isConnecting: boolean;
  reconnectAttempt: number;
  reconnectTimeout: ReturnType<typeof setTimeout> | null;
  lastSuccessfulConnection: number | null;
  connectionStartTime: number | null;
  isStable: boolean;
  nextRetryAt: string | null;
  stabilityTimeout?: ReturnType<typeof setTimeout> | null;
}

// Re-export operation types for convenience
export type {
  Operation,
  SyncResponse,
  CreateBookmarkPayload,
  CreateFolderPayload,
  UpdateBookmarkPayload,
  UpdateFolderPayload,
  DeleteBookmarkPayload,
  DeleteFolderPayload,
  MoveBookmarkPayload,
  MoveFolderPayload
};
