/**
 * Hook that uses TreeBuilder with SharedWorker operations for persistence
 * This fetches operations from SharedWorker and rebuilds tree locally using TreeBuilder
 */

import { useState, useCallback, useEffect, useReducer } from 'react';
import { useSharedWorkerConnection } from './useSharedWorkerConnection';
import { useBroadcastChannel } from './useBroadcastChannel';
import { TreeBuilder, type OperationEnvelope } from '../lib/builder/treeBuilder';
import { createAPIProxy } from '../workers/sharedWorkerAPI.utils';
import type { BroadcastMessage } from '../workers/sharedWorkerAPI';

export function useSharedWorkerOperations() {
  const [builder, setBuilder] = useState<TreeBuilder | null>(null);
  const [, forceUpdate] = useReducer((c: number) => c + 1, 0);
  const [loading, setLoading] = useState(true);
  const [operationsLoaded, setOperationsLoaded] = useState(false);

  // Use separated connection management
  const { 
    workerProxy, 
    isConnected, 
    error: connectionError,
    reconnect 
  } = useSharedWorkerConnection();

  // Create API proxy for convenient method calls
  const api = createAPIProxy(workerProxy);

  // Load operations from SharedWorker and rebuild tree
  const loadOperations = useCallback(async () => {
    if (!workerProxy || !isConnected) return;
    
    try {
      console.log('Loading operations from SharedWorker...');
      setLoading(true);
      
      // Get all operations from SharedWorker
      const operations = await api.getOperationLog();
      console.log(`Loaded ${operations.length} operations from SharedWorker`);
      
      // Create a new builder and replay operations
      const newBuilder = new TreeBuilder({ 
        rootNode: { title: 'Bookmarks', id: 'root', isOpen: true }, 
        autoLoad: false 
      });
      
      // Wait for initialization
      await newBuilder.waitForInitialization();
      
      // Replay operations
      await newBuilder.replay(operations, { record: true });
      
      setBuilder(newBuilder);
      setOperationsLoaded(true);
      forceUpdate();
    } catch (err) {
      console.error('Failed to load operations:', err);
    } finally {
      setLoading(false);
    }
  }, [api, workerProxy, isConnected]);

  // Handle broadcast messages for real-time operation sync
  const handleMessage = useCallback(async (message: BroadcastMessage) => {
    console.log('Received operation broadcast:', message.type);
    
    switch (message.type) {
      case 'operation_processed':
        // Apply ALL operations (local and remote) when received from broadcast
        if (message.operation && builder) {
          try {
            console.log('Applying operation from broadcast:', message.operation.id);
            await builder.apply(message.operation, { record: true });
            forceUpdate();
          } catch (err) {
            console.error('Failed to apply broadcasted operation:', message.operation, err);
            // If we can't apply the operation, reload all operations
            loadOperations();
          }
        }
        break;
      case 'tree_reloaded':
        // Reload all operations if tree was reloaded
        loadOperations();
        break;
    }
  }, [builder, forceUpdate, loadOperations]);

  // Use separated broadcast channel management with message handler
  const {
    lastMessage,
    sendMessage,
    error: broadcastError
  } = useBroadcastChannel('bookmarks-sync', handleMessage);

  // Combined error state
  const error = connectionError || broadcastError;

  // Load operations when connected
  useEffect(() => {
    if (isConnected && !operationsLoaded) {
      loadOperations();
    }
  }, [isConnected, operationsLoaded, loadOperations]);

  // Tree operation methods - call SharedWorker methods directly
  const createFolder = useCallback(async (params: { parentId?: string; title: string; isOpen?: boolean; index?: number }) => {
    if (!isConnected || !workerProxy) {
      console.warn('SharedWorker not connected, cannot create folder');
      return;
    }
    
    const actualParams = {
      ...params,
      parentId: params.parentId || 'root' // Use 'root' as default since we don't have builder here
    };
    
    console.log('Creating folder via SharedWorker API:', actualParams);
    
    try {
      // Call SharedWorker's createFolder method directly
      const nodeId = await api.createFolder(actualParams);
      console.log('Folder created with nodeId:', nodeId);
      return nodeId;
    } catch (error) {
      console.error('Failed to create folder:', error);
      throw error;
    }
  }, [api, isConnected, workerProxy]);

  const createBookmark = useCallback(async (params: { parentId?: string; title: string; url: string; index?: number }) => {
    if (!isConnected || !workerProxy) {
      console.warn('SharedWorker not connected, cannot create bookmark');
      return;
    }
    
    const actualParams = {
      ...params,
      parentId: params.parentId || 'root' // Use 'root' as default
    };
    
    console.log('Creating bookmark via SharedWorker API:', actualParams);
    
    try {
      // Call SharedWorker's createBookmark method directly
      const nodeId = await api.createBookmark(actualParams);
      console.log('Bookmark created with nodeId:', nodeId);
      return nodeId;
    } catch (error) {
      console.error('Failed to create bookmark:', error);
      throw error;
    }
  }, [api, isConnected, workerProxy]);

  const removeNode = useCallback(async (nodeId: string) => {
    if (!isConnected || !workerProxy) {
      console.warn('SharedWorker not connected, cannot remove node');
      return;
    }
    
    console.log('Removing node via SharedWorker API:', nodeId);
    
    try {
      await api.removeNode(nodeId);
      console.log('Node removed:', nodeId);
    } catch (error) {
      console.error('Failed to remove node:', error);
      throw error;
    }
  }, [api, isConnected, workerProxy]);

  const moveNode = useCallback(async (params: { nodeId: string; toFolderId: string; index?: number }) => {
    if (!isConnected || !workerProxy) {
      console.warn('SharedWorker not connected, cannot move node');
      return;
    }
    
    console.log('Moving node via SharedWorker API:', params);
    
    try {
      await api.moveNode(params);
      console.log('Node moved:', params.nodeId);
    } catch (error) {
      console.error('Failed to move node:', error);
      throw error;
    }
  }, [api, isConnected, workerProxy]);

  const reorderNodes = useCallback(async (params: { folderId: string; fromIndex: number; toIndex: number }) => {
    if (!isConnected || !workerProxy) {
      console.warn('SharedWorker not connected, cannot reorder nodes');
      return;
    }
    
    console.log('Reordering nodes via SharedWorker API:', params);
    
    try {
      await api.reorderNodes(params);
      console.log('Nodes reordered in folder:', params.folderId);
    } catch (error) {
      console.error('Failed to reorder nodes:', error);
      throw error;
    }
  }, [api, isConnected, workerProxy]);

  const toggleFolder = useCallback(async (folderId: string, open?: boolean) => {
    if (!isConnected || !workerProxy) {
      console.warn('SharedWorker not connected, cannot toggle folder');
      return;
    }
    
    console.log('Toggling folder via SharedWorker API:', folderId, open);
    
    try {
      await api.toggleFolder(folderId, open);
      console.log('Folder toggled:', folderId);
    } catch (error) {
      console.error('Failed to toggle folder:', error);
      throw error;
    }
  }, [api, isConnected, workerProxy]);

  const getOperationLog = useCallback(async (): Promise<OperationEnvelope[]> => {
    return await api.getOperationLog();
  }, [api]);

  return {
    // Tree state - now just the BookmarkTree directly
    tree: builder ? { bookmarkTree: builder.bookmarkTree } : null,
    operations: builder?.log || [],
    
    // Connection state
    loading,
    error,
    connected: isConnected,
    operationsLoaded,

    // Connection management
    reconnect,
    reload: loadOperations,

    // Tree operations
    createFolder,
    createBookmark,
    removeNode,
    moveNode,
    reorderNodes,
    toggleFolder,
    
    // Operation management
    getOperationLog,
    
    // Broadcast state
    lastMessage,
    sendMessage
  };
}
