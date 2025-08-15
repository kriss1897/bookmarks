/**
 * SharedWorker BookmarksTree component using operations-based approach
 * This fetches operations from SharedWorker and uses TreeOpsBuilder to rebuild the tree locally
 */

import React from "react";
import { useSharedWorkerOperations } from "@/hooks/useSharedWorkerOperations";
import { ReusableTreeComponent, type TreeOperations, type TreeState } from "./ReusableTreeComponent";
import { Button } from "./ui/button";
import type { BookmarkTreeNode } from '@/lib/tree/BookmarkTree';

export const SharedWorkerOperationsTree: React.FC = () => {
  const {
    tree,
    operations,
    loading,
    error,
    connected,
    operationsLoaded,
    createFolder,
    createBookmark,
    removeNode,
    moveNode,
    reorderNodes,
    toggleFolder,
    reconnect,
    reload
  } = useSharedWorkerOperations();

  const [serializedTree, setSerializedTree] = React.useState<Record<string, BookmarkTreeNode>>({});

  // Serialize the tree whenever it changes
  React.useEffect(() => {
    if (!tree?.bookmarkTree) return;

    const serializeTree = async () => {
      try {
        const nodes: Record<string, BookmarkTreeNode> = {};
        
        const addNodeRecursively = async (nodeId: string) => {
          const node = await tree.bookmarkTree.getNode(nodeId);
          if (node) {
            if (node.kind === 'folder') {
              // Get sorted children and update the node's children array
              const sortedChildren = await tree.bookmarkTree.listChildren(node.id);
              const nodeWithSortedChildren = {
                ...node,
                children: sortedChildren.map(child => child.id)
              };
              nodes[node.id] = nodeWithSortedChildren;
              
              // Recursively add children
              for (const child of sortedChildren) {
                await addNodeRecursively(child.id);
              }
            } else {
              nodes[node.id] = node;
            }
          }
        };

        await addNodeRecursively(tree.bookmarkTree.rootId);
        setSerializedTree(nodes);
      } catch (error) {
        console.error('Error serializing tree:', error);
      }
    };

    serializeTree();
  }, [tree?.bookmarkTree, operations.length]); // Use operations.length instead of operations array

  // Create state interface - memoize to prevent unnecessary re-renders
  const state: TreeState = React.useMemo(() => ({
    nodes: serializedTree,
    rootId: tree?.bookmarkTree?.rootId || 'root',
    operations
  }), [serializedTree, tree?.bookmarkTree?.rootId, operations]);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2"></div>
          <p className="text-sm text-muted-foreground">
            {connected ? 'Loading operations...' : 'Connecting to SharedWorker...'}
          </p>
          <Button onClick={reload} className="mt-2">Reload</Button>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 border border-red-300 bg-red-50 rounded">
        <p className="text-red-700 mb-2">SharedWorker Error: {error}</p>
        <div className="flex gap-2">
          <Button onClick={reconnect} variant="destructive">
            Reconnect
          </Button>
          <Button onClick={reload} variant="outline">
            Reload Operations
          </Button>
        </div>
      </div>
    );
  }

  if (!operationsLoaded || !tree) {
    return (
      <div className="p-4 border border-gray-300 rounded">
        <p className="text-gray-600">No operations loaded</p>
        <Button onClick={reload} className="mt-2">Load Operations</Button>
      </div>
    );
  }

  // Adapt TreeOpsBuilder-style operations to TreeOperations interface
  const treeOperations: TreeOperations = {
    createFolder: async (parentId: string, title = "New Folder", index?: number) => {
      await createFolder({ parentId, title, isOpen: true, index });
    },
    
    createBookmark: async (parentId: string, title?: string, url?: string, index?: number) => {
      const n = Math.floor(Math.random() * 1000);
      await createBookmark({ 
        parentId, 
        title: title || `Link ${n}`, 
        url: url || `https://example.com/${n}`,
        index
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
      if (!tree) return;
      // Since we can't easily access folder children synchronously, 
      // let's use a different approach by getting folder info async
      try {
        const folder = await tree.bookmarkTree.getNode(parentId);
        if (!folder || folder.kind !== 'folder') return;
        if (index >= folder.children.length - 1) return;
        await reorderNodes({ folderId: parentId, fromIndex: index, toIndex: index + 1 });
      } catch (error) {
        console.error('Failed to move down:', error);
      }
    },
    
    moveNode: async (nodeId: string, targetFolderId: string, index?: number) => {
      await moveNode({ nodeId, toFolderId: targetFolderId, index });
    }
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
        <span className="text-xs text-muted-foreground">
          Operations-based ({operations.length} ops) {connected ? '🟢' : '🔴'}
        </span>
        <Button onClick={reload} size="sm" variant="outline">
          Reload
        </Button>
      </div>
      
      <ReusableTreeComponent
        state={state}
        operations={treeOperations}
        title="SharedWorker Operations Tree (TreeOpsBuilder)"
        showOperationsLog={true}
        showSerializedTree={true}
        onReset={undefined} // No reset for persistent storage
      />
    </div>
  );
};
