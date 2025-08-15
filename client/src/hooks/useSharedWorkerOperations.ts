/**
 * Hook that uses TreeBuilder with SharedWorker operations for persistence
 * This fetches operations from SharedWorker and rebuilds tree locally using TreeBuilder
 */

import { useState, useCallback, useEffect, useReducer } from 'react';
import { useSharedWorkerConnection } from './useSharedWorkerConnection';
import { useBroadcastChannel } from './useBroadcastChannel';
import { TreeBuilder, type OperationEnvelope, type TreeOperation } from '../lib/builder/treeBuilder';
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
      console.log(`Loaded ${operations.length} operations`);
      
      // Create a new builder and replay operations
      const newBuilder = new TreeBuilder({ 
        rootNode: { title: 'Bookmarks', isOpen: true }, 
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

  // Local operation execution - SEND TO SHAREDWORKER FIRST, do NOT apply locally
  const executeOperation = useCallback(async (operation: TreeOperation) => {
    try {
      console.log('Sending operation to SharedWorker:', operation.type);
      
      // Send to SharedWorker FIRST - do NOT apply locally
      // The SharedWorker will broadcast it back and we'll apply it then
      const envelope: OperationEnvelope = {
        id: crypto?.randomUUID?.() || `op-${Date.now()}-${Math.random()}`,
        ts: Date.now(),
        op: operation
      };
      
      await api.appendOperation(envelope);
      console.log('Operation sent to SharedWorker:', envelope.id);
      
      // Do NOT apply locally - wait for broadcast
      return envelope;
    } catch (err) {
      console.error('Failed to send operation to SharedWorker:', operation, err);
      throw err;
    }
  }, [api]);

  // Tree operation methods
  const createFolder = useCallback(async (params: { parentId?: string; title: string; isOpen?: boolean; index?: number }) => {
    if (!builder) return;
    const actualParams = {
      ...params,
      parentId: params.parentId || builder.bookmarkTree.rootId
    };
    console.log('Creating folder with params:', actualParams);
    return executeOperation({
      type: 'create_folder',
      ...actualParams
    });
  }, [executeOperation, builder]);

  const createBookmark = useCallback(async (params: { parentId?: string; title: string; url: string; index?: number }) => {
    if (!builder) return;
    const actualParams = {
      ...params,
      parentId: params.parentId || builder.bookmarkTree.rootId
    };
    console.log('Creating bookmark with params:', actualParams);
    return executeOperation({
      type: 'create_bookmark',
      ...actualParams
    });
  }, [executeOperation, builder]);

  const removeNode = useCallback(async (nodeId: string) => {
    return executeOperation({
      type: 'remove_node',
      nodeId
    });
  }, [executeOperation]);

  const moveNode = useCallback(async (params: { nodeId: string; toFolderId: string; index?: number }) => {
    return executeOperation({
      type: 'move_node',
      ...params
    });
  }, [executeOperation]);

  const reorderNodes = useCallback(async (params: { folderId: string; fromIndex: number; toIndex: number }) => {
    return executeOperation({
      type: 'reorder',
      ...params
    });
  }, [executeOperation]);

  const toggleFolder = useCallback(async (folderId: string, open?: boolean) => {
    return executeOperation({
      type: 'toggle_folder',
      folderId,
      open
    });
  }, [executeOperation]);

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
