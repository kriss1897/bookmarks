/**
 * Main hook for SharedWorker bookmark operations
 * Provides a clean interface by composing separated concerns
 */

import { useMemo, useCallback, useState } from 'react';
import { useSharedWorkerConnection } from './useSharedWorkerConnection';
import { useBroadcastChannel } from './useBroadcastChannel';
import { createAPIProxy } from '../workers/sharedWorkerAPI.utils';
import type { SerializedTree } from '../lib/bookmarksTree';
import type { OperationEnvelope } from '../lib/treeOps';
import type { BroadcastMessage } from '../workers/sharedWorkerAPI';

export function useSharedWorkerBookmarks() {
  const [tree, setTree] = useState<SerializedTree | null>(null);
  const [loading, setLoading] = useState(true);

  // Use separated connection management
  const { 
    workerProxy, 
    isConnected, 
    error: connectionError,
    reconnect 
  } = useSharedWorkerConnection();

  // Use separated broadcast channel management
  const {
    lastMessage,
    sendMessage,
    error: broadcastError
  } = useBroadcastChannel('bookmarks-sync');

  // Create API proxy for convenient method calls
  const api = useMemo(() => createAPIProxy(workerProxy), [workerProxy]);

  // Combined error state
  const error = connectionError || broadcastError;

  // Refresh tree data
  const refreshTree = useCallback(async () => {
    if (!workerProxy) return;
    
    try {
      console.log('Refreshing tree...'); 
      setLoading(true);
      const newTree = await api.getTree();
      setTree(newTree);
    } catch (err) {
      console.error('Failed to refresh tree:', err);
    } finally {
      setLoading(false);
    }
  }, [api, workerProxy]);

  // Handle broadcast messages for real-time updates
  const handleMessage = useCallback((message: BroadcastMessage) => {
    console.log('Received broadcast message:', message.type);
    
    switch (message.type) {
      case 'tree_reloaded':
        setTree(message.tree);
        break;
      case 'node_created':
      case 'node_updated':
      case 'node_removed':
      case 'node_moved':
      case 'operation_processed':
        // Refresh the entire tree on any change
        refreshTree();
        break;
    }
  }, [refreshTree]);

  // React to new messages
  useMemo(() => {
    if (lastMessage) {
      handleMessage(lastMessage);
    }
  }, [lastMessage, handleMessage]);

  // Load initial tree when connected
  useMemo(() => {
    console.log(JSON.stringify({ isConnected, tree, loading, refreshTree }));

    if (isConnected && !tree && !loading) {
      refreshTree();
    }
  }, [isConnected, tree, loading, refreshTree]);

  // API methods with error handling
  const createFolder = useCallback(async (params: { parentId?: string; title: string; isOpen?: boolean; index?: number }) => {
    return await api.createFolder(params);
  }, [api]);

  const createBookmark = useCallback(async (params: { parentId?: string; title: string; url: string; index?: number }) => {
    return await api.createBookmark(params);
  }, [api]);

  const removeNode = useCallback(async (nodeId: string) => {
    return await api.removeNode(nodeId);
  }, [api]);

  const moveNode = useCallback(async (params: { nodeId: string; toFolderId: string; index?: number }) => {
    return await api.moveNode(params);
  }, [api]);

  const reorderNodes = useCallback(async (params: { folderId: string; fromIndex: number; toIndex: number }) => {
    return await api.reorderNodes(params);
  }, [api]);

  const toggleFolder = useCallback(async (folderId: string, open?: boolean) => {
    return await api.toggleFolder(folderId, open);
  }, [api]);

  const getOperationLog = useCallback(async (): Promise<OperationEnvelope[]> => {
    return await api.getOperationLog();
  }, [api]);

  // Event handlers for tree operations
  const handleTreeUpdate = useCallback((updatedTree: SerializedTree) => {
    sendMessage({
      type: 'tree_reloaded',
      tree: updatedTree
    });
  }, [sendMessage]);

  return {
    // State
    tree,
    loading,
    error,
    connected: isConnected,

    // Connection management
    reconnect,

    // API methods
    createFolder,
    createBookmark,
    removeNode,
    moveNode,
    reorderNodes,
    toggleFolder,
    refreshTree,
    getOperationLog,

    // Event handling
    onTreeUpdate: handleTreeUpdate,

    // Broadcast state
    lastMessage,
    sendMessage
  };
}
