import { useState, useEffect, useCallback } from 'react';
import { useSSE } from '../hooks/useSSE';
import { bookmarkAPI, type BookmarkItem } from '../services/bookmarkAPI';
import { Button } from '@/components/ui/button';
import { LoadingSpinner } from '@/components/ui/loading-spinner';

interface BookmarkManagerProps {
  namespace: string;
}

// Helper function to safely extract event data
function extractEventData(data: unknown): Record<string, unknown> | null {
  if (data && typeof data === 'object' && data !== null) {
    const obj = data as Record<string, unknown>;
    return obj.data as Record<string, unknown> || obj;
  }
  return null;
}

// Type guards for event data
function isBookmarkItem(obj: unknown): obj is BookmarkItem {
  if (typeof obj !== 'object' || obj === null) return false;
  const item = obj as Record<string, unknown>;
  return typeof item.id === 'number' &&
         typeof item.type === 'string' &&
         ['folder', 'bookmark'].includes(item.type as string);
}

function isToggleData(obj: unknown): obj is { folderId: number; open: boolean } {
  if (typeof obj !== 'object' || obj === null) return false;
  const data = obj as Record<string, unknown>;
  return typeof data.folderId === 'number' &&
         typeof data.open === 'boolean';
}

function isFavoriteData(obj: unknown): obj is { bookmarkId: number; favorite: boolean } {
  if (typeof obj !== 'object' || obj === null) return false;
  const data = obj as Record<string, unknown>;
  return typeof data.bookmarkId === 'number' &&
         typeof data.favorite === 'boolean';
}

function isDeleteData(obj: unknown): obj is { itemId: number } {
  if (typeof obj !== 'object' || obj === null) return false;
  const data = obj as Record<string, unknown>;
  return typeof data.itemId === 'number';
}

export function BookmarkManager({ namespace }: BookmarkManagerProps) {
  const [items, setItems] = useState<BookmarkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState<'folder' | 'bookmark' | null>(null);
  const { sseMessages } = useSSE();

  // Form states
  const [folderName, setFolderName] = useState('');
  const [bookmarkTitle, setBookmarkTitle] = useState('');
  const [bookmarkUrl, setBookmarkUrl] = useState('');
  const [bookmarkIcon, setBookmarkIcon] = useState('');

  // Load items when component mounts or namespace changes
  const loadItems = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await bookmarkAPI.getItems(namespace);
      setItems(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load items');
    } finally {
      setLoading(false);
    }
  }, [namespace]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  // Listen for real-time updates from offline-first worker
  useEffect(() => {
    if (sseMessages.length === 0) return;
    
    const latestMessage = sseMessages[sseMessages.length - 1];
    console.log('Received SSE message:', latestMessage);
    
    // Only process messages for our namespace
    if (latestMessage.namespace === namespace) {
      console.log('Processing message for namespace:', namespace, 'type:', latestMessage.type);
      switch (latestMessage.type) {
        case 'dataChanged': {
          // Data changed in another tab - reload from local storage
          console.log('Data changed in another tab, reloading items');
          loadItems();
          break;
        }
          
        case 'initialDataLoaded': {
          console.log('Initial data loaded from server, refreshing local view');
          // Refresh the items to show the latest server data
          loadItems();
          break;
        }
          
        case 'initialDataError': {
          const eventData = extractEventData(latestMessage.data);
          console.warn('Failed to load initial server data:', eventData?.error);
          // Continue with local data only
          break;
        }
          
        // Keep legacy SSE events for backwards compatibility (in case server still sends them)
        case 'folder_created':
        case 'bookmark_created': {
          const eventData = extractEventData(latestMessage.data);
          console.log('Legacy SSE event:', latestMessage.type, eventData);
          if (eventData && isBookmarkItem(eventData)) {
            // Check if item already exists (from optimistic update)
            setItems(prevItems => {
              const exists = prevItems.some(item => item.id === eventData.id);
              console.log('Item exists?', exists, 'for ID:', eventData.id);
              return exists ? prevItems : [...prevItems, eventData];
            });
          }
          break;
        }
          
        case 'folder_toggled': {
          const eventData = extractEventData(latestMessage.data);
          if (eventData && isToggleData(eventData)) {
            // Always apply toggle events as they might come from other clients
            setItems(prevItems => 
              prevItems.map(item => 
                item.id === eventData.folderId && item.type === 'folder' 
                  ? { ...item, open: eventData.open } 
                  : item
              )
            );
          }
          break;
        }
          
        case 'bookmark_favorite_toggled': {
          const eventData = extractEventData(latestMessage.data);
          if (eventData && isFavoriteData(eventData)) {
            // Always apply favorite events as they might come from other clients
            setItems(prevItems => 
              prevItems.map(item => 
                item.id === eventData.bookmarkId && item.type === 'bookmark' 
                  ? { ...item, favorite: eventData.favorite } 
                  : item
              )
            );
          }
          break;
        }
          
        case 'item_deleted': {
          const eventData = extractEventData(latestMessage.data);
          if (eventData && isDeleteData(eventData)) {
            // Always apply delete events as they might come from other clients
            setItems(prevItems => prevItems.filter(item => item.id !== eventData.itemId));
          }
          break;
        }
          
        case 'item_moved':
          // For move operations, we'll still refetch since it's more complex
          loadItems();
          break;
      }
    }
  }, [sseMessages, namespace, loadItems]);

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!folderName.trim()) return;

    try {
      console.log('Creating folder:', folderName, 'in namespace:', namespace);
      const newFolder = await bookmarkAPI.createFolder(namespace, { name: folderName });
      console.log('Folder created:', newFolder);
      setFolderName('');
      setShowAddForm(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create folder');
    }
  };

  const handleCreateBookmark = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bookmarkTitle.trim() || !bookmarkUrl.trim()) return;

    try {
      await bookmarkAPI.createBookmark(namespace, {
        title: bookmarkTitle,
        url: bookmarkUrl,
        icon: bookmarkIcon || undefined,
      });

      setBookmarkTitle('');
      setBookmarkUrl('');
      setBookmarkIcon('');
      setShowAddForm(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create bookmark');
    }
  };

  const handleToggleFolder = async (folderId: number) => {
    try {
      // Find current open state
      const currentItem = items.find(item => item.id === folderId && item.type === 'folder');
      const newOpenState = !currentItem?.open;
      
      await bookmarkAPI.toggleFolder(namespace, folderId, newOpenState);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle folder');
    }
  };

  const handleToggleFavorite = async (bookmarkId: number) => {
    try {
      // Find current favorite state
      const currentItem = items.find(item => item.id === bookmarkId && item.type === 'bookmark');
      const newFavoriteState = !currentItem?.favorite;
            
      await bookmarkAPI.toggleBookmarkFavorite(namespace, bookmarkId, newFavoriteState);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle favorite');
    }
  };

  const handleDeleteItem = async (itemId: number) => {
    // if (!confirm('Are you sure you want to delete this item?')) return;
    
    try {
      await bookmarkAPI.deleteItem(namespace, itemId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete item');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="w-full max-w-4xl mx-auto p-2 md:p-0">
      {/* Quick actions */}
      <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowAddForm('folder')}
        >
          + Folder
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowAddForm('bookmark')}
        >
          + Bookmark
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={loadItems}
        >
          Refresh
        </Button>
      </div>

      {error && (
        <div className="mb-4 rounded border border-red-400 bg-red-100 px-4 py-3 text-red-700">
          {error}
        </div>
      )}

      {/* Add forms */}
      {showAddForm === 'folder' && (
        <form onSubmit={handleCreateFolder} className="mb-6 rounded-lg border bg-gray-50 p-4 dark:border-neutral-800 dark:bg-neutral-900/50">
          <h3 className="mb-3 font-medium">Create New Folder</h3>
          <div className="flex gap-2">
            <input
              type="text"
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              placeholder="Folder name"
              className="flex-1 rounded-md border px-3 py-2 dark:border-neutral-700 dark:bg-neutral-950"
              autoFocus
              required
            />
            <Button type="submit">Create</Button>
            <Button 
              type="button" 
              variant="secondary" 
              onClick={() => setShowAddForm(null)}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}

      {showAddForm === 'bookmark' && (
        <form onSubmit={handleCreateBookmark} className="mb-6 rounded-lg border bg-gray-50 p-4 dark:border-neutral-800 dark:bg-neutral-900/50">
          <h3 className="mb-3 font-medium">Create New Bookmark</h3>
          <div className="grid grid-cols-1 gap-3">
            <input
              type="text"
              value={bookmarkTitle}
              onChange={(e) => setBookmarkTitle(e.target.value)}
              placeholder="Bookmark title"
              className="rounded-md border px-3 py-2 dark:border-neutral-700 dark:bg-neutral-950"
              autoFocus
              required
            />
            <input
              type="url"
              value={bookmarkUrl}
              onChange={(e) => setBookmarkUrl(e.target.value)}
              placeholder="URL (https://...)"
              className="rounded-md border px-3 py-2 dark:border-neutral-700 dark:bg-neutral-950"
              required
            />
            <input
              type="text"
              value={bookmarkIcon}
              onChange={(e) => setBookmarkIcon(e.target.value)}
              placeholder="Icon (emoji or text)"
              className="rounded-md border px-3 py-2 dark:border-neutral-700 dark:bg-neutral-950"
            />
            <div className="flex gap-2">
              <Button type="submit">Create</Button>
              <Button 
                type="button" 
                variant="secondary" 
                onClick={() => setShowAddForm(null)}
              >
                Cancel
              </Button>
            </div>
          </div>
        </form>
      )}

      {/* Items list */}
      <div className="mb-8 space-y-2">
        {items.length === 0 ? (
          <div className="py-8 text-center text-gray-500">
            No items yet. Create a folder or bookmark to get started.
          </div>
        ) : (
          items.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-3 rounded-lg border p-3 hover:bg-gray-50 dark:border-neutral-800 dark:hover:bg-neutral-900/50"
            >
              {item.type === 'folder' ? (
                <>
                  <button
                    onClick={() => handleToggleFolder(item.id)}
                    className="rounded p-1 text-lg hover:bg-gray-200 dark:hover:bg-neutral-800"
                  >
                    {item.open ? '📂' : '📁'}
                  </button>
                  <span className="flex-1 font-medium">{item.name}</span>
                  <span className="text-xs text-gray-500">folder</span>
                </>
              ) : (
                <>
                  <span className="text-lg">{item.icon || '🔗'}</span>
                  <div className="flex-1">
                    <div className="font-medium">{item.title}</div>
                    <div className="truncate text-sm text-gray-600">{item.url}</div>
                  </div>
                  <button
                    onClick={() => handleToggleFavorite(item.id)}
                    className="rounded p-1 text-lg hover:bg-gray-200 dark:hover:bg-neutral-800"
                  >
                    {item.favorite ? '⭐' : '☆'}
                  </button>
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-blue-600 hover:underline"
                  >
                    Visit
                  </a>
                </>
              )}
              <button
                onClick={() => handleDeleteItem(item.id)}
                className="rounded p-1 text-sm text-red-600 hover:bg-red-100 dark:hover:bg-red-900/20"
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
