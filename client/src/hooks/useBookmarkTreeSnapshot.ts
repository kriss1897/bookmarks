/**
 * Snapshot-based hook for the SharedWorker-managed bookmark tree
 * - Fetches a SerializedTree from the worker
 * - Refreshes on worker broadcast events (no SSE state surfaced)
 * - Proxies write operations to the worker
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SerializedTree, NodeId } from '@/lib/tree';
import { useSharedWorkerConnection } from './useSharedWorkerConnection';
import { useBroadcastChannel } from './useBroadcastChannel';
import type { BroadcastMessage } from '@/workers/sharedWorkerAPI';

type BookmarkSerializedTree = SerializedTree;

interface UseBookmarkTreeSnapshotReturn {
  tree: BookmarkSerializedTree | null;
  loading: boolean;
  error: string | null;
  connected: boolean;
  // Control
  reload: () => Promise<void>;
  reconnect: () => Promise<void>;
  // Writes
  createFolder: (params: { parentId?: NodeId; title: string; isOpen?: boolean; isLoaded?: boolean; index?: number }) => Promise<NodeId | undefined>;
  createBookmark: (params: { parentId?: NodeId; title: string; url: string; index?: number }) => Promise<NodeId | undefined>;
  removeNode: (nodeId: NodeId) => Promise<void>;
  updateNode: (params: { nodeId: NodeId; parentId?: NodeId | null; orderKey?: string }) => Promise<void>;
  toggleFolder: (folderId: NodeId, open?: boolean) => Promise<void>;
}

export const useBookmarkTreeSnapshot = (): UseBookmarkTreeSnapshotReturn => {
  const { workerProxy, isConnected, error: connectionError, reconnect } = useSharedWorkerConnection();
  const [tree, setTree] = useState<BookmarkSerializedTree | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const refreshScheduled = useRef<boolean>(false);

  const loadTree = useCallback(async () => {
    if (!workerProxy || !isConnected) return;
    setLoading(true);
    try {
      const snapshot = await workerProxy.getTree();
      setTree(snapshot);
      setError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load tree';
      setError(msg);
      // keep previous tree if any
    } finally {
      setLoading(false);
    }
  }, [workerProxy, isConnected]);

  // Debounced refresh to coalesce bursts of events
  const scheduleRefresh = useCallback(() => {
    if (refreshScheduled.current) return;
    refreshScheduled.current = true;
    // micro-delay to batch multiple broadcasts in the same tick
    setTimeout(() => {
      refreshScheduled.current = false;
      void loadTree();
    }, 30);
  }, [loadTree]);

  // Initial load when connected
  useEffect(() => {
    if (isConnected) {
      void loadTree();
    }
  }, [isConnected, loadTree]);

  // Listen to worker broadcasts that affect tree state
  useBroadcastChannel(
    'bookmarks-sync',
    useCallback((message: BroadcastMessage) => {
      switch (message.type) {
        case 'operation_processed':
        case 'hydrate_node':
        case 'root_hydrated':
        case 'tree_reloaded':
          scheduleRefresh();
          break;
        default:
          // ignore
          break;
      }
    }, [scheduleRefresh])
  );

  // Prefer exposing a single error string
  useEffect(() => {
    if (connectionError) setError(connectionError);
  }, [connectionError]);

  // Small helper to wrap worker calls
  const withWorker = useCallback(async <T>(
    action: () => Promise<T>,
    label: string
  ): Promise<T | undefined> => {
    if (!workerProxy || !isConnected) {
      setError(`SharedWorker not connected, cannot ${label}`);
      return;
    }
    try {
      const res = await action();
      return res;
    } catch (err) {
      const msg = err instanceof Error ? err.message : `Failed to ${label}`;
      setError(msg);
      throw err;
    }
  }, [workerProxy, isConnected]);

  const createFolder = useCallback<UseBookmarkTreeSnapshotReturn['createFolder']>(async (params) => {
    const actual = { ...params, parentId: params.parentId || 'root' };
    return withWorker(() => workerProxy!.createFolder(actual), 'createFolder');
  }, [withWorker, workerProxy]);

  const createBookmark = useCallback<UseBookmarkTreeSnapshotReturn['createBookmark']>(async (params) => {
    const actual = { ...params, parentId: params.parentId || 'root' };
    return withWorker(() => workerProxy!.createBookmark(actual), 'createBookmark');
  }, [withWorker, workerProxy]);

  const removeNode = useCallback<UseBookmarkTreeSnapshotReturn['removeNode']>(async (nodeId) => {
    await withWorker(() => workerProxy!.removeNode(nodeId), 'removeNode');
  }, [withWorker, workerProxy]);

  const updateNode = useCallback<UseBookmarkTreeSnapshotReturn['updateNode']>(async (params) => {
    await withWorker(() => workerProxy!.updateNode(params), 'updateNode');
  }, [withWorker, workerProxy]);

  const toggleFolder = useCallback<UseBookmarkTreeSnapshotReturn['toggleFolder']>(async (folderId, open) => {
    await withWorker(() => workerProxy!.toggleFolder(folderId, open), 'toggleFolder');
  }, [withWorker, workerProxy]);

  return {
    tree,
    loading,
    error,
    connected: isConnected,
    reload: loadTree,
    reconnect,
    createFolder,
    createBookmark,
    removeNode,
    updateNode,
    toggleFolder
  };
};

export type { UseBookmarkTreeSnapshotReturn };
