import { eq } from 'drizzle-orm';
import { db } from './index.js';
import { bookmarks } from './schema.js';
import type { NewBookmark, Bookmark } from './schema.js';

export class BookmarksRepository {
  async createBookmarkRow(bookmarkData: NewBookmark): Promise<Bookmark> {
    const [row] = await db.insert(bookmarks).values(bookmarkData).returning();
    return row;
  }

  async getBookmarkByNodeId(nodeId: string): Promise<Bookmark | null> {
    const [row] = await db.select().from(bookmarks).where(eq(bookmarks.nodeId, nodeId));
    return row || null;
  }

  async updateBookmark(nodeId: string, updates: Partial<NewBookmark>): Promise<Bookmark | null> {
    const [updated] = await db.update(bookmarks).set(updates).where(eq(bookmarks.nodeId, nodeId)).returning();
    return updated || null;
  }
}
