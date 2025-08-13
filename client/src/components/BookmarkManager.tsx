import { useState, useEffect, useCallback } from 'react';
import { useSSE } from '../hooks/useSSE';
import { bookmarkAPI, type BookmarkItem } from '../services/bookmarkAPI';
import { Button } from '@/components/ui/button';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { EventsList } from './EventsList';

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
  const { connectionStatus, sseMessages } = useSSE();

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

  // Listen for real-time updates from SSE context
  useEffect(() => {
    if (sseMessages.length === 0) return;
    
    const latestMessage = sseMessages[sseMessages.length - 1];
    
    // Only process messages for our namespace
    if (latestMessage.namespace === namespace) {
      switch (latestMessage.type) {
        case 'folder_created':
        case 'bookmark_created': {
          const eventData = extractEventData(latestMessage.data);
          if (eventData && isBookmarkItem(eventData)) {
            // Check if item already exists (from optimistic update)
            setItems(prevItems => {
              const exists = prevItems.some(item => item.id === eventData.id);
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
      const newFolder = await bookmarkAPI.createFolder(namespace, { name: folderName });
      setFolderName('');
      setShowAddForm(null);
      
      // Optimistically add the folder to UI immediately
      setItems(prevItems => [...prevItems, newFolder]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create folder');
    }
  };

  const handleCreateBookmark = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bookmarkTitle.trim() || !bookmarkUrl.trim()) return;

    try {
      const newBookmark = await bookmarkAPI.createBookmark(namespace, {
        title: bookmarkTitle,
        url: bookmarkUrl,
        icon: bookmarkIcon || undefined,
      });
      setBookmarkTitle('');
      setBookmarkUrl('');
      setBookmarkIcon('');
      setShowAddForm(null);
      
      // Optimistically add the bookmark to UI immediately
      setItems(prevItems => [...prevItems, newBookmark]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create bookmark');
    }
  };

  const handleToggleFolder = async (folderId: number) => {
    try {
      // Optimistically update the UI first
      setItems(prevItems => 
        prevItems.map(item => 
          item.id === folderId && item.type === 'folder' 
            ? { ...item, open: !item.open } 
            : item
        )
      );
      
      await bookmarkAPI.toggleFolderState(namespace, folderId);
    } catch (err) {
      // Revert the optimistic update on error
      setItems(prevItems => 
        prevItems.map(item => 
          item.id === folderId && item.type === 'folder' 
            ? { ...item, open: !item.open } 
            : item
        )
      );
      setError(err instanceof Error ? err.message : 'Failed to toggle folder');
    }
  };

  const handleToggleFavorite = async (bookmarkId: number) => {
    try {
      // Optimistically update the UI first
      setItems(prevItems => 
        prevItems.map(item => 
          item.id === bookmarkId && item.type === 'bookmark' 
            ? { ...item, favorite: !item.favorite } 
            : item
        )
      );
      
      await bookmarkAPI.toggleBookmarkFavorite(namespace, bookmarkId);
    } catch (err) {
      // Revert the optimistic update on error
      setItems(prevItems => 
        prevItems.map(item => 
          item.id === bookmarkId && item.type === 'bookmark' 
            ? { ...item, favorite: !item.favorite } 
            : item
        )
      );
      setError(err instanceof Error ? err.message : 'Failed to toggle favorite');
    }
  };

  const handleDeleteItem = async (itemId: number) => {
    if (!confirm('Are you sure you want to delete this item?')) return;

    // Store original items before optimistic update
    const originalItems = items;
    
    try {
      // Optimistically remove the item from UI first
      setItems(prevItems => prevItems.filter(item => item.id !== itemId));
      
      await bookmarkAPI.deleteItem(namespace, itemId);
    } catch (err) {
      // Revert the optimistic update on error
      setItems(originalItems);
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
    <div className="w-full max-w-4xl mx-auto p-4">
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">
            Bookmarks - {namespace}
          </h2>
          <div className="flex gap-2">
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
        </div>

        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        {connectionStatus !== 'connected' && (
          <div className="bg-yellow-100 border border-yellow-400 text-yellow-700 px-4 py-3 rounded mb-4">
            Connection status: {connectionStatus}
          </div>
        )}
      </div>

      {/* Add forms */}
      {showAddForm === 'folder' && (
        <form onSubmit={handleCreateFolder} className="mb-6 p-4 border rounded-lg bg-gray-50">
          <h3 className="font-medium mb-3">Create New Folder</h3>
          <div className="flex gap-2">
            <input
              type="text"
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              placeholder="Folder name"
              className="flex-1 px-3 py-2 border rounded-md"
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
        <form onSubmit={handleCreateBookmark} className="mb-6 p-4 border rounded-lg bg-gray-50">
          <h3 className="font-medium mb-3">Create New Bookmark</h3>
          <div className="grid grid-cols-1 gap-3">
            <input
              type="text"
              value={bookmarkTitle}
              onChange={(e) => setBookmarkTitle(e.target.value)}
              placeholder="Bookmark title"
              className="px-3 py-2 border rounded-md"
              autoFocus
              required
            />
            <input
              type="url"
              value={bookmarkUrl}
              onChange={(e) => setBookmarkUrl(e.target.value)}
              placeholder="URL (https://...)"
              className="px-3 py-2 border rounded-md"
              required
            />
            <input
              type="text"
              value={bookmarkIcon}
              onChange={(e) => setBookmarkIcon(e.target.value)}
              placeholder="Icon (emoji or text)"
              className="px-3 py-2 border rounded-md"
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
      <div className="space-y-2 mb-8">
        {items.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            No items yet. Create a folder or bookmark to get started.
          </div>
        ) : (
          items.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-3 p-3 border rounded-lg hover:bg-gray-50"
            >
              {item.type === 'folder' ? (
                <>
                  <button
                    onClick={() => handleToggleFolder(item.id)}
                    className="text-lg hover:bg-gray-200 p-1 rounded"
                  >
                    {item.open ? '📂' : '📁'}
                  </button>
                  <span className="font-medium flex-1">{item.name}</span>
                  <span className="text-xs text-gray-500">folder</span>
                </>
              ) : (
                <>
                  <span className="text-lg">{item.icon || '🔗'}</span>
                  <div className="flex-1">
                    <div className="font-medium">{item.title}</div>
                    <div className="text-sm text-gray-600 truncate">{item.url}</div>
                  </div>
                  <button
                    onClick={() => handleToggleFavorite(item.id)}
                    className="text-lg hover:bg-gray-200 p-1 rounded"
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
                className="text-red-600 hover:bg-red-100 p-1 rounded text-sm"
              >
                Delete
              </button>
            </div>
          ))
        )}
      </div>

      {/* Events section */}
      <div className="w-full">
        <EventsList />
      </div>
    </div>
  );
}
