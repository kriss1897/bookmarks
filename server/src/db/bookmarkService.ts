import { eq, and, isNull, sql } from 'drizzle-orm';
import { db } from './connection.js';
import { nodes, folders, bookmarks, folderState } from './schema.js';
import type { Node, Bookmark, Folder, FolderState } from './schema.js';

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

export class BookmarkService {
  // Get all items in a namespace, ordered by sibling relationships
  async getNamespaceItems(namespace: string, parentId?: number): Promise<BookmarkItem[]> {
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
      .where(whereClause);

    // Build linked list order
    const items = result.map(row => ({
      id: row.node.id,
      type: row.node.type,
      namespace: row.node.namespace,
      parentId: row.node.parentId,
      prevSiblingId: row.node.prevSiblingId,
      nextSiblingId: row.node.nextSiblingId,
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

    // Sort by linked list order
    return this.sortByLinkedList(items);
  }

  // Create a new folder
  async createFolder(namespace: string, name: string, parentId?: number): Promise<BookmarkItem> {
    // Find the current tail of the sibling list
    const currentTail = await this.findTailSiblingNonTx(namespace, parentId);

    // Insert new node
    const [newNode] = await db.insert(nodes).values({
      namespace,
      type: 'folder',
      parentId: parentId || null,
      prevSiblingId: currentTail?.id || null,
      nextSiblingId: null,
    }).returning();

    // Update the previous tail's nextSiblingId
    if (currentTail) {
      await db.update(nodes)
        .set({ nextSiblingId: newNode.id, updatedAt: Math.floor(Date.now() / 1000) })
        .where(eq(nodes.id, currentTail.id));
    }

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
      prevSiblingId: newNode.prevSiblingId,
      nextSiblingId: newNode.nextSiblingId,
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
    icon?: string, 
    parentId?: number
  ): Promise<BookmarkItem> {
    // Find the current tail of the sibling list
    const currentTail = await this.findTailSiblingNonTx(namespace, parentId);

    // Insert new node
    const [newNode] = await db.insert(nodes).values({
      namespace,
      type: 'bookmark',
      parentId: parentId || null,
      prevSiblingId: currentTail?.id || null,
      nextSiblingId: null,
    }).returning();

    // Update the previous tail's nextSiblingId
    if (currentTail) {
      await db.update(nodes)
        .set({ nextSiblingId: newNode.id, updatedAt: Math.floor(Date.now() / 1000) })
        .where(eq(nodes.id, currentTail.id));
    }

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
      prevSiblingId: newNode.prevSiblingId,
      nextSiblingId: newNode.nextSiblingId,
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
    itemId: number, 
    newParentId: number | null, 
    afterItemId?: number
  ): Promise<void> {
    const item = await db.select().from(nodes).where(eq(nodes.id, itemId)).get();
    if (!item) throw new Error('Item not found');

    // Remove from current position
    await this.removeFromLinkedListNonTx(item);

    // Insert at new position
    await this.insertIntoLinkedListNonTx(item.namespace, itemId, newParentId, afterItemId);

    // Update the item's parent
    await db.update(nodes)
      .set({ 
        parentId: newParentId,
        updatedAt: Math.floor(Date.now() / 1000)
      })
      .where(eq(nodes.id, itemId));
  }

  // Toggle folder open/closed state
  async toggleFolderState(namespace: string, folderId: number): Promise<boolean> {
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
  async toggleBookmarkFavorite(bookmarkId: number): Promise<boolean> {
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
  async deleteItem(itemId: number): Promise<void> {
    const item = await db.select().from(nodes).where(eq(nodes.id, itemId)).get();
    if (!item) throw new Error('Item not found');

    // Remove from linked list
    await this.removeFromLinkedListNonTx(item);

    // Delete the node (cascades to children and related tables)
    await db.delete(nodes).where(eq(nodes.id, itemId));
  }

  // Helper methods
  private findTailSibling(tx: any, namespace: string, parentId?: number) {
    const whereClause = parentId 
      ? and(
          eq(nodes.namespace, namespace), 
          eq(nodes.parentId, parentId),
          isNull(nodes.nextSiblingId)
        )
      : and(
          eq(nodes.namespace, namespace), 
          isNull(nodes.parentId),
          isNull(nodes.nextSiblingId)
        );

    return tx.select().from(nodes).where(whereClause).get();
  }

  private async findTailSiblingNonTx(namespace: string, parentId?: number) {
    const whereClause = parentId 
      ? and(
          eq(nodes.namespace, namespace), 
          eq(nodes.parentId, parentId),
          isNull(nodes.nextSiblingId)
        )
      : and(
          eq(nodes.namespace, namespace), 
          isNull(nodes.parentId),
          isNull(nodes.nextSiblingId)
        );

    return await db.select().from(nodes).where(whereClause).get();
  }

  private async removeFromLinkedList(tx: any, item: Node): Promise<void> {
    // Update previous sibling's next pointer
    if (item.prevSiblingId) {
      await tx.update(nodes)
        .set({ 
          nextSiblingId: item.nextSiblingId,
          updatedAt: Math.floor(Date.now() / 1000)
        })
        .where(eq(nodes.id, item.prevSiblingId));
    }

    // Update next sibling's previous pointer
    if (item.nextSiblingId) {
      await tx.update(nodes)
        .set({ 
          prevSiblingId: item.prevSiblingId,
          updatedAt: Math.floor(Date.now() / 1000)
        })
        .where(eq(nodes.id, item.nextSiblingId));
    }
  }

  private async removeFromLinkedListNonTx(item: Node): Promise<void> {
    // Update previous sibling's next pointer
    if (item.prevSiblingId) {
      await db.update(nodes)
        .set({ 
          nextSiblingId: item.nextSiblingId,
          updatedAt: Math.floor(Date.now() / 1000)
        })
        .where(eq(nodes.id, item.prevSiblingId));
    }

    // Update next sibling's previous pointer
    if (item.nextSiblingId) {
      await db.update(nodes)
        .set({ 
          prevSiblingId: item.prevSiblingId,
          updatedAt: Math.floor(Date.now() / 1000)
        })
        .where(eq(nodes.id, item.nextSiblingId));
    }
  }

  private async insertIntoLinkedList(
    tx: any, 
    namespace: string, 
    itemId: number, 
    parentId: number | null, 
    afterItemId?: number
  ): Promise<void> {
    if (afterItemId) {
      // Insert after specific item
      const afterItem = await tx.select().from(nodes).where(eq(nodes.id, afterItemId)).get();
      if (!afterItem) throw new Error('After item not found');

      const nextItem = afterItem.nextSiblingId;

      // Update the item being moved
      await tx.update(nodes)
        .set({ 
          prevSiblingId: afterItemId,
          nextSiblingId: nextItem,
          updatedAt: Math.floor(Date.now() / 1000)
        })
        .where(eq(nodes.id, itemId));

      // Update the after item
      await tx.update(nodes)
        .set({ 
          nextSiblingId: itemId,
          updatedAt: Math.floor(Date.now() / 1000)
        })
        .where(eq(nodes.id, afterItemId));

      // Update the next item if it exists
      if (nextItem) {
        await tx.update(nodes)
          .set({ 
            prevSiblingId: itemId,
            updatedAt: Math.floor(Date.now() / 1000)
          })
          .where(eq(nodes.id, nextItem));
      }
    } else {
      // Insert at the end
      const tail = await this.findTailSibling(tx, namespace, parentId || undefined);
      
      await tx.update(nodes)
        .set({ 
          prevSiblingId: tail?.id || null,
          nextSiblingId: null,
          updatedAt: Math.floor(Date.now() / 1000)
        })
        .where(eq(nodes.id, itemId));

      if (tail) {
        await tx.update(nodes)
          .set({ 
            nextSiblingId: itemId,
            updatedAt: Math.floor(Date.now() / 1000)
          })
          .where(eq(nodes.id, tail.id));
      }
    }
  }

  private async insertIntoLinkedListNonTx(
    namespace: string, 
    itemId: number, 
    parentId: number | null, 
    afterItemId?: number
  ): Promise<void> {
    if (afterItemId) {
      // Insert after specific item
      const afterItem = await db.select().from(nodes).where(eq(nodes.id, afterItemId)).get();
      if (!afterItem) throw new Error('After item not found');

      const nextItem = afterItem.nextSiblingId;

      // Update the item being moved
      await db.update(nodes)
        .set({ 
          prevSiblingId: afterItemId,
          nextSiblingId: nextItem,
          updatedAt: Math.floor(Date.now() / 1000)
        })
        .where(eq(nodes.id, itemId));

      // Update the after item
      await db.update(nodes)
        .set({ 
          nextSiblingId: itemId,
          updatedAt: Math.floor(Date.now() / 1000)
        })
        .where(eq(nodes.id, afterItemId));

      // Update the next item if it exists
      if (nextItem) {
        await db.update(nodes)
          .set({ 
            prevSiblingId: itemId,
            updatedAt: Math.floor(Date.now() / 1000)
          })
          .where(eq(nodes.id, nextItem));
      }
    } else {
      // Insert at the end
      const tail = await this.findTailSiblingNonTx(namespace, parentId || undefined);
      
      await db.update(nodes)
        .set({ 
          prevSiblingId: tail?.id || null,
          nextSiblingId: null,
          updatedAt: Math.floor(Date.now() / 1000)
        })
        .where(eq(nodes.id, itemId));

      if (tail) {
        await db.update(nodes)
          .set({ 
            nextSiblingId: itemId,
            updatedAt: Math.floor(Date.now() / 1000)
          })
          .where(eq(nodes.id, tail.id));
      }
    }
  }

  private sortByLinkedList(items: BookmarkItem[]): BookmarkItem[] {
    if (items.length === 0) return items;

    // Find head (item with no prev sibling)
    const head = items.find(item => item.prevSiblingId === null);
    if (!head) return items; // Fallback to unsorted if no head found

    // Build ordered list
    const ordered: BookmarkItem[] = [];
    const itemMap = new Map(items.map(item => [item.id, item]));
    
    let current: BookmarkItem | null = head;
    while (current) {
      ordered.push(current);
      if (!current.nextSiblingId) break;
      current = itemMap.get(current.nextSiblingId) || null;
    }

    return ordered;
  }
}
