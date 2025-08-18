/**
 * BookmarkTreeView
 * Snapshot-driven tree view powered by the SharedWorker.
 * - No SSE state exposed
 * - Uses getTree() snapshots and broadcast-driven refresh
 */

import React from "react";
import { useBookmarkTreeSnapshot } from "@/hooks/useBookmarkTreeSnapshot";
import {
  TreeComponent,
  type TreeOperations,
  type TreeState,
} from "./TreeComponent";
import { Button } from "./ui/button";
import { isFolder, type BookmarkTreeNode } from "@/lib/tree/BookmarkTree";
import { generateKeyBetween } from "fractional-indexing";

export const BookmarkTreeView: React.FC = () => {
  const {
    tree,
    error,
    reload,
    reconnect,
    createFolder,
    createBookmark,
    removeNode,
    updateNode,
    toggleFolder,
  } = useBookmarkTreeSnapshot();

  const nodes = (tree?.nodes ?? {}) as Record<string, BookmarkTreeNode>;
  const rootId = tree?.rootId ?? "root";

  // Modal state for creating items
  const [createFolderModal, setCreateFolderModal] = React.useState<{
    open: boolean;
    parentId: string;
    index?: number;
    title: string;
  }>({ open: false, parentId: rootId, index: undefined, title: "" });

  const [createBookmarkModal, setCreateBookmarkModal] = React.useState<{
    open: boolean;
    parentId: string;
    index?: number;
    title: string;
    url: string;
  }>({ open: false, parentId: rootId, index: undefined, title: "", url: "" });

  // Handlers for folder modal
  const handleOpenCreateFolder = React.useCallback(
    (parentId: string, index?: number) => {
      setCreateFolderModal({ open: true, parentId, index, title: "" });
    },
    [],
  );

  const handleConfirmCreateFolder = React.useCallback(async () => {
    const { parentId, index, title } = createFolderModal;
    if (!title.trim()) return; // basic validation
    await createFolder({ parentId, title: title.trim(), isOpen: true, index });
    setCreateFolderModal((prev) => ({ ...prev, open: false }));
  }, [createFolder, createFolderModal]);

  const handleCancelCreateFolder = React.useCallback(() => {
    setCreateFolderModal((prev) => ({ ...prev, open: false }));
  }, []);

  // Handlers for bookmark modal
  const handleOpenCreateBookmark = React.useCallback(
    (parentId: string, index?: number) => {
      setCreateBookmarkModal({
        open: true,
        parentId,
        index,
        title: "",
        url: "",
      });
    },
    [],
  );

  const handleConfirmCreateBookmark = React.useCallback(async () => {
    const { parentId, index, title, url } = createBookmarkModal;
    if (!title.trim() || !url.trim()) return;
    await createBookmark({
      parentId,
      title: title.trim(),
      url: url.trim(),
      index,
    });
    setCreateBookmarkModal((prev) => ({ ...prev, open: false }));
  }, [createBookmark, createBookmarkModal]);

  const handleCancelCreateBookmark = React.useCallback(() => {
    setCreateBookmarkModal((prev) => ({ ...prev, open: false }));
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
      const childId = parent.children[index];
      const leftId = index - 2 >= 0 ? parent.children[index - 2] : null;
      const rightId = index - 1 >= 0 ? parent.children[index - 1] : null;
      const leftKey = leftId ? nodes[leftId]?.orderKey || null : null;
      const rightKey = rightId ? nodes[rightId]?.orderKey || null : null;
      const newKey = generateKeyBetween(leftKey, rightKey);
      await updateNode({ nodeId: childId, parentId, orderKey: newKey });
    },
    moveDown: async (parentId, index) => {
      const parent = nodes[parentId];
      if (!parent || !isFolder(parent)) return;
      if (index >= parent.children.length - 1) return;
      const childId = parent.children[index];
      const leftId = parent.children[index + 1] || null;
      const rightId = parent.children[index + 2] || null;
      const leftKey = leftId ? nodes[leftId]?.orderKey || null : null;
      const rightKey = rightId ? nodes[rightId]?.orderKey || null : null;
      const newKey = generateKeyBetween(leftKey, rightKey);
      await updateNode({ nodeId: childId, parentId, orderKey: newKey });
    },
    moveNode: async (nodeId, targetFolderId, index) => {
      const target = nodes[targetFolderId];
      if (!target || !isFolder(target)) return;
      const children = target.children;
      const i =
        typeof index === "number"
          ? Math.max(0, Math.min(index, children.length))
          : children.length;
      const leftId = i - 1 >= 0 ? children[i - 1] : null;
      const rightId = i < children.length ? children[i] : null;
      const leftKey = leftId ? nodes[leftId]?.orderKey || null : null;
      const rightKey = rightId ? nodes[rightId]?.orderKey || null : null;
      const newKey = generateKeyBetween(leftKey, rightKey);
      await updateNode({ nodeId, parentId: targetFolderId, orderKey: newKey });
    },
  };

  const state: TreeState = {
    nodes,
    rootId,
    operations: [], // optional; not used in snapshot view
  };

  if (error) {
    return (
      <div className="rounded border border-red-300 bg-red-50 p-4">
        <p className="mb-2 text-red-700">SharedWorker Error: {error}</p>
        <div className="flex gap-2">
          <Button
            onClick={reconnect}
            variant="destructive"
            aria-label="Reconnect to SharedWorker"
          >
            Reconnect
          </Button>
          <Button
            onClick={reload}
            variant="outline"
            aria-label="Reload tree snapshot"
          >
            Reload
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <TreeComponent
        state={state}
        operations={treeOperations}
        title="Bookmarks"
        showOperationsLog={false}
        showSerializedTree={false}
      />

      {/* Create Folder Modal */}
      {createFolderModal.open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          role="dialog"
          aria-modal="true"
          aria-label="Create folder dialog"
        >
          <div className="w-full max-w-sm rounded-lg bg-white p-4 shadow-lg">
            <h3 className="mb-3 text-lg font-semibold">Create Folder</h3>
            <label
              className="mb-1 block text-sm text-gray-700"
              htmlFor="folder-title"
            >
              Folder name
            </label>
            <input
              id="folder-title"
              type="text"
              value={createFolderModal.title}
              onChange={(e) =>
                setCreateFolderModal((prev) => ({
                  ...prev,
                  title: e.target.value,
                }))
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  void handleConfirmCreateFolder();
                }
                if (e.key === "Escape") {
                  handleCancelCreateFolder();
                }
              }}
              className="w-full rounded border px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
              placeholder="New Folder"
              autoFocus
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={handleCancelCreateFolder}
                aria-label="Cancel create folder"
                tabIndex={0}
              >
                Cancel
              </Button>
              <Button
                onClick={() => void handleConfirmCreateFolder()}
                aria-label="Create folder"
                tabIndex={0}
              >
                Create
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Create Bookmark Modal */}
      {createBookmarkModal.open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          role="dialog"
          aria-modal="true"
          aria-label="Create bookmark dialog"
        >
          <div className="w-full max-w-sm rounded-lg bg-white p-4 shadow-lg">
            <h3 className="mb-3 text-lg font-semibold">Create Bookmark</h3>
            <div className="space-y-3">
              <div>
                <label
                  className="mb-1 block text-sm text-gray-700"
                  htmlFor="bookmark-title"
                >
                  Title
                </label>
                <input
                  id="bookmark-title"
                  type="text"
                  value={createBookmarkModal.title}
                  onChange={(e) =>
                    setCreateBookmarkModal((prev) => ({
                      ...prev,
                      title: e.target.value,
                    }))
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      void handleConfirmCreateBookmark();
                    }
                    if (e.key === "Escape") {
                      handleCancelCreateBookmark();
                    }
                  }}
                  className="w-full rounded border px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  placeholder="My link"
                  autoFocus
                />
              </div>
              <div>
                <label
                  className="mb-1 block text-sm text-gray-700"
                  htmlFor="bookmark-url"
                >
                  URL
                </label>
                <input
                  id="bookmark-url"
                  type="url"
                  value={createBookmarkModal.url}
                  onChange={(e) =>
                    setCreateBookmarkModal((prev) => ({
                      ...prev,
                      url: e.target.value,
                    }))
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      void handleConfirmCreateBookmark();
                    }
                    if (e.key === "Escape") {
                      handleCancelCreateBookmark();
                    }
                  }}
                  className="w-full rounded border px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  placeholder="https://example.com"
                />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={handleCancelCreateBookmark}
                aria-label="Cancel create bookmark"
                tabIndex={0}
              >
                Cancel
              </Button>
              <Button
                onClick={() => void handleConfirmCreateBookmark()}
                aria-label="Create bookmark"
                tabIndex={0}
              >
                Create
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BookmarkTreeView;
