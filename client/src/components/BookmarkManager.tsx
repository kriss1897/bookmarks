import { useState, useEffect, useCallback } from 'react';
import { useWorkerConnection } from '../hooks/useWorkerConnection';
import { bookmarkAPI } from '../services/bookmarkAPI';
import type { LocalBookmarkItem } from '../services/localDataService';
import { Button } from '@/components/ui/button';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { MoveToFolderModal } from './MoveToFolderModal';
import { BookmarkTreeNode } from './BookmarkTreeNode';
import { generateKeyBetween } from 'fractional-indexing';

interface BookmarkManagerProps {
  namespace: string;
}

export function BookmarkManager({ namespace }: BookmarkManagerProps) {
  const [rootItems, setRootItems] = useState<LocalBookmarkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState<'folder' | 'bookmark' | null>(null);
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [itemToMove, setItemToMove] = useState<LocalBookmarkItem | null>(null);
  const [loadingFolders, setLoadingFolders] = useState<Set<string>>(new Set());
  const { addEventListener, connect } = useWorkerConnection();

  // Form states
  const [folderName, setFolderName] = useState('');
  const [bookmarkTitle, setBookmarkTitle] = useState('');
  const [bookmarkUrl, setBookmarkUrl] = useState('');

  // Load only root items initially
  const loadRootItems = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      console.log('Loading root items for namespace:', namespace);
      const data = await bookmarkAPI.getRootItemsOnly(namespace);
      console.log('Loaded root items:', data);
      setRootItems(data);
    } catch (err) {
      console.error('Error loading root items:', err);
      setError(err instanceof Error ? err.message : 'Failed to load root items');
    } finally {
      setLoading(false);
    }
  }, [namespace]);

  // Helper function to recursively update folder with children
  const updateFolderWithChildren = useCallback((items: LocalBookmarkItem[], folderId: string, children: LocalBookmarkItem[]): LocalBookmarkItem[] => {
    return items.map(item => {
      if (item.id === folderId && item.type === 'folder') {
        return { ...item, children };
      } else if (item.type === 'folder' && item.children) {
        return { ...item, children: updateFolderWithChildren(item.children, folderId, children) };
      }
      return item;
    });
  }, []);

  // Load children for a specific folder
  const loadFolderChildren = useCallback(async (folderId: string) => {
    try {
      setLoadingFolders(prev => new Set([...prev, folderId]));
      console.log(`Loading children for folder ${folderId}`);
      
      const children = await bookmarkAPI.loadFolderContents(namespace, folderId);
      console.log(`Loaded ${children.length} children for folder ${folderId}:`, children);
      
      // Update the folder in rootItems to include children
      setRootItems(prevItems => updateFolderWithChildren(prevItems, folderId, children));
      
    } catch (err) {
      console.error(`Error loading children for folder ${folderId}:`, err);
      setError(err instanceof Error ? err.message : 'Failed to load folder contents');
    } finally {
      setLoadingFolders(prev => {
        const newSet = new Set(prev);
        newSet.delete(folderId);
        return newSet;
      });
    }
  }, [namespace, updateFolderWithChildren]);

  useEffect(() => {
    loadRootItems();
  }, [loadRootItems]);

  // Connect to worker when namespace changes and listen for data changes
  useEffect(() => {
    const setupWorkerConnection = async () => {
      try {
        // Connect to namespace
        await connect(namespace);

        // Listen for data changes
        await addEventListener('dataChanged', async (data) => {
          const eventData = data as { namespace: string; type?: string; itemCount?: number };
          console.log('Received dataChanged event:', eventData);
          
          if (eventData.namespace === namespace) {
            console.log('Data changed in namespace:', namespace, 'reloading items');
            // Force immediate reload
            // await loadItems();
          }
        });

        // Also listen for generic events from SSE
        await addEventListener('event', async (data) => {
          const eventData = data as { namespace: string; data?: unknown };
          console.log('Received SSE event:', eventData);
          
          if (eventData.namespace === namespace) {
            console.log('SSE event received for namespace:', namespace, 'reloading root items');
            // Force immediate reload on any SSE event for this namespace
            await loadRootItems();
          }
        });
      } catch (error) {
        console.error('Failed to setup worker connection:', error);
      }
    };

    if (namespace) {
      setupWorkerConnection();
    }
  }, [namespace, connect, addEventListener, loadRootItems]);

  // Add folder handler
  const addFolder = async () => {
    if (!folderName.trim()) return;
    
    try {
      setLoading(true);
      // Compute an orderIndex at the end of roots
      const rootOnlyItems = rootItems.filter((i: LocalBookmarkItem) => !i.parentId);
      const last = rootOnlyItems[rootOnlyItems.length - 1];
      const orderIndex = last ? generateKeyBetween(last.orderIndex, null) : generateKeyBetween(null, null);
      await bookmarkAPI.createFolder(namespace, { name: folderName, orderIndex });
      setFolderName('');
      setShowAddForm(null);
      await loadRootItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add folder');
    } finally {
      setLoading(false);
    }
  };

  // Add bookmark handler
  const addBookmark = async () => {
    if (!bookmarkTitle.trim() || !bookmarkUrl.trim()) return;
    
    try {
      setLoading(true);
      const rootOnlyItems = rootItems.filter((i: LocalBookmarkItem) => !i.parentId);
      const last = rootOnlyItems[rootOnlyItems.length - 1];
      const orderIndex = last ? generateKeyBetween(last.orderIndex, null) : generateKeyBetween(null, null);
      await bookmarkAPI.createBookmark(namespace, { 
        title: bookmarkTitle, 
        url: bookmarkUrl,
        orderIndex
      });
      setBookmarkTitle('');
      setBookmarkUrl('');
      setShowAddForm(null);
      await loadRootItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add bookmark');
    } finally {
      setLoading(false);
    }
  };

  // Toggle folder open/closed - now includes lazy loading
  const toggleFolder = async (folderId: string) => {
    try {
      // Find the folder in our tree structure
      const folder = findItemInTree(rootItems, folderId);
      if (!folder || folder.type !== 'folder') return;
      
      if (!folder.open) {
        // Load children if folder is being opened
        await loadFolderChildren(folderId);
      }
      
      await bookmarkAPI.toggleFolder(namespace, folderId, !folder.open);
      await loadRootItems(); // Refresh to get updated state
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle folder');
    }
  };

  // Toggle bookmark favorite
  const toggleFavorite = async (bookmarkId: string) => {
    try {
      const bookmark = findItemInTree(rootItems, bookmarkId);
      if (!bookmark || bookmark.type !== 'bookmark') return;
      
      await bookmarkAPI.toggleBookmarkFavorite(namespace, bookmarkId, !bookmark.favorite);
      await loadRootItems(); // Refresh to get updated state
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle favorite');
    }
  };

  // Delete item
  const deleteItem = async (itemId: string) => {
    if (!window.confirm('Are you sure you want to delete this item?')) return;
    
    try {
      await bookmarkAPI.deleteItem(namespace, itemId);
      await loadRootItems(); // Refresh tree
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete item');
    }
  };

  // Helper function to find item in tree structure
  const findItemInTree = (items: LocalBookmarkItem[], targetId: string): LocalBookmarkItem | null => {
    for (const item of items) {
      if (item.id === targetId) {
        return item;
      }
      if (item.type === 'folder' && item.children) {
        const found = findItemInTree(item.children, targetId);
        if (found) return found;
      }
    }
    return null;
  };

  // Move item up - simplified for now
  const moveItemUp = async (index: number) => {
    // TODO: Implement for hierarchical structure
    console.log('Move up not yet implemented for hierarchical structure', index);
  };

  // Move item down - simplified for now
  const moveItemDown = async (index: number) => {
    // TODO: Implement for hierarchical structure
    console.log('Move down not yet implemented for hierarchical structure', index);
  };

  // Open move to folder modal
  const openMoveModal = (item: LocalBookmarkItem) => {
    setItemToMove(item);
    setShowMoveModal(true);
  };

  // Move item to folder
  const moveItemToFolder = async (targetFolderId: string | null) => {
    if (!itemToMove) return;

    try {
      setLoading(true);
      
      // For now, use a simple approach - we'll improve this when we implement full hierarchical move
      const targetOrderIndex = generateKeyBetween(null, null);

      await bookmarkAPI.moveItem(namespace, itemToMove.id, targetFolderId || undefined, targetOrderIndex);
      await loadRootItems(); // Refresh tree
      setItemToMove(null);
      setShowMoveModal(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to move item to folder');
    } finally {
      setLoading(false);
    }
  };

  // Get all folders for move modal (flatten the tree structure)
  const getAllFolders = (items: LocalBookmarkItem[]): LocalBookmarkItem[] => {
    const folders: LocalBookmarkItem[] = [];
    
    const collectFolders = (nodeItems: LocalBookmarkItem[]) => {
      for (const item of nodeItems) {
        if (item.type === 'folder') {
          folders.push(item);
          if (item.children) {
            collectFolders(item.children);
          }
        }
      }
    };
    
    collectFolders(items);
    return folders;
  };

  if (loading && rootItems.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <Button
            onClick={() => setShowAddForm('folder')}
            variant="outline"
            size="sm"
          >
            Add Folder
          </Button>
          <Button
            onClick={() => setShowAddForm('bookmark')}
            variant="outline"
            size="sm"
          >
            Add Bookmark
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 p-4 text-red-700 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Add forms */}
      {showAddForm === 'folder' && (
        <div className="rounded-md border p-4">
          <h3 className="mb-2 font-medium">Add New Folder</h3>
          <div className="flex gap-2">
            <input
              type="text"
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              placeholder="Folder name"
              className="flex-1 rounded border px-3 py-2"
              onKeyDown={(e) => e.key === 'Enter' && addFolder()}
            />
            <Button onClick={addFolder} disabled={!folderName.trim()}>
              Add
            </Button>
            <Button variant="outline" onClick={() => setShowAddForm(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {showAddForm === 'bookmark' && (
        <div className="rounded-md border p-4">
          <h3 className="mb-2 font-medium">Add New Bookmark</h3>
          <div className="space-y-2">
            <input
              type="text"
              value={bookmarkTitle}
              onChange={(e) => setBookmarkTitle(e.target.value)}
              placeholder="Bookmark title"
              className="w-full rounded border px-3 py-2"
            />
            <input
              type="url"
              value={bookmarkUrl}
              onChange={(e) => setBookmarkUrl(e.target.value)}
              placeholder="Bookmark URL"
              className="w-full rounded border px-3 py-2"
              onKeyDown={(e) => e.key === 'Enter' && addBookmark()}
            />
            <div className="flex gap-2">
              <Button onClick={addBookmark} disabled={!bookmarkTitle.trim() || !bookmarkUrl.trim()}>
                Add
              </Button>
              <Button variant="outline" onClick={() => setShowAddForm(null)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Items list - now hierarchical */}
      <div className="space-y-2">
        {rootItems.length === 0 ? (
          <div className="text-center text-gray-500 py-8">
            No bookmarks yet. Add some to get started!
          </div>
        ) : (
          rootItems.map((item, index) => (
            <BookmarkTreeNode
              key={item.id}
              item={item}
              namespace={namespace}
              level={0}
              index={index}
              onLoadChildren={loadFolderChildren}
              onToggleFolder={toggleFolder}
              onToggleFavorite={toggleFavorite}
              onDeleteItem={deleteItem}
              onMoveUp={moveItemUp}
              onMoveDown={moveItemDown}
              onOpenMoveModal={openMoveModal}
              isLoadingChildren={loadingFolders.has(item.id)}
              totalSiblingsCount={rootItems.length}
            />
          ))
        )}
      </div>

      {/* Move to Folder Modal */}
      <MoveToFolderModal
        isOpen={showMoveModal}
        onClose={() => {
          setShowMoveModal(false);
          setItemToMove(null);
        }}
        onMove={moveItemToFolder}
        item={itemToMove}
        folders={getAllFolders(rootItems)}
        loading={loading}
      />
    </div>
  );
}
