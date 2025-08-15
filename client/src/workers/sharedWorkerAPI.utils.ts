/**
 * API helper functions for SharedWorker operations
 */

import type { SharedWorkerAPI } from '../workers/sharedWorkerAPI';
import type * as Comlink from 'comlink';

// Generic API call wrapper with error handling
async function apiCall<T extends keyof SharedWorkerAPI>(
  api: Comlink.Remote<SharedWorkerAPI> | null | undefined,
  method: T,
  ...args: Parameters<SharedWorkerAPI[T]>
): Promise<Awaited<ReturnType<SharedWorkerAPI[T]>>> {
  if (!api) {
    throw new Error('Not connected to SharedWorker');
  }
  
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return await (api[method] as any)(...args);
}

// Convenience function to create API object
export function createAPIProxy(api: Comlink.Remote<SharedWorkerAPI> | null | undefined) {
  return {
    createFolder: (params: { parentId?: string; title: string; isOpen?: boolean; index?: number }) => 
      apiCall(api, 'createFolder', params),
    createBookmark: (params: { parentId?: string; title: string; url: string; index?: number }) => 
      apiCall(api, 'createBookmark', params),
    removeNode: (nodeId: string) => 
      apiCall(api, 'removeNode', nodeId),
    moveNode: (params: { nodeId: string; toFolderId: string; index?: number }) => 
      apiCall(api, 'moveNode', params),
    reorderNodes: (params: { folderId: string; fromIndex: number; toIndex: number }) => 
      apiCall(api, 'reorderNodes', params),
    toggleFolder: (folderId: string, open?: boolean) => 
      apiCall(api, 'toggleFolder', folderId, open),
    getTree: () => 
      apiCall(api, 'getTree'),
    getNode: (nodeId: string) => 
      apiCall(api, 'getNode', nodeId),
    getChildren: (folderId: string) => 
      apiCall(api, 'getChildren', folderId),
    getOperationLog: () => 
      apiCall(api, 'getOperationLog'),
    appendOperation: (operation: Parameters<SharedWorkerAPI['appendOperation']>[0]) => 
      apiCall(api, 'appendOperation', operation)
  };
}
