/**
 * SharedWorker BookmarksTree component using the reusable tree component
 * This uses the SharedWorker API for persistence and multi-tab sync
 */

import React from "react";
import { useSharedWorkerBookmarks } from "@/hooks/useSharedWorkerBookmarks";
import { ReusableTreeComponent, type TreeOperations, type TreeState } from "./ReusableTreeComponent";
import type { TreeNode, SerializedTree } from "@/lib/bookmarksTree";
import type { OperationEnvelope } from "@/lib/treeOps";
import { Button } from "./ui/button";

export const SharedWorkerBookmarksTree: React.FC = () => {
  const {
    tree,
    loading,
    error,
    connected,
    createFolder,
    createBookmark,
    removeNode,
    moveNode,
    reorderNodes,
    toggleFolder,
    reconnect,
    refreshTree,
    getOperationLog
  } = useSharedWorkerBookmarks();

  const [operationLog, setOperationLog] = React.useState<OperationEnvelope[]>([]);

  // Load operation log on mount and when connected
  React.useEffect(() => {
    if (connected && getOperationLog) {
      getOperationLog()
        .then(ops => setOperationLog(ops))
        .catch(err => console.error('Failed to load operation log:', err));
    }
  }, [connected, getOperationLog]);

  if (loading) {
    return <div>
      <Button onClick={refreshTree}>Refresh</Button>
    </div>
  }

  if (!connected) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2"></div>
          <p className="text-sm text-muted-foreground">Connecting to SharedWorker...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 border border-red-300 bg-red-50 rounded">
        <p className="text-red-700 mb-2">SharedWorker Error: {error}</p>
        <button 
          onClick={reconnect}
          className="px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700"
        >
          Reconnect
        </button>
      </div>
    );
  }

  if (!tree) {
    return (
      <div className="p-4 border border-gray-300 rounded">
        <p className="text-gray-600">No tree data available</p>
      </div>
    );
  }

  // Create a tree-like interface from the serialized tree data
  const treeInterface = {
    root: tree.nodes[tree.rootId],
    rootId: tree.rootId,
    getNode: (id: string): TreeNode | undefined => {
      return tree.nodes[id];
    },
    requireNode: (id: string): TreeNode => {
      const node = tree.nodes[id];
      if (!node) throw new Error(`Node ${id} not found`);
      return node;
    },
    requireFolder: (id: string): TreeNode & { kind: 'folder' } => {
      const node = treeInterface.requireNode(id);
      if (node.kind !== 'folder') throw new Error(`Node ${id} is not a folder`);
      return node as TreeNode & { kind: 'folder' };
    },
    listChildren: (folderId: string): TreeNode[] => {
      const folder = treeInterface.getNode(folderId);
      if (!folder || folder.kind !== 'folder') return [];
      return folder.children.map(childId => tree.nodes[childId]).filter(Boolean);
    },
    serialize: (): SerializedTree => tree
  };

  // Adapt SharedWorker API to TreeOperations interface
  const operations: TreeOperations = {
    createFolder: async (parentId: string, title = "New Folder") => {
      await createFolder({ parentId, title, isOpen: true });
    },
    
    createBookmark: async (parentId: string, title?: string, url?: string) => {
      const n = Math.floor(Math.random() * 1000);
      await createBookmark({ 
        parentId, 
        title: title || `Link ${n}`, 
        url: url || `https://example.com/${n}` 
      });
    },
    
    toggleFolder: async (folderId: string) => {
      await toggleFolder(folderId);
    },
    
    removeNode: async (nodeId: string) => {
      await removeNode(nodeId);
    },
    
    moveUp: async (parentId: string, index: number) => {
      if (index <= 0) return;
      await reorderNodes({ folderId: parentId, fromIndex: index, toIndex: index - 1 });
    },
    
    moveDown: async (parentId: string, index: number) => {
      const folder = treeInterface.getNode(parentId);
      if (!folder || folder.kind !== 'folder') return;
      if (!folder.children || index >= folder.children.length - 1) return;
      await reorderNodes({ folderId: parentId, fromIndex: index, toIndex: index + 1 });
    },
    
    moveNode: async (nodeId: string, targetFolderId: string, index?: number) => {
      await moveNode({ nodeId, toFolderId: targetFolderId, index });
    }
  };

  // Create state interface
  const state: TreeState = {
    tree: treeInterface,
    operations: operationLog
  };

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <div className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs ${
          connected 
            ? 'bg-green-100 text-green-800' 
            : 'bg-red-100 text-red-800'
        }`}>
          <div className={`w-2 h-2 rounded-full ${
            connected ? 'bg-green-500' : 'bg-red-500'
          }`} />
          {connected ? 'Connected' : 'Disconnected'}
        </div>
        <span className="text-xs text-muted-foreground">SharedWorker Multi-Tab Sync</span>
      </div>
      
      <ReusableTreeComponent
        state={state}
        operations={operations}
        title="SharedWorker Bookmarks (Persistent)"
        showOperationsLog={true}
        showSerializedTree={true}
        onReset={undefined} // No reset for persistent storage
      />
    </div>
  );
};
