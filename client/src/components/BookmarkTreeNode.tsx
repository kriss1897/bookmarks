import { useState } from 'react';
import type { LocalBookmarkItem } from '../services/localDataService';
import { Button } from '@/components/ui/button';
import { LoadingSpinner } from '@/components/ui/loading-spinner';

interface BookmarkTreeNodeProps {
  item: LocalBookmarkItem;
  namespace: string;
  level: number;
  index: number;
  onLoadChildren: (folderId: string) => Promise<void>;
  onToggleFolder: (folderId: string) => Promise<void>;
  onToggleFavorite: (bookmarkId: string) => Promise<void>;
  onDeleteItem: (itemId: string) => Promise<void>;
  onMoveUp: (index: number) => Promise<void>;
  onMoveDown: (index: number) => Promise<void>;
  onOpenMoveModal: (item: LocalBookmarkItem) => void;
  isLoadingChildren?: boolean;
  totalSiblingsCount: number;
}

export function BookmarkTreeNode({
  item,
  namespace,
  level,
  index,
  onLoadChildren,
  onToggleFolder,
  onToggleFavorite,
  onDeleteItem,
  onMoveUp,
  onMoveDown,
  onOpenMoveModal,
  isLoadingChildren = false,
  totalSiblingsCount
}: BookmarkTreeNodeProps) {
  const [childrenLoading, setChildrenLoading] = useState(false);

  const handleFolderClick = async () => {
    if (item.type !== 'folder') return;

    setChildrenLoading(true);
    try {
      if (!item.open) {
        // Load children if folder is being opened
        await onLoadChildren(item.id);
      }
      // Toggle folder state
      await onToggleFolder(item.id);
    } catch (error) {
      console.error('Error handling folder click:', error);
    } finally {
      setChildrenLoading(false);
    }
  };

  const indentStyle = {
    paddingLeft: `${level * 24}px`
  };

  return (
    <div>
      {/* Current item */}
      <div
        className="flex items-center justify-between rounded border p-3 hover:bg-gray-50 dark:hover:bg-gray-800"
        style={indentStyle}
      >
        <div className="flex items-center gap-3">
          {/* Move up/down buttons */}
          <div className="flex flex-col gap-1 mr-2">
            <button
              onClick={() => onMoveUp(index)}
              disabled={index === 0}
              title="Move up"
              className="text-gray-500 hover:text-blue-600 disabled:opacity-30 text-xs"
            >
              ▲
            </button>
            <button
              onClick={() => onMoveDown(index)}
              disabled={index === totalSiblingsCount - 1}
              title="Move down"
              className="text-gray-500 hover:text-blue-600 disabled:opacity-30 text-xs"
            >
              ▼
            </button>
          </div>

          {item.type === 'folder' ? (
            <div className="flex items-center gap-2">
              <button
                onClick={handleFolderClick}
                disabled={childrenLoading}
                className="flex items-center gap-2 text-blue-600 hover:text-blue-800 disabled:opacity-50"
              >
                <span className="text-lg">
                  {item.open ? '📂' : '📁'}
                </span>
                <span>{item.name}</span>
                {childrenLoading && <LoadingSpinner />}
              </button>
              
              {/* Children count indicator */}
              {item.children && item.children.length > 0 && (
                <span className="text-xs text-gray-500 bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">
                  {item.children.length}
                </span>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => onToggleFavorite(item.id)}
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

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenMoveModal(item)}
            title="Move to folder"
          >
            📁 Move
          </Button>
          <button
            onClick={() => onDeleteItem(item.id)}
            className="text-red-600 hover:text-red-800 px-2 py-1 rounded"
          >
            Delete
          </button>
        </div>
      </div>

      {/* Render children recursively if folder is open */}
      {item.type === 'folder' && item.open && item.children && (
        <div className="ml-4">
          {isLoadingChildren ? (
            <div className="flex items-center gap-2 p-4 text-gray-500">
              <LoadingSpinner />
              <span>Loading folder contents...</span>
            </div>
          ) : (
            item.children.map((child, childIndex) => (
              <BookmarkTreeNode
                key={child.id}
                item={child}
                namespace={namespace}
                level={level + 1}
                index={childIndex}
                onLoadChildren={onLoadChildren}
                onToggleFolder={onToggleFolder}
                onToggleFavorite={onToggleFavorite}
                onDeleteItem={onDeleteItem}
                onMoveUp={onMoveUp}
                onMoveDown={onMoveDown}
                onOpenMoveModal={onOpenMoveModal}
                totalSiblingsCount={item.children?.length || 0}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
