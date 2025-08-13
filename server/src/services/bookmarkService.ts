import { eq, and, isNull, sql, asc } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { nodes, folders, bookmarks, folderState } from '../db/schema.js';
import type { Node, Bookmark, Folder, FolderState } from '../db/schema.js';
import { randomUUID } from 'crypto';

export interface BookmarkItem {
  id: string;
  type: 'folder' | 'bookmark';
  namespace: string;
  parentId: string | null;
  orderIndex: string;
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

export class BookmarkService {
  // Get all items in a namespace, ordered by orderIndex
  async getNamespaceItems(namespace: string, parentId?: string): Promise<BookmarkItem[]> {
    const whereClause = parentId 
      ? and(eq(nodes.namespace, namespace), eq(nodes.parentId, parentId))
      : and(eq(nodes.namespace, namespace), isNull(nodes.parentId));

    const result = await db
      .select({
        node: nodes,
        folder: folders,
        bookmark: bookmarks,
        folderState: folderState,
      })
      .from(nodes)
      .leftJoin(folders, eq(nodes.id, folders.nodeId))
      .leftJoin(bookmarks, eq(nodes.id, bookmarks.nodeId))
      .leftJoin(folderState, and(
        eq(folderState.nodeId, nodes.id),
        eq(folderState.namespace, namespace)
      ))
      .where(whereClause)
      .orderBy(asc(nodes.orderIndex));

    const items = result.map(row => ({
      id: row.node.id,
      type: row.node.type,
      namespace: row.node.namespace,
      parentId: row.node.parentId,
      orderIndex: (row.node as any).orderIndex,
      createdAt: row.node.createdAt,
      updatedAt: row.node.updatedAt,
      // Folder fields
      name: row.folder?.name,
      open: row.folderState?.open ?? true,
      // Bookmark fields
      title: row.bookmark?.title,
      url: row.bookmark?.url,
      icon: row.bookmark?.icon,
      favorite: row.bookmark?.favorite ?? false,
    })) as BookmarkItem[];

    return items;
  }

  // Create a new folder
  async createFolder(namespace: string, name: string, parentId: string | null | undefined, orderIndex: string): Promise<BookmarkItem> {
    // Generate UUID for the new node
    const nodeId = randomUUID();

    // Insert new node
    const [newNode] = await db.insert(nodes).values({
      id: nodeId,
      namespace,
      type: 'folder',
      parentId: parentId || null,
      orderIndex,
    }).returning();

    // Insert folder details
    await db.insert(folders).values({
      nodeId: newNode.id,
      name,
    });

    // Insert default folder state (open)
    await db.insert(folderState).values({
      namespace,
      nodeId: newNode.id,
      open: true,
    });

    return {
      id: newNode.id,
      type: 'folder' as const,
      namespace: newNode.namespace,
  parentId: newNode.parentId,
  orderIndex: (newNode as any).orderIndex,
      createdAt: newNode.createdAt,
      updatedAt: newNode.updatedAt,
      name,
      open: true,
    };
  }

  // Create a new bookmark
  async createBookmark(
    namespace: string,
    title: string,
    url: string,
    icon: string | undefined,
    parentId: string | null | undefined,
    orderIndex: string
  ): Promise<BookmarkItem> {
    // Generate UUID for the new node
    const nodeId = randomUUID();

    // Insert new node
    const [newNode] = await db.insert(nodes).values({
      id: nodeId,
      namespace,
      type: 'bookmark',
      parentId: parentId || null,
      orderIndex,
    }).returning();

    // Insert bookmark details
    await db.insert(bookmarks).values({
      nodeId: newNode.id,
      title,
      url,
      icon: icon || null,
      favorite: false,
    });

    return {
      id: newNode.id,
      type: 'bookmark' as const,
      namespace: newNode.namespace,
      parentId: newNode.parentId,
  orderIndex: (newNode as any).orderIndex,
      createdAt: newNode.createdAt,
      updatedAt: newNode.updatedAt,
      title,
      url,
      icon: icon || undefined,
      favorite: false,
    };
  }

  // Move an item (reorder or change parent)
  async moveItem(
    itemId: string,
    newParentId: string | null,
    targetOrderIndex: string
  ): Promise<void> {
    const item = await db.select().from(nodes).where(eq(nodes.id, itemId)).get();
    if (!item) throw new Error('Item not found');

    await db.update(nodes)
      .set({
        parentId: newParentId,
        orderIndex: targetOrderIndex,
        updatedAt: Math.floor(Date.now() / 1000)
      })
      .where(eq(nodes.id, itemId));
  }

  // Toggle folder open/closed state
  async toggleFolderState(namespace: string, folderId: string): Promise<boolean> {
    const currentState = await db.select()
      .from(folderState)
      .where(and(
        eq(folderState.namespace, namespace),
        eq(folderState.nodeId, folderId)
      ))
      .get();

    const newOpenState = !currentState?.open;

    if (currentState) {
      await db.update(folderState)
        .set({ 
          open: newOpenState,
          updatedAt: Math.floor(Date.now() / 1000)
        })
        .where(and(
          eq(folderState.namespace, namespace),
          eq(folderState.nodeId, folderId)
        ));
    } else {
      await db.insert(folderState).values({
        namespace,
        nodeId: folderId,
        open: newOpenState,
      });
    }

    return newOpenState;
  }

  // Update bookmark favorite status
  async toggleBookmarkFavorite(bookmarkId: string): Promise<boolean> {
    const current = await db.select()
      .from(bookmarks)
      .where(eq(bookmarks.nodeId, bookmarkId))
      .get();

    if (!current) throw new Error('Bookmark not found');

    const newFavoriteState = !current.favorite;
    await db.update(bookmarks)
      .set({ favorite: newFavoriteState })
      .where(eq(bookmarks.nodeId, bookmarkId));

    return newFavoriteState;
  }

  // Delete an item (and its children if it's a folder)
  async deleteItem(itemId: string): Promise<void> {
    const item = await db.select().from(nodes).where(eq(nodes.id, itemId)).get();
    if (!item) throw new Error('Item not found');
    // Delete the node (cascades to children and related tables)
    await db.delete(nodes).where(eq(nodes.id, itemId));
  }

  // === SYNC-SPECIFIC METHODS ===
  
  // With UUIDs, create methods are simplified - no temp ID tracking needed
  async createFolderWithId(namespace: string, data: {
    id: string;
    name: string;
    parentId?: string | null;
    orderIndex: string;
  }): Promise<BookmarkItem> {
    // Use the provided ID instead of generating a new one
    const nodeId = data.id;

    // Insert new node
    const [newNode] = await db.insert(nodes).values({
      id: nodeId,
      namespace,
      type: 'folder',
      parentId: data.parentId || null,
      orderIndex: data.orderIndex,
    }).returning();

    // Insert folder details
    await db.insert(folders).values({
      nodeId: newNode.id,
      name: data.name,
    });

    // Insert default folder state (open)
    await db.insert(folderState).values({
      namespace,
      nodeId: newNode.id,
      open: true,
    });

    return {
      id: newNode.id,
      type: 'folder' as const,
      namespace: newNode.namespace,
      parentId: newNode.parentId,
  orderIndex: (newNode as any).orderIndex,
      createdAt: newNode.createdAt,
      updatedAt: newNode.updatedAt,
      name: data.name,
      open: true,
    };
  }

  async createBookmarkWithId(namespace: string, data: {
    id: string;
    title: string;
    url: string;
    parentId?: string | null;
    favorite?: boolean;
    orderIndex: string;
  }): Promise<BookmarkItem> {
    // Use the provided ID instead of generating a new one
    const nodeId = data.id;

    // Insert new node
    const [newNode] = await db.insert(nodes).values({
      id: nodeId,
      namespace,
      type: 'bookmark',
      parentId: data.parentId || null,
      orderIndex: data.orderIndex,
    }).returning();

    // Insert bookmark details
    await db.insert(bookmarks).values({
      nodeId: newNode.id,
      title: data.title,
      url: data.url,
      icon: null,
      favorite: data.favorite || false,
    });

    return {
      id: newNode.id,
      type: 'bookmark' as const,
      namespace: newNode.namespace,
      parentId: newNode.parentId,
  orderIndex: (newNode as any).orderIndex,
      createdAt: newNode.createdAt,
      updatedAt: newNode.updatedAt,
      title: data.title,
      url: data.url,
      icon: undefined,
      favorite: data.favorite || false,
    };
  }

  // Generic update method for items
  async updateItem(namespace: string, itemId: string, updates: {
    name?: string;
    title?: string;
    url?: string;
    favorite?: boolean;
    open?: boolean;
  orderIndex?: string;
  parentId?: string | null;
  }): Promise<void> {
    const item = await db.select().from(nodes).where(eq(nodes.id, itemId)).get();
    if (!item) throw new Error('Item not found');

    // Update based on item type
    if (item.type === 'folder') {
      if (updates.name !== undefined) {
        await db.update(folders)
          .set({ name: updates.name })
          .where(eq(folders.nodeId, itemId));
      }
      
      if (updates.open !== undefined) {
        // Update or insert folder state
        const currentState = await db.select()
          .from(folderState)
          .where(and(
            eq(folderState.namespace, namespace),
            eq(folderState.nodeId, itemId)
          ))
          .get();

        if (currentState) {
          await db.update(folderState)
            .set({ 
              open: updates.open,
              updatedAt: Math.floor(Date.now() / 1000)
            })
            .where(and(
              eq(folderState.namespace, namespace),
              eq(folderState.nodeId, itemId)
            ));
        } else {
          await db.insert(folderState).values({
            namespace,
            nodeId: itemId,
            open: updates.open,
          });
        }
      }
    } else if (item.type === 'bookmark') {
      const bookmarkUpdates: any = {};
      if (updates.title !== undefined) bookmarkUpdates.title = updates.title;
      if (updates.url !== undefined) bookmarkUpdates.url = updates.url;
      if (updates.favorite !== undefined) bookmarkUpdates.favorite = updates.favorite;

      if (Object.keys(bookmarkUpdates).length > 0) {
        await db.update(bookmarks)
          .set(bookmarkUpdates)
          .where(eq(bookmarks.nodeId, itemId));
      }
    }

    // Update node metadata and optionally orderIndex/parentId
    const nodeUpdates: any = { updatedAt: Math.floor(Date.now() / 1000) };
    if (updates.orderIndex !== undefined) nodeUpdates.orderIndex = updates.orderIndex;
    if (updates.parentId !== undefined) nodeUpdates.parentId = updates.parentId;
    await db.update(nodes).set(nodeUpdates).where(eq(nodes.id, itemId));
  }
  // No linked-list helpers needed with orderIndex
}
