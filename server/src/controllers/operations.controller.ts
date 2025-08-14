import { Request, Response } from 'express';
import { BookmarkService } from '../services/bookmark.service.js';
import { EventPublisher } from '../services/EventPublisher.js';
import { OperationValidator } from '../services/OperationValidator.js';
import { OperationDeduplicator } from '../services/OperationDeduplicator.js';
import type { 
  Operation, 
  CreateBookmarkPayload,
  CreateFolderPayload,
  UpdateBookmarkPayload,
  UpdateFolderPayload,
  DeleteItemPayload,
  MoveItemPayload
} from '../types/operations.js';

export class OperationsController {
  private bookmarkService: BookmarkService;
  private eventPublisher: EventPublisher;
  private validator: OperationValidator;
  private deduplicator: OperationDeduplicator;

  constructor(eventPublisher: EventPublisher) {
    this.bookmarkService = new BookmarkService();
    this.eventPublisher = eventPublisher;
    this.validator = new OperationValidator();
    this.deduplicator = new OperationDeduplicator();
  }

  // POST /api/operations/:namespace/create-bookmark
  createBookmark = async (req: Request, res: Response): Promise<void> => {
    try {
      const { namespace } = req.params;
      const operation: Operation = {
        ...req.body,
        type: 'CREATE_BOOKMARK',
        namespace
      };

      // Validate operation
      const validationError = await this.validator.validateOperation(operation);
      if (validationError) {
        res.status(400).json({
          success: false,
          error: validationError
        });
        return;
      }

      // Check for duplicate operation
      const isDuplicate = await this.deduplicator.isOperationProcessed(operation.id);
      if (isDuplicate) {
        res.status(200).json({
          success: true,
          message: 'Operation already processed',
          operationId: operation.id
        });
        return;
      }

      // Process operation
      const payload = operation.payload as CreateBookmarkPayload;
      const { id, name, url, parentId, isFavorite = false, orderIndex } = payload;

      const bookmark = await this.bookmarkService.createBookmarkWithId(namespace, {
        id,
        title: name,
        url,
        parentId: parentId || null,
        favorite: isFavorite,
        orderIndex
      });

      // Log operation as processed
      await this.deduplicator.logAndMarkProcessed(operation);

      // Broadcast the change to all connected clients
      this.eventPublisher.publishToNamespace(namespace, {
        type: 'bookmark_created',
        id: bookmark.id,
        name: bookmark.title,
        url: bookmark.url,
        parentId: bookmark.parentId,
        orderIndex: bookmark.orderIndex,
        isFavorite: bookmark.favorite,
        createdAt: bookmark.createdAt,
        updatedAt: bookmark.updatedAt,
        timestamp: new Date().toISOString(),
      });

      res.status(201).json({
        success: true,
        data: bookmark,
        operationId: operation.id
      });
    } catch (error) {
      console.error('Error creating bookmark via operation:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to create bookmark',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  };

  // POST /api/operations/:namespace/create-folder
  createFolder = async (req: Request, res: Response): Promise<void> => {
    try {
      const { namespace } = req.params;
      const operation: Operation = {
        ...req.body,
        type: 'CREATE_FOLDER',
        namespace
      };

      // Validate operation
      const validationError = await this.validator.validateOperation(operation);
      if (validationError) {
        res.status(400).json({
          success: false,
          error: validationError
        });
        return;
      }

      // Check for duplicate operation
      const isDuplicate = await this.deduplicator.isOperationProcessed(operation.id);
      if (isDuplicate) {
        res.status(200).json({
          success: true,
          message: 'Operation already processed',
          operationId: operation.id
        });
        return;
      }

      // Process operation
      const payload = operation.payload as CreateFolderPayload;
      const { id, name, parentId, orderIndex } = payload;

      const folder = await this.bookmarkService.createFolderWithId(namespace, {
        id,
        name,
        parentId: parentId || null,
        orderIndex
      });

      // Log operation as processed
      await this.deduplicator.logAndMarkProcessed(operation);

      // Broadcast the change to all connected clients
      this.eventPublisher.publishToNamespace(namespace, {
        type: 'folder_created',
        id: folder.id,
        name: folder.name,
        parentId: folder.parentId,
        orderIndex: folder.orderIndex,
        isOpen: folder.open,
        createdAt: folder.createdAt,
        updatedAt: folder.updatedAt,
        timestamp: new Date().toISOString(),
      });

      res.status(201).json({
        success: true,
        data: folder,
        operationId: operation.id
      });
    } catch (error) {
      console.error('Error creating folder via operation:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to create folder',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  };

  // PUT /api/operations/:namespace/update-bookmark
  updateBookmark = async (req: Request, res: Response): Promise<void> => {
    try {
      const { namespace } = req.params;
      const operation: Operation = {
        ...req.body,
        type: 'UPDATE_BOOKMARK',
        namespace
      };

      // Validate operation
      const validationError = await this.validator.validateOperation(operation);
      if (validationError) {
        res.status(400).json({
          success: false,
          error: validationError
        });
        return;
      }

      // Check for duplicate operation
      const isDuplicate = await this.deduplicator.isOperationProcessed(operation.id);
      if (isDuplicate) {
        res.status(200).json({
          success: true,
          message: 'Operation already processed',
          operationId: operation.id
        });
        return;
      }

      // Process operation
      const payload = operation.payload as UpdateBookmarkPayload;
      const { id, name, url, isFavorite } = payload;

      const updatedBookmark = await this.bookmarkService.updateBookmark(id, {
        title: name,
        url,
        favorite: isFavorite
      });

      // Log operation as processed
      await this.deduplicator.logAndMarkProcessed(operation);

      // Broadcast the change to all connected clients
      this.eventPublisher.publishToNamespace(namespace, {
        type: 'bookmark_updated',
        id: updatedBookmark.id,
        title: updatedBookmark.title,
        url: updatedBookmark.url,
        favorite: updatedBookmark.favorite,
        updatedAt: updatedBookmark.updatedAt,
        timestamp: new Date().toISOString(),
      });

      res.json({
        success: true,
        data: updatedBookmark,
        operationId: operation.id
      });
    } catch (error) {
      console.error('Error updating bookmark via operation:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update bookmark',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  };

  // PUT /api/operations/:namespace/update-folder
  updateFolder = async (req: Request, res: Response): Promise<void> => {
    try {
      const { namespace } = req.params;
      const operation: Operation = {
        ...req.body,
        type: 'UPDATE_FOLDER',
        namespace
      };

      // Validate operation
      const validationError = await this.validator.validateOperation(operation);
      if (validationError) {
        res.status(400).json({
          success: false,
          error: validationError
        });
        return;
      }

      // Check for duplicate operation
      const isDuplicate = await this.deduplicator.isOperationProcessed(operation.id);
      if (isDuplicate) {
        res.status(200).json({
          success: true,
          message: 'Operation already processed',
          operationId: operation.id
        });
        return;
      }

      // Process operation
      const payload = operation.payload as UpdateFolderPayload;
      const { id, name, isOpen } = payload;

      const updatedFolder = await this.bookmarkService.updateFolder(id, {
        name,
        open: isOpen
      });

      // Log operation as processed
      await this.deduplicator.logAndMarkProcessed(operation);

      // Broadcast the change to all connected clients
      this.eventPublisher.publishToNamespace(namespace, {
        type: 'folder_updated',
        id: updatedFolder.id,
        name: updatedFolder.name,
        open: updatedFolder.open,
        updatedAt: updatedFolder.updatedAt,
        timestamp: new Date().toISOString(),
      });

      res.json({
        success: true,
        data: updatedFolder,
        operationId: operation.id
      });
    } catch (error) {
      console.error('Error updating folder via operation:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update folder',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  };

  // DELETE /api/operations/:namespace/delete-bookmark
  deleteBookmark = async (req: Request, res: Response): Promise<void> => {
    try {
      const { namespace } = req.params;
      const operation: Operation = {
        ...req.body,
        type: 'DELETE_BOOKMARK',
        namespace
      };

      // Validate operation
      const validationError = await this.validator.validateOperation(operation);
      if (validationError) {
        res.status(400).json({
          success: false,
          error: validationError
        });
        return;
      }

      // Check for duplicate operation
      const isDuplicate = await this.deduplicator.isOperationProcessed(operation.id);
      if (isDuplicate) {
        res.status(200).json({
          success: true,
          message: 'Operation already processed',
          operationId: operation.id
        });
        return;
      }

      // Process operation
      const payload = operation.payload as DeleteItemPayload;
      const { id } = payload;

      await this.bookmarkService.deleteItem(id);

      // Log operation as processed
      await this.deduplicator.logAndMarkProcessed(operation);

      // Broadcast the change to all connected clients
      this.eventPublisher.publishToNamespace(namespace, {
        type: 'item_deleted',
        id,
        timestamp: new Date().toISOString(),
      });

      res.json({
        success: true,
        operationId: operation.id
      });
    } catch (error) {
      console.error('Error deleting bookmark via operation:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to delete bookmark',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  };

  // DELETE /api/operations/:namespace/delete-folder
  deleteFolder = async (req: Request, res: Response): Promise<void> => {
    try {
      const { namespace } = req.params;
      const operation: Operation = {
        ...req.body,
        type: 'DELETE_FOLDER',
        namespace
      };

      // Validate operation
      const validationError = await this.validator.validateOperation(operation);
      if (validationError) {
        res.status(400).json({
          success: false,
          error: validationError
        });
        return;
      }

      // Check for duplicate operation
      const isDuplicate = await this.deduplicator.isOperationProcessed(operation.id);
      if (isDuplicate) {
        res.status(200).json({
          success: true,
          message: 'Operation already processed',
          operationId: operation.id
        });
        return;
      }

      // Process operation
      const payload = operation.payload as DeleteItemPayload;
      const { id } = payload;

      await this.bookmarkService.deleteItem(id);

      // Log operation as processed
      await this.deduplicator.logAndMarkProcessed(operation);

      // Broadcast the change to all connected clients
      this.eventPublisher.publishToNamespace(namespace, {
        type: 'item_deleted',
        id,
        timestamp: new Date().toISOString(),
      });

      res.json({
        success: true,
        operationId: operation.id
      });
    } catch (error) {
      console.error('Error deleting folder via operation:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to delete folder',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  };

  // POST /api/operations/:namespace/move-bookmark
  moveBookmark = async (req: Request, res: Response): Promise<void> => {
    try {
      const { namespace } = req.params;
      const operation: Operation = {
        ...req.body,
        type: 'MOVE_BOOKMARK',
        namespace
      };

      // Validate operation
      const validationError = await this.validator.validateOperation(operation);
      if (validationError) {
        res.status(400).json({
          success: false,
          error: validationError
        });
        return;
      }

      // Check for duplicate operation
      const isDuplicate = await this.deduplicator.isOperationProcessed(operation.id);
      if (isDuplicate) {
        res.status(200).json({
          success: true,
          message: 'Operation already processed',
          operationId: operation.id
        });
        return;
      }

      // Process operation
      const payload = operation.payload as MoveItemPayload;
      const { id, newParentId, targetOrderIndex } = payload;

      await this.bookmarkService.moveItem(id, newParentId || null, targetOrderIndex);

      // Log operation as processed
      await this.deduplicator.logAndMarkProcessed(operation);

      // Broadcast the change to all connected clients
      this.eventPublisher.publishToNamespace(namespace, {
        type: 'item_moved',
        id,
        newParentId: newParentId || null,
        targetOrderIndex,
        timestamp: new Date().toISOString(),
      });

      res.json({
        success: true,
        operationId: operation.id
      });
    } catch (error) {
      console.error('Error moving bookmark via operation:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to move bookmark',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  };

  // POST /api/operations/:namespace/move-folder
  moveFolder = async (req: Request, res: Response): Promise<void> => {
    try {
      const { namespace } = req.params;
      const operation: Operation = {
        ...req.body,
        type: 'MOVE_FOLDER',
        namespace
      };

      // Validate operation
      const validationError = await this.validator.validateOperation(operation);
      if (validationError) {
        res.status(400).json({
          success: false,
          error: validationError
        });
        return;
      }

      // Check for duplicate operation
      const isDuplicate = await this.deduplicator.isOperationProcessed(operation.id);
      if (isDuplicate) {
        res.status(200).json({
          success: true,
          message: 'Operation already processed',
          operationId: operation.id
        });
        return;
      }

      // Process operation
      const payload = operation.payload as MoveItemPayload;
      const { id, newParentId, targetOrderIndex } = payload;

      await this.bookmarkService.moveItem(id, newParentId || null, targetOrderIndex);

      // Log operation as processed
      await this.deduplicator.logAndMarkProcessed(operation);

      // Broadcast the change to all connected clients
      this.eventPublisher.publishToNamespace(namespace, {
        type: 'item_moved',
        id,
        newParentId: newParentId || null,
        targetOrderIndex,
        timestamp: new Date().toISOString(),
      });

      res.json({
        success: true,
        operationId: operation.id
      });
    } catch (error) {
      console.error('Error moving folder via operation:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to move folder',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  };
}
