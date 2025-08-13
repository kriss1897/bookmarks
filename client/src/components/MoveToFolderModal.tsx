import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import type { LocalBookmarkItem } from '../services/localDataService';

interface MoveToFolderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onMove: (folderId: string | null) => Promise<void>;
  item: LocalBookmarkItem | null;
  folders: LocalBookmarkItem[];
  loading?: boolean;
}

export function MoveToFolderModal({ 
  isOpen, 
  onClose, 
  onMove, 
  item, 
  folders,
  loading = false 
}: MoveToFolderModalProps) {
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [isMoving, setIsMoving] = useState(false);

  // Reset selection when modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedFolderId(item?.parentId || null);
    }
  }, [isOpen, item]);

  if (!isOpen || !item) return null;

  const availableFolders = folders.filter(folder => 
    folder.type === 'folder' && 
    folder.id !== item.id && // Can't move into itself
    folder.parentId !== item.id // Can't move into its own child (basic cycle prevention)
  );

  const handleMove = async () => {
    if (selectedFolderId === item.parentId) {
      // No change needed
      onClose();
      return;
    }

    try {
      setIsMoving(true);
      await onMove(selectedFolderId);
      onClose();
    } catch (error) {
      console.error('Failed to move item:', error);
    } finally {
      setIsMoving(false);
    }
  };

  const handleCancel = () => {
    setSelectedFolderId(item?.parentId || null);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4">
        <h2 className="text-lg font-semibold mb-4">
          Move "{item.type === 'folder' ? item.name : item.title}" to folder
        </h2>
        
        <div className="space-y-3 mb-6 max-h-60 overflow-y-auto">
          {/* Root folder option */}
          <label className="flex items-center space-x-3 p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer">
            <input
              type="radio"
              name="folder"
              value=""
              checked={selectedFolderId === null}
              onChange={() => setSelectedFolderId(null)}
              className="text-blue-600"
            />
            <span className="text-sm font-medium">📁 Root (No folder)</span>
          </label>

          {/* Available folders */}
          {availableFolders.map(folder => (
            <label 
              key={folder.id} 
              className="flex items-center space-x-3 p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer"
            >
              <input
                type="radio"
                name="folder"
                value={folder.id}
                checked={selectedFolderId === folder.id}
                onChange={() => setSelectedFolderId(folder.id)}
                className="text-blue-600"
              />
              <span className="text-sm">📁 {folder.name}</span>
              {folder.id === item.parentId && (
                <span className="text-xs text-gray-500">(current)</span>
              )}
            </label>
          ))}

          {availableFolders.length === 0 && (
            <div className="text-sm text-gray-500 text-center py-4">
              No folders available. Create a folder first to move items into it.
            </div>
          )}
        </div>

        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={handleCancel} disabled={isMoving}>
            Cancel
          </Button>
          <Button 
            onClick={handleMove} 
            disabled={isMoving || loading}
          >
            {isMoving ? 'Moving...' : 'Move'}
          </Button>
        </div>
      </div>
    </div>
  );
}
