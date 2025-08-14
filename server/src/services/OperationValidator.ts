import type { Operation, OperationType, OperationPayload } from '../types/operations.js';

export class OperationValidator {
  
  // Main validation method
  validateOperation(operation: any): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Validate operation structure
    if (!operation || typeof operation !== 'object') {
      return { valid: false, errors: ['Operation must be an object'] };
    }

    // Required fields
    if (!operation.id || typeof operation.id !== 'string') {
      errors.push('Operation id is required and must be a string');
    }

    if (!operation.type || typeof operation.type !== 'string') {
      errors.push('Operation type is required and must be a string');
    }

    if (!operation.namespace || typeof operation.namespace !== 'string') {
      errors.push('Operation namespace is required and must be a string');
    }

    if (!operation.clientId || typeof operation.clientId !== 'string') {
      errors.push('Operation clientId is required and must be a string');
    }

    if (!operation.timestamp || typeof operation.timestamp !== 'number') {
      errors.push('Operation timestamp is required and must be a number');
    }

    if (!operation.payload || typeof operation.payload !== 'object') {
      errors.push('Operation payload is required and must be an object');
    }

    // If basic structure is invalid, return early
    if (errors.length > 0) {
      return { valid: false, errors };
    }

    // Validate operation type
    const validTypes: OperationType[] = [
      'CREATE_BOOKMARK', 'CREATE_FOLDER', 'UPDATE_BOOKMARK', 
      'UPDATE_FOLDER', 'DELETE_BOOKMARK', 'DELETE_FOLDER', 
      'MOVE_BOOKMARK', 'MOVE_FOLDER'
    ];

    if (!validTypes.includes(operation.type)) {
      errors.push(`Invalid operation type: ${operation.type}`);
      return { valid: false, errors };
    }

    // Validate payload based on operation type
    const payloadErrors = this.validatePayload(operation.type, operation.payload);
    errors.push(...payloadErrors);

    return { valid: errors.length === 0, errors };
  }

  // Validate payload based on operation type
  private validatePayload(type: OperationType, payload: any): string[] {
    const errors: string[] = [];

    switch (type) {
      case 'CREATE_BOOKMARK':
        return this.validateCreateBookmarkPayload(payload);
      case 'CREATE_FOLDER':
        return this.validateCreateFolderPayload(payload);
      case 'UPDATE_BOOKMARK':
        return this.validateUpdateBookmarkPayload(payload);
      case 'UPDATE_FOLDER':
        return this.validateUpdateFolderPayload(payload);
      case 'DELETE_BOOKMARK':
      case 'DELETE_FOLDER':
        return this.validateDeleteItemPayload(payload);
      case 'MOVE_BOOKMARK':
      case 'MOVE_FOLDER':
        return this.validateMoveItemPayload(payload);
      default:
        return [`Unknown operation type: ${type}`];
    }
  }

  private validateCreateBookmarkPayload(payload: any): string[] {
    const errors: string[] = [];

    if (!payload.id || typeof payload.id !== 'string') {
      errors.push('Bookmark id is required and must be a string');
    }

    if (!payload.name || typeof payload.name !== 'string' || payload.name.trim().length === 0) {
      errors.push('Bookmark name is required and must be a non-empty string');
    }

    if (!payload.url || typeof payload.url !== 'string') {
      errors.push('Bookmark url is required and must be a string');
    } else {
      // Basic URL validation
      try {
        new URL(payload.url);
      } catch {
        errors.push('Bookmark url must be a valid URL');
      }
    }

    if (payload.parentId !== undefined && typeof payload.parentId !== 'string') {
      errors.push('Bookmark parentId must be a string when provided');
    }

    if (payload.isFavorite !== undefined && typeof payload.isFavorite !== 'boolean') {
      errors.push('Bookmark isFavorite must be a boolean when provided');
    }

    if (!payload.orderIndex || typeof payload.orderIndex !== 'string') {
      errors.push('Bookmark orderIndex is required and must be a string');
    }

    return errors;
  }

  private validateCreateFolderPayload(payload: any): string[] {
    const errors: string[] = [];

    if (!payload.id || typeof payload.id !== 'string') {
      errors.push('Folder id is required and must be a string');
    }

    if (!payload.name || typeof payload.name !== 'string' || payload.name.trim().length === 0) {
      errors.push('Folder name is required and must be a non-empty string');
    }

    if (payload.parentId !== undefined && typeof payload.parentId !== 'string') {
      errors.push('Folder parentId must be a string when provided');
    }

    if (!payload.orderIndex || typeof payload.orderIndex !== 'string') {
      errors.push('Folder orderIndex is required and must be a string');
    }

    return errors;
  }

  private validateUpdateBookmarkPayload(payload: any): string[] {
    const errors: string[] = [];

    if (!payload.id || typeof payload.id !== 'string') {
      errors.push('Bookmark id is required and must be a string');
    }

    if (payload.name !== undefined && (typeof payload.name !== 'string' || payload.name.trim().length === 0)) {
      errors.push('Bookmark name must be a non-empty string when provided');
    }

    if (payload.url !== undefined) {
      if (typeof payload.url !== 'string') {
        errors.push('Bookmark url must be a string when provided');
      } else {
        try {
          new URL(payload.url);
        } catch {
          errors.push('Bookmark url must be a valid URL when provided');
        }
      }
    }

    if (payload.isFavorite !== undefined && typeof payload.isFavorite !== 'boolean') {
      errors.push('Bookmark isFavorite must be a boolean when provided');
    }

    return errors;
  }

  private validateUpdateFolderPayload(payload: any): string[] {
    const errors: string[] = [];

    if (!payload.id || typeof payload.id !== 'string') {
      errors.push('Folder id is required and must be a string');
    }

    if (payload.name !== undefined && (typeof payload.name !== 'string' || payload.name.trim().length === 0)) {
      errors.push('Folder name must be a non-empty string when provided');
    }

    if (payload.isOpen !== undefined && typeof payload.isOpen !== 'boolean') {
      errors.push('Folder isOpen must be a boolean when provided');
    }

    return errors;
  }

  private validateDeleteItemPayload(payload: any): string[] {
    const errors: string[] = [];

    if (!payload.id || typeof payload.id !== 'string') {
      errors.push('Item id is required and must be a string');
    }

    return errors;
  }

  private validateMoveItemPayload(payload: any): string[] {
    const errors: string[] = [];

    if (!payload.id || typeof payload.id !== 'string') {
      errors.push('Item id is required and must be a string');
    }

    if (payload.newParentId !== undefined && typeof payload.newParentId !== 'string') {
      errors.push('Item newParentId must be a string when provided');
    }

    if (!payload.targetOrderIndex || typeof payload.targetOrderIndex !== 'string') {
      errors.push('Item targetOrderIndex is required and must be a string');
    }

    return errors;
  }

  // Validate namespace access (placeholder for future implementation)
  validateNamespaceAccess(namespace: string, clientId?: string): boolean {
    // For now, allow all access
    // In the future, implement proper namespace access control
    return true;
  }
}
