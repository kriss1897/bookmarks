# Client Implementation Guide

## Project Structure
```
client/
├── src/
│   ├── components/
│   │   ├── ui/
│   │   │   ├── Button.tsx
│   │   │   ├── Modal.tsx
│   │   │   └── LoadingSpinner.tsx
│   │   ├── FolderList.tsx      # Main folder container
│   │   ├── FolderItem.tsx      # Individual folder component
│   │   ├── ItemList.tsx        # Items container (root or folder)
│   │   ├── ItemCard.tsx        # Individual item component
│   │   ├── AddItemModal.tsx    # Item creation modal
│   │   ├── AddFolderModal.tsx  # Folder creation modal
│   │   └── DragOverlay.tsx     # Custom drag overlay
│   ├── hooks/
│   │   ├── useSSE.ts           # SSE connection management
│   │   ├── useFolders.ts       # Folder operations
│   │   ├── useItems.ts         # Item operations
│   │   ├── useReorder.ts       # Drag and drop logic
│   │   └── useMultiTab.ts      # Multi-tab coordination
│   ├── services/
│   │   ├── api.ts              # HTTP client
│   │   ├── sseClient.ts        # SSE client implementation
│   │   └── broadcastChannel.ts # Cross-tab communication
│   ├── store/
│   │   ├── queryClient.ts      # TanStack Query configuration
│   │   └── atoms.ts            # Local state atoms (Jotai)
│   ├── types/
│   │   ├── api.ts              # API response types
│   │   └── dnd.ts              # Drag and drop types
│   ├── utils/
│   │   ├── dragUtils.ts        # DnD helper functions
│   │   └── rankUtils.ts        # Fractional indexing helpers
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
├── package.json
├── tsconfig.json
├── vite.config.ts
└── tailwind.config.js
```

## Type Definitions

**API Types (src/types/api.ts):**
```typescript
export interface Folder {
  id: string;
  name: string;
  isOpen: boolean;
  rank: string;
  updatedAt: string;
  createdAt: string;
}

export interface Item {
  id: string;
  title: string;
  icon: string;
  folderId: string | null;
  rank: string;
  updatedAt: string;
  createdAt: string;
}

export interface AppState {
  folders: Folder[];
  items: Item[];
}

export interface CreateFolderRequest {
  name: string;
}

export interface CreateItemRequest {
  title: string;
  icon: string;
  folderId?: string;
}

export interface ReorderRequest {
  entity: 'folder' | 'item';
  id: string;
  parentFolderId: string | null;
  beforeId?: string;
  afterId?: string;
}

export interface SSEInvalidation {
  kind: 'folder' | 'item';
  ids: string[];
}
```

**Drag and Drop Types (src/types/dnd.ts):**
```typescript
export interface DragData {
  type: 'folder' | 'item';
  id: string;
  folderId?: string | null;
  index?: number;
}

export interface DropData {
  type: 'folder' | 'item' | 'container';
  id: string;
  folderId?: string | null;
  accepts?: string[];
}
```

## API Service Layer

**HTTP Client (src/services/api.ts):**
```typescript
import { z } from 'zod';
import type { 
  AppState, 
  Folder, 
  Item, 
  CreateFolderRequest, 
  CreateItemRequest, 
  ReorderRequest 
} from '../types/api';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public data?: any
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const apiRequest = async <T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> => {
  const url = `${API_BASE_URL}${endpoint}`;
  
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new ApiError(
      errorData.message || 'Request failed',
      response.status,
      errorData
    );
  }

  return response.json();
};

export const api = {
  // Get initial application state
  getState: (): Promise<AppState> => apiRequest('/state'),

  // Folder operations
  createFolder: (data: CreateFolderRequest): Promise<{ folder: Folder }> =>
    apiRequest('/folders', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateFolder: (id: string, data: Partial<Folder>): Promise<{ folder: Folder }> =>
    apiRequest(`/folders/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  deleteFolder: (id: string): Promise<void> =>
    apiRequest(`/folders/${id}`, { method: 'DELETE' }),

  // Item operations
  createItem: (data: CreateItemRequest): Promise<{ item: Item }> =>
    apiRequest('/items', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateItem: (id: string, data: Partial<Item>): Promise<{ item: Item }> =>
    apiRequest(`/items/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  deleteItem: (id: string): Promise<void> =>
    apiRequest(`/items/${id}`, { method: 'DELETE' }),

  // Reorder operation
  reorder: (data: ReorderRequest): Promise<{ id: string; rank: string; parentFolderId: string | null }> =>
    apiRequest('/reorder', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};
```

## SSE Client Implementation

**SSE Hook (src/hooks/useSSE.ts):**
```typescript
import { useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useMultiTab } from './useMultiTab';
import type { SSEInvalidation } from '../types/api';

export const useSSE = () => {
  const queryClient = useQueryClient();
  const { isLeader, broadcastInvalidation } = useMultiTab();
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  const invalidationQueue = useRef(new Set<string>());
  const debouncedFetchRef = useRef<NodeJS.Timeout>();

  const handleInvalidation = useCallback((data: SSEInvalidation) => {
    // Add to invalidation queue
    data.ids.forEach(id => invalidationQueue.current.add(id));
    
    // Debounce fetch to avoid thundering herd
    if (debouncedFetchRef.current) {
      clearTimeout(debouncedFetchRef.current);
    }
    
    debouncedFetchRef.current = setTimeout(() => {
      const idsToRefetch = Array.from(invalidationQueue.current);
      invalidationQueue.current.clear();
      
      // Invalidate specific queries
      if (data.kind === 'folder') {
        queryClient.invalidateQueries({
          queryKey: ['folders'],
          refetchType: 'active',
        });
      } else {
        queryClient.invalidateQueries({
          queryKey: ['items'],
          refetchType: 'active',
        });
      }
      
      // Broadcast to other tabs
      broadcastInvalidation(data);
    }, 200); // 200ms debounce
  }, [queryClient, broadcastInvalidation]);

  const connectSSE = useCallback(() => {
    if (!isLeader || eventSourceRef.current) return;

    const eventSource = new EventSource('/api/events', {
      withCredentials: true,
    });

    eventSource.onopen = () => {
      console.log('SSE connection opened');
      // Clear reconnect timeout on successful connection
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };

    eventSource.addEventListener('invalidate', (event) => {
      try {
        const data = JSON.parse(event.data) as SSEInvalidation;
        handleInvalidation(data);
      } catch (error) {
        console.error('Failed to parse SSE invalidation:', error);
      }
    });

    eventSource.addEventListener('connected', (event) => {
      console.log('SSE connected:', JSON.parse(event.data));
    });

    eventSource.onerror = (error) => {
      console.error('SSE error:', error);
      eventSource.close();
      eventSourceRef.current = null;
      
      // Attempt reconnection with exponential backoff
      const retryDelay = Math.min(1000 * Math.pow(2, Math.random()), 30000);
      reconnectTimeoutRef.current = setTimeout(connectSSE, retryDelay);
    };

    eventSourceRef.current = eventSource;
  }, [isLeader, handleInvalidation]);

  const disconnectSSE = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
  }, []);

  useEffect(() => {
    if (isLeader) {
      connectSSE();
    } else {
      disconnectSSE();
    }

    return disconnectSSE;
  }, [isLeader, connectSSE, disconnectSSE]);

  // Listen for cross-tab invalidations
  useEffect(() => {
    const handleCrossTabInvalidation = (event: CustomEvent<SSEInvalidation>) => {
      if (!isLeader) {
        handleInvalidation(event.detail);
      }
    };

    window.addEventListener('sse-invalidation', handleCrossTabInvalidation as EventListener);
    
    return () => {
      window.removeEventListener('sse-invalidation', handleCrossTabInvalidation as EventListener);
    };
  }, [isLeader, handleInvalidation]);

  return {
    isConnected: !!eventSourceRef.current,
    reconnect: connectSSE,
  };
};
```

## Multi-Tab Coordination

**Multi-Tab Hook (src/hooks/useMultiTab.ts):**
```typescript
import { useState, useEffect, useCallback, useRef } from 'react';
import type { SSEInvalidation } from '../types/api';

const LEADER_LOCK_NAME = 'folders-app-sse-leader';
const BROADCAST_CHANNEL_NAME = 'folders-app-sync';
const HEARTBEAT_INTERVAL = 5000;
const LEADER_TIMEOUT = 10000;

export const useMultiTab = () => {
  const [isLeader, setIsLeader] = useState(false);
  const broadcastChannelRef = useRef<BroadcastChannel>();
  const heartbeatIntervalRef = useRef<NodeJS.Timeout>();
  const lastHeartbeatRef = useRef(Date.now());
  const leaderCheckIntervalRef = useRef<NodeJS.Timeout>();

  const becomeLeader = useCallback(async () => {
    try {
      await navigator.locks.request(LEADER_LOCK_NAME, { mode: 'exclusive' }, async () => {
        setIsLeader(true);
        console.log('Became SSE leader');
        
        // Start heartbeat
        heartbeatIntervalRef.current = setInterval(() => {
          broadcastChannelRef.current?.postMessage({
            type: 'leader-heartbeat',
            timestamp: Date.now(),
          });
        }, HEARTBEAT_INTERVAL);
        
        // Keep lock until tab closes or loses focus
        return new Promise<void>((resolve) => {
          const handleBeforeUnload = () => resolve();
          const handleVisibilityChange = () => {
            if (document.hidden) resolve();
          };
          
          window.addEventListener('beforeunload', handleBeforeUnload);
          document.addEventListener('visibilitychange', handleVisibilityChange);
          
          // Clean up when lock is released
          return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            setIsLeader(false);
            if (heartbeatIntervalRef.current) {
              clearInterval(heartbeatIntervalRef.current);
            }
          };
        });
      });
    } catch (error) {
      console.error('Failed to acquire leader lock:', error);
    }
  }, []);

  const broadcastInvalidation = useCallback((data: SSEInvalidation) => {
    broadcastChannelRef.current?.postMessage({
      type: 'invalidation',
      data,
    });
  }, []);

  useEffect(() => {
    // Initialize broadcast channel
    broadcastChannelRef.current = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
    
    const handleMessage = (event: MessageEvent) => {
      switch (event.data.type) {
        case 'leader-heartbeat':
          lastHeartbeatRef.current = event.data.timestamp;
          break;
        case 'invalidation':
          // Handle invalidation from leader tab
          if (!isLeader) {
            // Trigger refetch in follower tabs
            window.dispatchEvent(new CustomEvent('sse-invalidation', {
              detail: event.data.data,
            }));
          }
          break;
      }
    };

    broadcastChannelRef.current.addEventListener('message', handleMessage);

    // Start leader election process
    const tryBecomeLeader = async () => {
      // Check if we've heard from leader recently
      const timeSinceLastHeartbeat = Date.now() - lastHeartbeatRef.current;
      
      if (timeSinceLastHeartbeat > LEADER_TIMEOUT) {
        // Add jitter to prevent thundering herd
        const jitter = Math.random() * 1000;
        setTimeout(becomeLeader, jitter);
      }
    };

    // Check for leader immediately and then periodically
    tryBecomeLeader();
    leaderCheckIntervalRef.current = setInterval(tryBecomeLeader, LEADER_TIMEOUT / 2);

    return () => {
      broadcastChannelRef.current?.close();
      if (leaderCheckIntervalRef.current) {
        clearInterval(leaderCheckIntervalRef.current);
      }
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
      }
    };
  }, [becomeLeader, isLeader]);

  return {
    isLeader,
    broadcastInvalidation,
  };
};
```

## Data Management Hooks

**Folders Hook (src/hooks/useFolders.ts):**
```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api';
import type { Folder, CreateFolderRequest } from '../types/api';

export const useFolders = () => {
  const queryClient = useQueryClient();

  const foldersQuery = useQuery({
    queryKey: ['folders'],
    queryFn: async () => {
      const state = await api.getState();
      return state.folders;
    },
    staleTime: 30 * 1000, // 30 seconds
  });

  const createFolderMutation = useMutation({
    mutationFn: api.createFolder,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['folders'] });
    },
  });

  const updateFolderMutation = useMutation({
    mutationFn: ({ id, ...data }: { id: string } & Partial<Folder>) =>
      api.updateFolder(id, data),
    onMutate: async ({ id, ...newData }) => {
      // Optimistic update
      await queryClient.cancelQueries({ queryKey: ['folders'] });
      
      const previousFolders = queryClient.getQueryData<Folder[]>(['folders']);
      
      queryClient.setQueryData<Folder[]>(['folders'], (old = []) =>
        old.map(folder => 
          folder.id === id 
            ? { ...folder, ...newData, updatedAt: new Date().toISOString() }
            : folder
        )
      );
      
      return { previousFolders };
    },
    onError: (err, variables, context) => {
      // Rollback on error
      if (context?.previousFolders) {
        queryClient.setQueryData(['folders'], context.previousFolders);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['folders'] });
    },
  });

  const deleteFolderMutation = useMutation({
    mutationFn: api.deleteFolder,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['folders'] });
      queryClient.invalidateQueries({ queryKey: ['items'] });
    },
  });

  return {
    folders: foldersQuery.data || [],
    isLoading: foldersQuery.isLoading,
    error: foldersQuery.error,
    createFolder: createFolderMutation.mutate,
    updateFolder: updateFolderMutation.mutate,
    deleteFolder: deleteFolderMutation.mutate,
    isCreating: createFolderMutation.isPending,
    isUpdating: updateFolderMutation.isPending,
    isDeleting: deleteFolderMutation.isPending,
  };
};
```

**Items Hook (src/hooks/useItems.ts):**
```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api';
import type { Item, CreateItemRequest } from '../types/api';

export const useItems = (folderId?: string | null) => {
  const queryClient = useQueryClient();

  const itemsQuery = useQuery({
    queryKey: ['items', folderId],
    queryFn: async () => {
      const state = await api.getState();
      return state.items.filter(item => item.folderId === folderId);
    },
    staleTime: 30 * 1000, // 30 seconds
  });

  const allItemsQuery = useQuery({
    queryKey: ['items'],
    queryFn: async () => {
      const state = await api.getState();
      return state.items;
    },
    staleTime: 30 * 1000,
  });

  const createItemMutation = useMutation({
    mutationFn: api.createItem,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['items'] });
    },
  });

  const updateItemMutation = useMutation({
    mutationFn: ({ id, ...data }: { id: string } & Partial<Item>) =>
      api.updateItem(id, data),
    onMutate: async ({ id, ...newData }) => {
      // Optimistic update
      await queryClient.cancelQueries({ queryKey: ['items'] });
      
      const previousItems = queryClient.getQueryData<Item[]>(['items']);
      
      queryClient.setQueryData<Item[]>(['items'], (old = []) =>
        old.map(item => 
          item.id === id 
            ? { ...item, ...newData, updatedAt: new Date().toISOString() }
            : item
        )
      );
      
      return { previousItems };
    },
    onError: (err, variables, context) => {
      // Rollback on error
      if (context?.previousItems) {
        queryClient.setQueryData(['items'], context.previousItems);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['items'] });
    },
  });

  const deleteItemMutation = useMutation({
    mutationFn: api.deleteItem,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['items'] });
    },
  });

  return {
    items: itemsQuery.data || [],
    allItems: allItemsQuery.data || [],
    isLoading: itemsQuery.isLoading,
    error: itemsQuery.error,
    createItem: createItemMutation.mutate,
    updateItem: updateItemMutation.mutate,
    deleteItem: deleteItemMutation.mutate,
    isCreating: createItemMutation.isPending,
    isUpdating: updateItemMutation.isPending,
    isDeleting: deleteItemMutation.isPending,
  };
};
```

## Drag and Drop Implementation

**DnD Hook (src/hooks/useReorder.ts):**
```typescript
import { useState, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
} from '@dnd-kit/core';
import { api } from '../services/api';
import type { DragData } from '../types/dnd';

export const useReorder = () => {
  const [activeItem, setActiveItem] = useState<DragData | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const reorderMutation = useMutation({
    mutationFn: api.reorder,
    onSuccess: () => {
      // Optimistic updates are handled by SSE invalidations
      queryClient.invalidateQueries({ queryKey: ['folders'] });
      queryClient.invalidateQueries({ queryKey: ['items'] });
    },
  });

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const { active } = event;
    const data = active.data.current as DragData;
    setActiveItem(data);
  }, []);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { over } = event;
    setOverId(over?.id as string || null);
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    
    setActiveItem(null);
    setOverId(null);

    if (!over || active.id === over.id) return;

    const activeData = active.data.current as DragData;
    const overData = over.data.current;

    // Determine the target container and position
    let parentFolderId: string | null = null;
    let beforeId: string | undefined;
    let afterId: string | undefined;

    if (overData?.type === 'folder') {
      // Dropping onto a folder
      parentFolderId = over.id as string;
    } else if (overData?.type === 'item') {
      // Dropping between items
      parentFolderId = overData.folderId || null;
      
      // Determine if we're dropping before or after
      const overIndex = overData.index;
      const activeIndex = activeData?.index;
      
      if (activeIndex !== undefined && overIndex !== undefined) {
        if (activeIndex < overIndex) {
          afterId = over.id as string;
        } else {
          beforeId = over.id as string;
        }
      }
    } else if (over.id === 'root-droppable') {
      // Dropping into root container
      parentFolderId = null;
    }

    // Perform reorder
    reorderMutation.mutate({
      entity: activeData?.type || 'item',
      id: active.id as string,
      parentFolderId,
      beforeId,
      afterId,
    });
  }, [reorderMutation]);

  return {
    activeItem,
    overId,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    isReordering: reorderMutation.isPending,
  };
};
```

## React Components

**Main App Component (src/App.tsx):**
```typescript
import React from 'react';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';

import { FolderList } from './components/FolderList';
import { ItemList } from './components/ItemList';
import { DragOverlay as CustomDragOverlay } from './components/DragOverlay';
import { useSSE } from './hooks/useSSE';
import { useReorder } from './hooks/useReorder';
import { queryClient } from './store/queryClient';

function AppContent() {
  const { isConnected } = useSSE();
  const {
    activeItem,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
  } = useReorder();

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-6xl mx-auto">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">
            Folders & Items
          </h1>
          <div className="mt-2 flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
            <span className="text-sm text-gray-600">
              {isConnected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
        </header>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div>
              <h2 className="text-xl font-semibold mb-4">Folders</h2>
              <FolderList />
            </div>
            
            <div>
              <h2 className="text-xl font-semibold mb-4">Root Items</h2>
              <ItemList folderId={null} />
            </div>
          </div>

          <DragOverlay>
            {activeItem ? <CustomDragOverlay item={activeItem} /> : null}
          </DragOverlay>
        </DndContext>
      </div>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppContent />
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}

export default App;
```

**Folder List Component (src/components/FolderList.tsx):**
```typescript
import React, { useState } from 'react';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';

import { FolderItem } from './FolderItem';
import { AddFolderModal } from './AddFolderModal';
import { Button } from './ui/Button';
import { useFolders } from '../hooks/useFolders';

export const FolderList: React.FC = () => {
  const { folders, isLoading } = useFolders();
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  const { setNodeRef } = useDroppable({
    id: 'folders-droppable',
    data: {
      type: 'container',
      accepts: ['folder'],
    },
  });

  if (isLoading) {
    return <div className="animate-pulse bg-gray-200 h-32 rounded" />;
  }

  return (
    <div ref={setNodeRef} className="space-y-4">
      <Button 
        onClick={() => setIsAddModalOpen(true)}
        className="w-full"
      >
        Add Folder
      </Button>

      <SortableContext 
        items={folders.map(f => f.id)} 
        strategy={verticalListSortingStrategy}
      >
        {folders.map((folder) => (
          <FolderItem key={folder.id} folder={folder} />
        ))}
      </SortableContext>

      {folders.length === 0 && (
        <div className="text-center py-8 text-gray-500">
          No folders yet. Create your first folder!
        </div>
      )}

      <AddFolderModal 
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
      />
    </div>
  );
};
```

**Item List Component (src/components/ItemList.tsx):**
```typescript
import React, { useState } from 'react';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';

import { ItemCard } from './ItemCard';
import { AddItemModal } from './AddItemModal';
import { Button } from './ui/Button';
import { useItems } from '../hooks/useItems';

interface ItemListProps {
  folderId: string | null;
}

export const ItemList: React.FC<ItemListProps> = ({ folderId }) => {
  const { items, isLoading } = useItems(folderId);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  const droppableId = folderId ? `folder-${folderId}` : 'root-droppable';

  const { setNodeRef } = useDroppable({
    id: droppableId,
    data: {
      type: 'container',
      folderId,
      accepts: ['item'],
    },
  });

  if (isLoading) {
    return <div className="animate-pulse bg-gray-200 h-32 rounded" />;
  }

  return (
    <div ref={setNodeRef} className="space-y-4 min-h-32">
      <Button 
        onClick={() => setIsAddModalOpen(true)}
        variant="outline"
        className="w-full"
      >
        Add Item
      </Button>

      <SortableContext 
        items={items.map(item => item.id)} 
        strategy={verticalListSortingStrategy}
      >
        {items.map((item, index) => (
          <ItemCard 
            key={item.id} 
            item={item} 
            index={index}
          />
        ))}
      </SortableContext>

      {items.length === 0 && (
        <div className="text-center py-8 text-gray-500">
          {folderId ? 'No items in this folder' : 'No root items'}
        </div>
      )}

      <AddItemModal 
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        defaultFolderId={folderId}
      />
    </div>
  );
};
```

## Query Client Configuration

**Query Client Setup (src/store/queryClient.ts):**
```typescript
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000, // 30 seconds
      gcTime: 5 * 60 * 1000, // 5 minutes
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      retry: (failureCount, error: any) => {
        // Don't retry on 4xx errors
        if (error?.status >= 400 && error?.status < 500) {
          return false;
        }
        return failureCount < 3;
      },
    },
    mutations: {
      retry: 1,
    },
  },
});

// Enable devtools in development
if (import.meta.env.DEV) {
  import('@tanstack/react-query-devtools').then(({ ReactQueryDevtools }) => {
    // Devtools available in development
  });
}
```

## Build Configuration

**Vite Configuration (vite.config.ts):**
```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
```

**Package Configuration (package.json):**
```json
{
  "name": "folders-app-client",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "lint": "eslint src --ext ts,tsx --report-unused-disable-directives --max-warnings 0",
    "type-check": "tsc --noEmit"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "@tanstack/react-query": "^5.0.0",
    "@tanstack/react-query-devtools": "^5.0.0",
    "@dnd-kit/core": "^6.1.0",
    "@dnd-kit/sortable": "^8.0.0",
    "@dnd-kit/utilities": "^3.2.2",
    "zod": "^3.22.4",
    "clsx": "^2.0.0",
    "tailwind-merge": "^2.0.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.43",
    "@types/react-dom": "^18.2.17",
    "@vitejs/plugin-react": "^4.2.0",
    "typescript": "^5.2.2",
    "vite": "^5.0.8",
    "tailwindcss": "^3.3.6",
    "autoprefixer": "^10.4.16",
    "postcss": "^8.4.32",
    "eslint": "^8.55.0",
    "@typescript-eslint/eslint-plugin": "^6.14.0",
    "@typescript-eslint/parser": "^6.14.0",
    "eslint-plugin-react-hooks": "^4.6.0",
    "eslint-plugin-react-refresh": "^0.4.5"
  }
}
```

## Performance Optimizations

1. **React.memo**: Memoize components that receive complex props
2. **useMemo/useCallback**: Optimize expensive calculations and event handlers
3. **Query Deduplication**: TanStack Query automatically deduplicates identical requests
4. **Optimistic Updates**: Immediate UI feedback with server reconciliation
5. **Virtual Scrolling**: For large lists (react-window/react-virtualized)
6. **Code Splitting**: Lazy load modals and heavy components

## Accessibility Features

1. **Keyboard Navigation**: @dnd-kit provides built-in keyboard support
2. **Screen Reader Support**: Proper ARIA labels and announcements
3. **Focus Management**: Logical tab order and focus indicators
4. **High Contrast**: Support for high contrast mode
5. **Reduced Motion**: Respect user's motion preferences

This client implementation provides a modern, performant, and accessible foundation for the realtime folders application with sophisticated state management, efficient drag-and-drop interactions, and bulletproof multi-tab synchronization.
