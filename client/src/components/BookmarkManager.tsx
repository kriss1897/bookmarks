import { useState, useEffect, useCallback } from 'react';
import { useWorkerConnection } from '../hooks/useWorkerConnection';
import { bookmarkAPI } from '../services/bookmarkAPI';
import type { LocalBookmarkItem } from '../services/localDataService';
import { Button } from '@/components/ui/button';
import { LoadingSpinner } from '@/components/ui/loading-spinner';

interface BookmarkManagerProps {
  namespace: string;
}

export function BookmarkManager({ namespace }: BookmarkManagerProps) {
  const [items, setItems] = useState<LocalBookmarkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState<'folder' | 'bookmark' | null>(null);
  const { addEventListener, connect } = useWorkerConnection();

  // Form states
  const [folderName, setFolderName] = useState('');
  const [bookmarkTitle, setBookmarkTitle] = useState('');
  const [bookmarkUrl, setBookmarkUrl] = useState('');

  // Load items when component mounts or namespace changes
  const loadItems = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      console.log('Loading items for namespace:', namespace);
      const data = await bookmarkAPI.getBookmarks(namespace);
      console.log('Loaded items:', data);
      setItems(data);
    } catch (err) {
      console.error('Error loading items:', err);
      setError(err instanceof Error ? err.message : 'Failed to load items');
    } finally {
      setLoading(false);
    }
  }, [namespace]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

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
            await loadItems();
          }
        });

        // Also listen for generic events from SSE
        await addEventListener('event', async (data) => {
          const eventData = data as { namespace: string; data?: unknown };
          console.log('Received SSE event:', eventData);
          
          if (eventData.namespace === namespace) {
            console.log('SSE event received for namespace:', namespace, 'reloading items');
            // Force immediate reload on any SSE event for this namespace
            await loadItems();
          }
        });
      } catch (error) {
        console.error('Failed to setup worker connection:', error);
      }
    };

    if (namespace) {
      setupWorkerConnection();
    }
  }, [namespace, connect, addEventListener, loadItems]);

  // Add folder handler
  const addFolder = async () => {
    if (!folderName.trim()) return;
    
    try {
      setLoading(true);
      await bookmarkAPI.createFolder(namespace, { name: folderName });
      setFolderName('');
      setShowAddForm(null);
      await loadItems();
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
      await bookmarkAPI.createBookmark(namespace, { 
        title: bookmarkTitle, 
        url: bookmarkUrl 
      });
      setBookmarkTitle('');
      setBookmarkUrl('');
      setShowAddForm(null);
      await loadItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add bookmark');
    } finally {
      setLoading(false);
    }
  };

  // Toggle folder open/closed
  const toggleFolder = async (folderId: string) => {
    try {
      const folder = items.find(item => item.id === folderId && item.type === 'folder');
      if (!folder) return;
      
      await bookmarkAPI.toggleFolder(namespace, folderId, !folder.open);
      await loadItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle folder');
    }
  };

  // Toggle bookmark favorite
  const toggleFavorite = async (bookmarkId: string) => {
    try {
      const bookmark = items.find(item => item.id === bookmarkId && item.type === 'bookmark');
      if (!bookmark) return;
      
      await bookmarkAPI.toggleBookmarkFavorite(namespace, bookmarkId, !bookmark.favorite);
      await loadItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle favorite');
    }
  };

  // Delete item
  const deleteItem = async (itemId: string) => {
    if (!window.confirm('Are you sure you want to delete this item?')) return;
    
    try {
      await bookmarkAPI.deleteItem(namespace, itemId);
      await loadItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete item');
    }
  };

  if (loading && items.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          Bookmarks for "{namespace}" 
          <span className="text-sm text-gray-500 ml-2">
            (Last updated: {new Date().toLocaleTimeString()})
          </span>
        </h2>
        <div className="flex gap-2">
          <Button
            onClick={loadItems}
            variant="outline"
            size="sm"
          >
            🔄 Refresh
          </Button>
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

      {/* Items list */}
      <div className="space-y-2">
        {items.length === 0 ? (
          <div className="text-center text-gray-500 py-8">
            No bookmarks yet. Add some to get started!
          </div>
        ) : (
          items.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between rounded border p-3 hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              <div className="flex items-center gap-3">
                {item.type === 'folder' ? (
                  <button
                    onClick={() => toggleFolder(item.id)}
                    className="text-blue-600 hover:text-blue-800"
                  >
                    📁 {item.name} {item.open ? '(open)' : '(closed)'}
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => toggleFavorite(item.id)}
                      className={`text-lg ${item.favorite ? 'text-yellow-500' : 'text-gray-400'}`}
                    >
                      ⭐
                    </button>
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:text-blue-800 hover:underline"
                    >
                      {item.title || item.name}
                    </a>
                  </div>
                )}
              </div>
              <button
                onClick={() => deleteItem(item.id)}
                className="text-red-600 hover:text-red-800 px-2 py-1 rounded"
              >
                Delete
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
