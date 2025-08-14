// Operation types for the bookmark application
export type OperationType = 
  | 'CREATE_BOOKMARK' 
  | 'CREATE_FOLDER' 
  | 'UPDATE_BOOKMARK' 
  | 'UPDATE_FOLDER' 
  | 'DELETE_BOOKMARK' 
  | 'DELETE_FOLDER' 
  | 'MOVE_BOOKMARK' 
  | 'MOVE_FOLDER';

// Base operation interface
export interface Operation {
  id: string;
  type: OperationType;
  namespace: string;
  payload: OperationPayload;
  clientId: string;
  timestamp: number;
}

// Union type for all operation payloads
export type OperationPayload = 
  | CreateBookmarkPayload
  | CreateFolderPayload
  | UpdateBookmarkPayload
  | UpdateFolderPayload
  | DeleteItemPayload
  | MoveItemPayload;

// Create bookmark operation
export interface CreateBookmarkPayload {
  id: string; // Client-generated UUID
  name: string; // Will map to title
  url: string;
  parentId?: string;
  isFavorite?: boolean;
  orderIndex: string;
}

// Create folder operation
export interface CreateFolderPayload {
  id: string; // Client-generated UUID
  name: string;
  parentId?: string;
  orderIndex: string;
}

// Update bookmark operation
export interface UpdateBookmarkPayload {
  id: string;
  name?: string; // Will map to title
  url?: string;
  isFavorite?: boolean;
}

// Update folder operation
export interface UpdateFolderPayload {
  id: string;
  name?: string;
  isOpen?: boolean;
}

// Delete item operation (works for both bookmarks and folders)
export interface DeleteItemPayload {
  id: string;
}

// Move item operation (works for both bookmarks and folders)
export interface MoveItemPayload {
  id: string;
  newParentId?: string;
  targetOrderIndex: string;
}

// Sync response from server
export interface SyncResponse {
  applied: {
    operationId: string;
    status: 'success' | 'failed';
    serverId?: string;
    tempId?: string;
    error?: string;
  }[];
  updatedItems: any[];
  mappings: Record<string, string>;
  serverTimestamp: number;
}

// Validation schemas (for use with validation library)
export interface OperationValidationSchema {
  CREATE_BOOKMARK: {
    id: { required: true; type: 'string' };
    name: { required: true; type: 'string'; minLength: 1 };
    url: { required: true; type: 'string'; pattern: 'url' };
    parentId: { required: false; type: 'string' };
    isFavorite: { required: false; type: 'boolean' };
    orderIndex: { required: true; type: 'string' };
  };
  CREATE_FOLDER: {
    id: { required: true; type: 'string' };
    name: { required: true; type: 'string'; minLength: 1 };
    parentId: { required: false; type: 'string' };
    orderIndex: { required: true; type: 'string' };
  };
  UPDATE_BOOKMARK: {
    id: { required: true; type: 'string' };
    name: { required: false; type: 'string'; minLength: 1 };
    url: { required: false; type: 'string'; pattern: 'url' };
    isFavorite: { required: false; type: 'boolean' };
  };
  UPDATE_FOLDER: {
    id: { required: true; type: 'string' };
    name: { required: false; type: 'string'; minLength: 1 };
    isOpen: { required: false; type: 'boolean' };
  };
  DELETE_ITEM: {
    id: { required: true; type: 'string' };
  };
  MOVE_ITEM: {
    id: { required: true; type: 'string' };
    newParentId: { required: false; type: 'string' };
    targetOrderIndex: { required: true; type: 'string' };
  };
}
