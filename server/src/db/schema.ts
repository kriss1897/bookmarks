import { relations } from 'drizzle-orm';
import { nodes, type Node, type NewNode } from '../models/nodes.js';
import { folders, type Folder, type NewFolder } from '../models/folders.js';
import { bookmarks, type Bookmark, type NewBookmark } from '../models/bookmarks.js';
import { folderState, type FolderState, type NewFolderState } from '../models/folderState.js';
import { operationLog, type OperationLog, type NewOperationLog } from '../models/operationLog.js';

// Relations
export const nodesRelations = relations(nodes, ({ one, many }) => ({
  parent: one(nodes, {
    fields: [nodes.parentId],
    references: [nodes.id],
    relationName: 'parent',
  }),
  children: many(nodes, {
    relationName: 'parent',
  }),
  folder: one(folders, {
    fields: [nodes.id],
    references: [folders.nodeId],
  }),
  bookmark: one(bookmarks, {
    fields: [nodes.id],
    references: [bookmarks.nodeId],
  }),
  folderState: one(folderState, {
    fields: [nodes.id],
    references: [folderState.nodeId],
  }),
}));

export const foldersRelations = relations(folders, ({ one }) => ({
  node: one(nodes, {
    fields: [folders.nodeId],
    references: [nodes.id],
  }),
}));

export const bookmarksRelations = relations(bookmarks, ({ one }) => ({
  node: one(nodes, {
    fields: [bookmarks.nodeId],
    references: [nodes.id],
  }),
}));

export const folderStateRelations = relations(folderState, ({ one }) => ({
  node: one(nodes, {
    fields: [folderState.nodeId],
    references: [nodes.id],
  }),
}));

// Type exports
export type { Node, NewNode, Folder, NewFolder, Bookmark, NewBookmark, FolderState, NewFolderState, OperationLog, NewOperationLog };
export { nodes, folders, bookmarks, folderState, operationLog };