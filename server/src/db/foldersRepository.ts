import { eq } from 'drizzle-orm';
import { db } from './index.js';
import { folders } from './schema.js';
import type { NewFolder, Folder } from './schema.js';

export class FoldersRepository {
  async createFolderRow(folderData: NewFolder): Promise<Folder> {
    const [row] = await db.insert(folders).values(folderData).returning();
    return row;
  }

  async getFolderByNodeId(nodeId: string): Promise<Folder | null> {
    const [row] = await db.select().from(folders).where(eq(folders.nodeId, nodeId));
    return row || null;
  }

  async updateFolder(nodeId: string, updates: Partial<NewFolder>): Promise<Folder | null> {
    const [updated] = await db.update(folders).set(updates).where(eq(folders.nodeId, nodeId)).returning();
    return updated || null;
  }
}
