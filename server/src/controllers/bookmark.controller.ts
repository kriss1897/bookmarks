import { Request, Response } from 'express';
import { BookmarkService, BookmarkItem } from '../services/bookmarkService.js';
import { EventPublisher } from '../services/EventPublisher.js';
import { db } from '../db/connection.js';
import { nodes, folders } from '../db/schema.js';

export class BookmarkController {
  private bookmarkService: BookmarkService;
  private eventPublisher: EventPublisher;

  constructor(eventPublisher: EventPublisher) {
    this.bookmarkService = new BookmarkService();
    this.eventPublisher = eventPublisher;
  }

  // Get all items in a namespace
  getItems = async (req: Request, res: Response): Promise<void> => {
    try {
      const { namespace } = req.params;
      const { parentId } = req.query;

      const items = await this.bookmarkService.getNamespaceItems(
        namespace, 
        parentId ? parentId as string : undefined
      );

      res.json({ success: true, data: items });
    } catch (error) {
      console.error('Error getting items:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to get items' 
      });
    }
  };

  // Create a new folder
  createFolder = async (req: Request, res: Response): Promise<void> => {
    try {
      const { namespace } = req.params;
      const { name, parentId } = req.body;

      console.log('Creating folder request:', { namespace, name, parentId });

      if (!name || typeof name !== 'string') {
        res.status(400).json({ 
          success: false, 
          error: 'Folder name is required' 
        });
        return;
      }

      const folder = await this.bookmarkService.createFolder(
        namespace, 
        name, 
        parentId || undefined
      );

      // Broadcast the change to all connected clients
      this.eventPublisher.publishToNamespace(namespace, {
        type: 'folder_created',
        data: folder,
        timestamp: new Date().toISOString(),
      });

      res.status(201).json({ success: true, data: folder });
    } catch (error) {
      console.error('Error creating folder:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to create folder',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  };

  // Create a new bookmark
  createBookmark = async (req: Request, res: Response): Promise<void> => {
    try {
      const { namespace } = req.params;
      const { title, url, icon, parentId } = req.body;

      if (!title || !url || typeof title !== 'string' || typeof url !== 'string') {
        res.status(400).json({ 
          success: false, 
          error: 'Title and URL are required' 
        });
        return;
      }

      const bookmark = await this.bookmarkService.createBookmark(
        namespace, 
        title, 
        url, 
        icon, 
        parentId || undefined
      );

      // Broadcast the change to all connected clients
      this.eventPublisher.publishToNamespace(namespace, {
        type: 'bookmark_created',
        data: bookmark,
        timestamp: new Date().toISOString(),
      });

      res.status(201).json({ success: true, data: bookmark });
    } catch (error) {
      console.error('Error creating bookmark:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to create bookmark' 
      });
    }
  };

  // Move an item (reorder or change parent)
  moveItem = async (req: Request, res: Response): Promise<void> => {
    try {
      const { namespace, itemId } = req.params;
      const { newParentId, afterItemId } = req.body;

      await this.bookmarkService.moveItem(
        itemId, 
        newParentId || null, 
        afterItemId || undefined
      );

      // Broadcast the change to all connected clients
      this.eventPublisher.publishToNamespace(namespace, {
        type: 'item_moved',
        data: { 
          itemId: itemId, 
          newParentId: newParentId || null, 
          afterItemId: afterItemId || null 
        },
        timestamp: new Date().toISOString(),
      });

      res.json({ success: true });
    } catch (error) {
      console.error('Error moving item:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to move item' 
      });
    }
  };

  // Toggle folder open/closed state
  toggleFolderState = async (req: Request, res: Response): Promise<void> => {
    try {
      const { namespace, folderId } = req.params;

      const newState = await this.bookmarkService.toggleFolderState(
        namespace, 
        folderId
      );

      // Broadcast the change to all connected clients
      this.eventPublisher.publishToNamespace(namespace, {
        type: 'folder_toggled',
        data: { 
          folderId: folderId, 
          open: newState 
        },
        timestamp: new Date().toISOString(),
      });

      res.json({ success: true, data: { open: newState } });
    } catch (error) {
      console.error('Error toggling folder state:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to toggle folder state' 
      });
    }
  };

  // Toggle bookmark favorite status
  toggleBookmarkFavorite = async (req: Request, res: Response): Promise<void> => {
    try {
      const { namespace, bookmarkId } = req.params;

      const newState = await this.bookmarkService.toggleBookmarkFavorite(
        bookmarkId
      );

      // Broadcast the change to all connected clients
      this.eventPublisher.publishToNamespace(namespace, {
        type: 'bookmark_favorite_toggled',
        data: { 
          bookmarkId: bookmarkId, 
          favorite: newState 
        },
        timestamp: new Date().toISOString(),
      });

      res.json({ success: true, data: { favorite: newState } });
    } catch (error) {
      console.error('Error toggling bookmark favorite:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to toggle bookmark favorite' 
      });
    }
  };

  // Delete an item
  deleteItem = async (req: Request, res: Response): Promise<void> => {
    try {
      const { namespace, itemId } = req.params;

      await this.bookmarkService.deleteItem(itemId);

      // Broadcast the change to all connected clients
      this.eventPublisher.publishToNamespace(namespace, {
        type: 'item_deleted',
        data: { itemId: itemId },
        timestamp: new Date().toISOString(),
      });

      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting item:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to delete item' 
      });
    }
  };

  // Update bookmark details
  updateBookmark = async (req: Request, res: Response): Promise<void> => {
    try {
      const { namespace, bookmarkId } = req.params;
      const { title, url, icon } = req.body;

      // For now, we'll implement a simple update
      // In a real implementation, you'd add this method to BookmarkService
      
      res.status(501).json({ 
        success: false, 
        error: 'Update bookmark not yet implemented' 
      });
    } catch (error) {
      console.error('Error updating bookmark:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to update bookmark' 
      });
    }
  };

  // Update folder name
  updateFolder = async (req: Request, res: Response): Promise<void> => {
    try {
      const { namespace, folderId } = req.params;
      const { name } = req.body;

      // For now, we'll implement a simple update
      // In a real implementation, you'd add this method to BookmarkService
      
      res.status(501).json({ 
        success: false, 
        error: 'Update folder not yet implemented' 
      });
    } catch (error) {
      console.error('Error updating folder:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to update folder' 
      });
    }
  };
}
