// Types matching the server
export interface BookmarkItem {
  id: number;
  type: 'folder' | 'bookmark';
  namespace: string;
  parentId: number | null;
  prevSiblingId: number | null;
  nextSiblingId: number | null;
  createdAt: number;
  updatedAt: number;
  // Folder-specific fields
  name?: string;
  open?: boolean;
  // Bookmark-specific fields
  title?: string;
  url?: string;
  icon?: string;
  favorite?: boolean;
}

export interface CreateFolderRequest {
  name: string;
  parentId?: number;
}

export interface CreateBookmarkRequest {
  title: string;
  url: string;
  icon?: string;
  parentId?: number;
}

export interface MoveItemRequest {
  newParentId?: number;
  afterItemId?: number;
}

// API service for bookmarks
export class BookmarkAPI {
  private baseUrl = '/api/bookmarks';

  async getItems(namespace: string, parentId?: number): Promise<BookmarkItem[]> {
    const url = parentId 
      ? `${this.baseUrl}/${namespace}?parentId=${parentId}`
      : `${this.baseUrl}/${namespace}`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error || 'Failed to get items');
    }
    
    return data.data;
  }

  async createFolder(namespace: string, request: CreateFolderRequest): Promise<BookmarkItem> {
    const response = await fetch(`${this.baseUrl}/${namespace}/folders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    
    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error || 'Failed to create folder');
    }
    
    return data.data;
  }

  async createBookmark(namespace: string, request: CreateBookmarkRequest): Promise<BookmarkItem> {
    const response = await fetch(`${this.baseUrl}/${namespace}/bookmarks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    
    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error || 'Failed to create bookmark');
    }
    
    return data.data;
  }

  async moveItem(namespace: string, itemId: number, request: MoveItemRequest): Promise<void> {
    const response = await fetch(`${this.baseUrl}/${namespace}/items/${itemId}/move`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    
    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error || 'Failed to move item');
    }
  }

  async toggleFolderState(namespace: string, folderId: number): Promise<boolean> {
    const response = await fetch(`${this.baseUrl}/${namespace}/folders/${folderId}/toggle`, {
      method: 'PUT',
    });
    
    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error || 'Failed to toggle folder state');
    }
    
    return data.data.open;
  }

  async toggleBookmarkFavorite(namespace: string, bookmarkId: number): Promise<boolean> {
    const response = await fetch(`${this.baseUrl}/${namespace}/bookmarks/${bookmarkId}/favorite`, {
      method: 'PUT',
    });
    
    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error || 'Failed to toggle bookmark favorite');
    }
    
    return data.data.favorite;
  }

  async deleteItem(namespace: string, itemId: number): Promise<void> {
    const response = await fetch(`${this.baseUrl}/${namespace}/items/${itemId}`, {
      method: 'DELETE',
    });
    
    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error || 'Failed to delete item');
    }
  }
}

export const bookmarkAPI = new BookmarkAPI();
