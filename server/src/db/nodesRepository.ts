import { eq, isNull, and } from 'drizzle-orm';
import { db } from './index.js';
import { nodes } from './schema.js';
import type { NewNode, Node } from './schema.js';

export class NodesRepository {
  async createNode(nodeData: NewNode): Promise<Node> {
    const [node] = await db.insert(nodes).values(nodeData).returning();
    return node;
  }

  async getNodeRow(id: string): Promise<Node | null> {
    const [node] = await db.select().from(nodes).where(eq(nodes.id, id));
    return node || null;
  }

  async updateNodeBase(id: string, updates: Partial<NewNode>): Promise<Node | null> {
    const [updated] = await db.update(nodes).set(updates).where(eq(nodes.id, id)).returning();
    return updated || null;
  }

  async deleteNode(id: string): Promise<boolean> {
    const result = await db.delete(nodes).where(eq(nodes.id, id)).run();
    return result.changes > 0;
  }

  async getNodesByParentRows(parentId: string | null, namespace?: string) {
    if (parentId === null) {
      return namespace
        ? await db.select().from(nodes).where(and(isNull(nodes.parentId), eq(nodes.namespace, namespace)))
        : await db.select().from(nodes).where(isNull(nodes.parentId));
    }

    return namespace
      ? await db.select().from(nodes).where(and(eq(nodes.parentId, parentId), eq(nodes.namespace, namespace)))
      : await db.select().from(nodes).where(eq(nodes.parentId, parentId));
  }

  async getAllNodeRows() {
    return await db.select().from(nodes);
  }

  async getRootNodeRow() {
    const [node] = await db.select().from(nodes).where(isNull(nodes.parentId));
    return node || null;
  }

  async getAllNodeRowsByNamespace(namespace: string) {
    return await db.select().from(nodes).where(eq(nodes.namespace, namespace));
  }

  async getRootNodeRowByNamespace(namespace: string) {
    const [node] = await db
      .select()
      .from(nodes)
      .where(and(isNull(nodes.parentId), eq(nodes.namespace, namespace)));
    return node || null;
  }
}
