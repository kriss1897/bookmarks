/**
 * Core types for the general tree system
 */

export type NodeId = string;

export interface BaseTreeNode {
  id: NodeId;
  parentId: NodeId | null;
  createdAt: number;
  updatedAt: number;
  orderKey?: string; // For fractional indexing
}

export interface SerializedTree<T extends BaseTreeNode = BaseTreeNode> {
  rootId: NodeId;
  nodes: Record<NodeId, T>;
}

export interface TreeChangeEvent<T extends BaseTreeNode = BaseTreeNode> {
  type: 'nodeAdded' | 'nodeUpdated' | 'nodeRemoved' | 'treeClear';
  nodeId?: NodeId;
  node?: T;
  previousNode?: T;
}

export type TreeChangeListener<T extends BaseTreeNode = BaseTreeNode> = (event: TreeChangeEvent<T>) => void;

/**
 * Configuration for tree initialization
 */
export interface TreeConfig<T extends BaseTreeNode = BaseTreeNode> {
  rootNodeData?: Partial<T>;
  initialData?: SerializedTree<T>;
  enableEvents?: boolean;
}
