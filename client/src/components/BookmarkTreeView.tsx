/**
 * BookmarkTreeView
 * Snapshot-driven tree view powered by the SharedWorker.
 * - No SSE state exposed
 * - Uses getTree() snapshots and broadcast-driven refresh
 */

import React from 'react';
import { useBookmarkTreeSnapshot } from '@/hooks/useBookmarkTreeSnapshot';
import { ReusableTreeComponent, type TreeOperations, type TreeState } from './ReusableTreeComponent';
import { Button } from './ui/button';
import { isFolder, type BookmarkTreeNode } from '@/lib/tree/BookmarkTree';
import { useNamespace } from '@/hooks/useNamespace';

export const BookmarkTreeView: React.FC = () => {
  const {
    tree,
    loading,
    error,
    connected,
    reload,
    reconnect,
    createFolder,
    createBookmark,
    removeNode,
    moveNode,
    reorderNodes,
    toggleFolder
  } = useBookmarkTreeSnapshot();

  const nodes = (tree?.nodes ?? {}) as Record<string, BookmarkTreeNode>;
  const rootId = tree?.rootId ?? 'root';
  const { selected } = useNamespace();

  // Modal state for creating items
  const [createFolderModal, setCreateFolderModal] = React.useState<{
    open: boolean;
    parentId: string;
    index?: number;
    title: string;
  }>({ open: false, parentId: rootId, index: undefined, title: '' });

  const [createBookmarkModal, setCreateBookmarkModal] = React.useState<{
    open: boolean;
    parentId: string;
    index?: number;
    title: string;
    url: string;
  }>({ open: false, parentId: rootId, index: undefined, title: '', url: '' });

  // Handlers for folder modal
  const handleOpenCreateFolder = React.useCallback((parentId: string, index?: number) => {
    setCreateFolderModal({ open: true, parentId, index, title: '' });
  }, []);

  const handleConfirmCreateFolder = React.useCallback(async () => {
    const { parentId, index, title } = createFolderModal;
    if (!title.trim()) return; // basic validation
    await createFolder({ parentId, title: title.trim(), isOpen: true, index });
    setCreateFolderModal(prev => ({ ...prev, open: false }));
  }, [createFolder, createFolderModal]);

  const handleCancelCreateFolder = React.useCallback(() => {
    setCreateFolderModal(prev => ({ ...prev, open: false }));
  }, []);

  // Handlers for bookmark modal
  const handleOpenCreateBookmark = React.useCallback((parentId: string, index?: number) => {
    setCreateBookmarkModal({ open: true, parentId, index, title: '', url: '' });
  }, []);

  const handleConfirmCreateBookmark = React.useCallback(async () => {
    const { parentId, index, title, url } = createBookmarkModal;
    if (!title.trim() || !url.trim()) return;
    await createBookmark({ parentId, title: title.trim(), url: url.trim(), index });
    setCreateBookmarkModal(prev => ({ ...prev, open: false }));
  }, [createBookmark, createBookmarkModal]);

  const handleCancelCreateBookmark = React.useCallback(() => {
    setCreateBookmarkModal(prev => ({ ...prev, open: false }));
  }, []);

  // Adapt operations to ReusableTreeComponent contract
  const treeOperations: TreeOperations = {
    createFolder: async (parentId, _title, index) => {
      handleOpenCreateFolder(parentId, index);
    },
    createBookmark: async (parentId, _title, _url, index) => {
      handleOpenCreateBookmark(parentId, index);
    },
    toggleFolder: async (folderId) => {
      await toggleFolder(folderId);
    },
    removeNode: async (nodeId) => {
      await removeNode(nodeId);
    },
    moveUp: async (parentId, index) => {
      const parent = nodes[parentId];
      if (!parent || !isFolder(parent)) return;
      if (index <= 0) return;
      await reorderNodes({ folderId: parentId, fromIndex: index, toIndex: index - 1 });
    },
    moveDown: async (parentId, index) => {
      const parent = nodes[parentId];
      if (!parent || !isFolder(parent)) return;
      if (index >= parent.children.length - 1) return;
      await reorderNodes({ folderId: parentId, fromIndex: index, toIndex: index + 1 });
    },
    moveNode: async (nodeId, targetFolderId, index) => {
      await moveNode({ nodeId, toFolderId: targetFolderId, index });
    }
  };

  const state: TreeState = {
    nodes,
    rootId,
    operations: [] // optional; not used in snapshot view
  };

  if (error) {
    return (
      <div className="p-4 border border-red-300 bg-red-50 rounded">
        <p className="text-red-700 mb-2">SharedWorker Error: {error}</p>
        <div className="flex gap-2">
          <Button onClick={reconnect} variant="destructive" aria-label="Reconnect to SharedWorker">Reconnect</Button>
          <Button onClick={reload} variant="outline" aria-label="Reload tree snapshot">Reload</Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <div className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs ${
          connected ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
        }`}>
          <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
          {connected ? 'Connected' : 'Disconnected'}
        </div>
        {selected && (
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-700">
            {selected}
          </span>
        )}
        {loading && (
          <span className="text-xs text-muted-foreground">Loading…</span>
        )}
        <Button onClick={reload} size="sm" variant="outline" className="ml-auto" aria-label="Reload tree">
          Reload
        </Button>
      </div>

      <ReusableTreeComponent
        state={state}
        operations={treeOperations}
        title="Bookmark Tree View (Snapshot)"
        showOperationsLog={false}
        showSerializedTree={true}
      />

      {/* Create Folder Modal */}
      {createFolderModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" role="dialog" aria-modal="true" aria-label="Create folder dialog">
          <div className="w-full max-w-sm rounded-lg bg-white p-4 shadow-lg">
            <h3 className="text-lg font-semibold mb-3">Create Folder</h3>
            <label className="block text-sm text-gray-700 mb-1" htmlFor="folder-title">Folder name</label>
            <input
              id="folder-title"
              type="text"
              value={createFolderModal.title}
              onChange={(e) => setCreateFolderModal(prev => ({ ...prev, title: e.target.value }))}
              onKeyDown={(e) => { if (e.key === 'Enter') { void handleConfirmCreateFolder(); } if (e.key === 'Escape') { handleCancelCreateFolder(); } }}
              className="w-full rounded border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="New Folder"
              autoFocus
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={handleCancelCreateFolder} aria-label="Cancel create folder" tabIndex={0}>Cancel</Button>
              <Button onClick={() => void handleConfirmCreateFolder()} aria-label="Create folder" tabIndex={0}>Create</Button>
            </div>
          </div>
        </div>
      )}

      {/* Create Bookmark Modal */}
      {createBookmarkModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" role="dialog" aria-modal="true" aria-label="Create bookmark dialog">
          <div className="w-full max-w-sm rounded-lg bg-white p-4 shadow-lg">
            <h3 className="text-lg font-semibold mb-3">Create Bookmark</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm text-gray-700 mb-1" htmlFor="bookmark-title">Title</label>
                <input
                  id="bookmark-title"
                  type="text"
                  value={createBookmarkModal.title}
                  onChange={(e) => setCreateBookmarkModal(prev => ({ ...prev, title: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter') { void handleConfirmCreateBookmark(); } if (e.key === 'Escape') { handleCancelCreateBookmark(); } }}
                  className="w-full rounded border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="My link"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm text-gray-700 mb-1" htmlFor="bookmark-url">URL</label>
                <input
                  id="bookmark-url"
                  type="url"
                  value={createBookmarkModal.url}
                  onChange={(e) => setCreateBookmarkModal(prev => ({ ...prev, url: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter') { void handleConfirmCreateBookmark(); } if (e.key === 'Escape') { handleCancelCreateBookmark(); } }}
                  className="w-full rounded border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="https://example.com"
                />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={handleCancelCreateBookmark} aria-label="Cancel create bookmark" tabIndex={0}>Cancel</Button>
              <Button onClick={() => void handleConfirmCreateBookmark()} aria-label="Create bookmark" tabIndex={0}>Create</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BookmarkTreeView;
