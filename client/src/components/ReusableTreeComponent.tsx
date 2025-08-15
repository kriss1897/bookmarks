/**
 * Generic reusable tree component for bookmarks/folders
 * Supports drag-and-drop, menu actions, and custom data sources
 */

import React, { createContext, useContext } from "react";
import { Button } from "@/components/ui/button";
import { isFolder, type BookmarkTreeNode } from "@/lib/tree/BookmarkTree";
import type { TreeOperation } from "@/lib/builder/treeBuilder";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDroppable,
} from "@dnd-kit/core";
import type { DragEndEvent, DragStartEvent, DragOverEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, MoreVertical, ArrowUp, ArrowDown, FolderPlus, Plus, Trash2 } from "lucide-react";

// Types for the reusable tree component
export interface TreeOperations {
  createFolder: (parentId: string, title?: string, index?: number) => void | Promise<void>;
  createBookmark: (parentId: string, title?: string, url?: string, index?: number) => void | Promise<void>;
  toggleFolder: (folderId: string) => void | Promise<void>;
  removeNode: (nodeId: string) => void | Promise<void>;
  moveUp: (parentId: string, index: number) => void | Promise<void>;
  moveDown: (parentId: string, index: number) => void | Promise<void>;
  moveNode: (nodeId: string, targetFolderId: string, index?: number) => void | Promise<void>;
}

export interface TreeState {
  nodes: Record<string, BookmarkTreeNode>;
  rootId: string;
  operations?: Array<{ id: string; op: TreeOperation }>;
}

export interface TreeComponentProps {
  state: TreeState;
  operations: TreeOperations;
  title?: string;
  showOperationsLog?: boolean;
  showSerializedTree?: boolean;
  onReset?: () => void;
  className?: string;
}

type MenuAction = "createBookmark" | "createFolder" | "remove" | "moveUp" | "moveDown";

const ROOT_DROPZONE_ID = "root-dropzone" as const;
const FOLDER_DROPZONE_PREFIX = "folder-dropzone:" as const;

// Drag handle context for sortable items
type DragCtx = {
  attributes: ReturnType<typeof useSortable>["attributes"];
  listeners: ReturnType<typeof useSortable>["listeners"];
  setActivatorNodeRef: ReturnType<typeof useSortable>["setActivatorNodeRef"];
};

const DragHandleContext = createContext<DragCtx | null>(null);
const useDragHandle = () => useContext(DragHandleContext);

export const ReusableTreeComponent: React.FC<TreeComponentProps> = ({
  state,
  operations,
  title = "Bookmarks Tree",
  showOperationsLog = true,
  showSerializedTree = true,
  onReset,
  className = ""
}) => {
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [hoveredFolderId, setHoveredFolderId] = React.useState<string | null>(null);
  const [dropHint, setDropHint] = React.useState<string | null>(null);
  const [dragPreviewNode, setDragPreviewNode] = React.useState<BookmarkTreeNode | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor)
  );

  const { nodes, rootId } = state;
  const rootNode = nodes[rootId];
  const rootChildren = rootNode?.kind === 'folder' 
    ? rootNode.children.map(id => nodes[id]).filter(Boolean).sort((a, b) => {
        const aKey = a.orderKey || '';
        const bKey = b.orderKey || '';
        return aKey.localeCompare(bKey);
      })
    : [];

  // Load drag preview node
  React.useEffect(() => {
    if (activeId && nodes[activeId]) {
      setDragPreviewNode(nodes[activeId]);
    } else {
      setDragPreviewNode(null);
    }
  }, [activeId, nodes]);

  if (!rootNode) {
    return <div className="p-4">Loading tree...</div>;
  }

  const handleAddFolder = async (parentId: string) => {
    const parent = nodes[parentId];
    const index = parent?.kind === 'folder' ? parent.children.length : 0;
    await operations.createFolder(parentId, "New Folder", index);
  };

  const handleAddBookmark = async (parentId: string) => {
    const n = Math.floor(Math.random() * 1000);
    const parent = nodes[parentId];
    const index = parent?.kind === 'folder' ? parent.children.length : 0;
    await operations.createBookmark(parentId, `Link ${n}`, `https://example.com/${n}`, index);
  };

  const handleDragStart = (event: DragStartEvent) => {
    const id = String(event.active.id);
    setActiveId(id);
    setHoveredFolderId(null);
    setDropHint("Dragging…");
  };

  const handleDragOver = async (event: DragOverEvent) => {
    const overId = event.over ? String(event.over.id) : null;
    if (!overId) {
      setHoveredFolderId(null);
      setDropHint(null);
      return;
    }
    if (overId === ROOT_DROPZONE_ID) {
      setHoveredFolderId(null);
      setDropHint(`Move to Root (top)`);
      return;
    }
    if (overId.startsWith(FOLDER_DROPZONE_PREFIX)) {
      const folderId = overId.slice(FOLDER_DROPZONE_PREFIX.length);
      setHoveredFolderId(folderId);
      const f = nodes[folderId];
      setDropHint(`Move into ${(f && isFolder(f) ? f.title : "folder")} (top)`);
      return;
    }
    const overNode = nodes[overId];
    if (overNode && isFolder(overNode)) {
      setHoveredFolderId(overNode.id);
      setDropHint(`Move into ${overNode.title} (append)`);
      return;
    }
    setHoveredFolderId(null);
    if (overNode && overNode.parentId) {
      const parent = nodes[overNode.parentId];
      const self = activeId === overNode.id;
      setDropHint(
        self
          ? `Drop here will keep position`
          : `Insert before ${overNode.title} in ${parent?.id === rootId ? "Root" : parent?.title || "unknown"}`
      );
      return;
    }
    setDropHint(null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const active = String(event.active.id);
    const over = event.over ? String(event.over.id) : null;
    if (!over || active === over) {
      setActiveId(null);
      setHoveredFolderId(null);
      setDropHint(null);
      return;
    }

    const activeNode = nodes[active];
    if (!activeNode) {
      setActiveId(null);
      setHoveredFolderId(null);
      setDropHint(null);
      return;
    }

    // Special case: root drop zone
    if (over === ROOT_DROPZONE_ID) {
      await operations.moveNode(active, rootId, 0);
      setActiveId(null);
      setHoveredFolderId(null);
      setDropHint(null);
      return;
    }

    // Special case: empty folder drop zone
    if (over.startsWith(FOLDER_DROPZONE_PREFIX)) {
      const folderId = over.slice(FOLDER_DROPZONE_PREFIX.length);
      await operations.moveNode(active, folderId, 0);
      setActiveId(null);
      setHoveredFolderId(null);
      setDropHint(null);
      return;
    }

    const overNode = nodes[over];
    if (!overNode) {
      setActiveId(null);
      setHoveredFolderId(null);
      return;
    }

    // Determine target folder and index
    let targetFolderId: string;
    let targetIndex: number | undefined;

    if (isFolder(overNode)) {
      // Dropped onto a folder header -> append to that folder
      targetFolderId = overNode.id;
      targetIndex = overNode.children.length;
    } else {
      // Dropped over an item -> insert before that item in its parent
      targetFolderId = overNode.parentId!;
      const parent = nodes[targetFolderId];
      targetIndex = parent?.kind === 'folder' ? parent.children.indexOf(overNode.id) : 0;
    }

    await operations.moveNode(active, targetFolderId, targetIndex);
    setActiveId(null);
    setHoveredFolderId(null);
    setDropHint(null);
  };

  const handleMenuAction = async (
    ctx: { action: MenuAction; nodeId: string; parentId: string; index: number }
  ) => {
    const { action, nodeId, parentId, index } = ctx;
    const n = nodes[nodeId];
    if (!n) return;

    switch (action) {
      case "createBookmark": {
        const targetParent = isFolder(n) ? n.id : parentId;
        await handleAddBookmark(targetParent);
        break;
      }
      case "createFolder": {
        const targetParent = isFolder(n) ? n.id : parentId;
        await handleAddFolder(targetParent);
        break;
      }
      case "remove": {
        if (window.confirm("Remove item?")) {
          await operations.removeNode(nodeId);
        }
        break;
      }
      case "moveUp": {
        await operations.moveUp(parentId, index);
        break;
      }
      case "moveDown": {
        await operations.moveDown(parentId, index);
        break;
      }
      default:
        break;
    }
  };

  // Folder node component that manages its own children
  const FolderNodeComponent: React.FC<{
    node: BookmarkTreeNode & { kind: 'folder' };
    idx: number;
    parentId: string;
    nodes: Record<string, BookmarkTreeNode>;
    operations: TreeOperations;
    onMenuAction: (ctx: { action: MenuAction; nodeId: string; parentId: string; index: number }) => void;
    hoveredFolderId: string | null;
  }> = ({ node, idx, parentId, nodes, operations, onMenuAction, hoveredFolderId }) => {
    // Children are already available in the node - sort them by orderKey
    const children = node.children.map(id => nodes[id]).filter(Boolean).sort((a, b) => {
      const aKey = a.orderKey || '';
      const bKey = b.orderKey || '';
      return aKey.localeCompare(bKey);
    });

    const {
      attributes,
      listeners,
      setNodeRef,
      transform,
      transition,
      setActivatorNodeRef,
    } = useSortable({ id: node.id });

    const style = {
      transform: CSS.Transform.toString(transform),
      transition,
    };

    const dragContext: DragCtx = { attributes, listeners, setActivatorNodeRef };
    const hovered = hoveredFolderId === node.id;

    return (
      <div ref={setNodeRef} style={style}>
        <div className={"mb-2 rounded-lg border p-2 " + (hovered ? "bg-accent/30" : "")}>
          <div className="flex items-center gap-2">
            <DragHandleContext.Provider value={dragContext}>
              <DragHandle />
            </DragHandleContext.Provider>
            <button
              className="rounded px-2 py-1 text-left text-sm font-medium hover:bg-accent"
              onClick={async () => await operations.toggleFolder(node.id)}
              onKeyDown={async (e) => e.key === "Enter" && await operations.toggleFolder(node.id)}
              aria-label={node.isOpen ? "Close folder" : "Open folder"}
              tabIndex={0}
            >
              {node.isOpen ? "📂" : "📁"} {node.title}
              <span className="ml-2 rounded bg-accent px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                {node.orderKey ?? "-"}
              </span>
            </button>
            <div className="grow"></div>
            <ItemMenu onMenu={(action) => onMenuAction({ action, nodeId: node.id, parentId, index: idx })} />
          </div>

          {node.isOpen && (
            <div className="mt-2 ml-4">
              {children.length > 0 ? (
                <SortableContext items={children.map((c: BookmarkTreeNode) => c.id)} strategy={verticalListSortingStrategy}>
                  {children.map((child: BookmarkTreeNode, i: number) => (
                    <TreeNodeRenderer
                      key={child.id}
                      node={child}
                      idx={i}
                      parentId={node.id}
                      nodes={nodes}
                      operations={operations}
                      onMenuAction={onMenuAction}
                      hoveredFolderId={hoveredFolderId}
                    />
                  ))}
                </SortableContext>
              ) : (
                <div className="text-sm text-muted-foreground">Empty folder</div>
              )}
              <div className="mt-1">
                <FolderDropZone folderId={node.id} />
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };  // Bookmark node component
  const BookmarkNodeComponent: React.FC<{
    node: BookmarkTreeNode & { kind: 'bookmark' };
    idx: number;
    parentId: string;
    onMenuAction: (ctx: { action: MenuAction; nodeId: string; parentId: string; index: number }) => void;
  }> = ({ node, idx, parentId, onMenuAction }) => {
    const {
      attributes,
      listeners,
      setNodeRef,
      transform,
      transition,
      setActivatorNodeRef,
    } = useSortable({ id: node.id });

    const style = {
      transform: CSS.Transform.toString(transform),
      transition,
    };

    const dragContext: DragCtx = { attributes, listeners, setActivatorNodeRef };

    return (
      <div ref={setNodeRef} style={style}>
        <div className="mb-2 rounded-lg border bg-card p-2">
          <div className="flex items-center gap-2">
            <DragHandleContext.Provider value={dragContext}>
              <DragHandle />
            </DragHandleContext.Provider>
            <a
              href={node.url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded px-2 py-1 text-left text-sm hover:bg-accent flex-1"
              tabIndex={0}
            >
              🔗 {node.title}
              <span className="ml-2 rounded bg-accent px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                {node.orderKey ?? "-"}
              </span>
              <div className="text-xs text-muted-foreground mt-1 truncate">{node.url}</div>
            </a>
            <ItemMenu onMenu={(action) => onMenuAction({ action, nodeId: node.id, parentId, index: idx })} />
          </div>
        </div>
      </div>
    );
  };

  // Main tree node renderer
  const TreeNodeRenderer: React.FC<{
    node: BookmarkTreeNode;
    idx: number;
    parentId: string;
    nodes: Record<string, BookmarkTreeNode>;
    operations: TreeOperations;
    onMenuAction: (ctx: { action: MenuAction; nodeId: string; parentId: string; index: number }) => void;
    hoveredFolderId: string | null;
  }> = ({ node, idx, parentId, nodes, operations, onMenuAction, hoveredFolderId }) => {
    if (isFolder(node)) {
      return (
        <FolderNodeComponent
          node={node}
          idx={idx}
          parentId={parentId}
          nodes={nodes}
          operations={operations}
          onMenuAction={onMenuAction}
          hoveredFolderId={hoveredFolderId}
        />
      );
    } else {
      return (
        <BookmarkNodeComponent
          node={node as BookmarkTreeNode & { kind: 'bookmark' }}
          idx={idx}
          parentId={parentId}
          onMenuAction={onMenuAction}
        />
      );
    }
  };

  const renderNode = (node: BookmarkTreeNode, idx: number, parentId: string) => {
    return (
      <TreeNodeRenderer
        key={node.id}
        node={node}
        idx={idx}
        parentId={parentId}
        nodes={nodes}
        operations={operations}
        onMenuAction={handleMenuAction}
        hoveredFolderId={hoveredFolderId}
      />
    );
  };

  return (
    <div className={className}>
      <div className="flex w-full max-w-2xl flex-col gap-3 p-4">
        <div className="flex items-center gap-2">
          <div className="text-xl font-semibold">{title}</div>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="secondary" onClick={() => handleAddFolder(rootNode.id)}>+ Root Folder</Button>
            <Button onClick={() => handleAddBookmark(rootNode.id)}>+ Root Bookmark</Button>
            {onReset && <Button variant="outline" onClick={onReset}>Reset</Button>}
          </div>
        </div>

        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          <div className="text-xs text-muted-foreground">Drag and drop enabled (nested). Ordering uses fractional keys.</div>
          <RootDropZone />
          <div className="mt-2 space-y-2">
            {rootChildren.length === 0 ? (
              <div className="rounded border p-4 text-sm text-muted-foreground">
                No items yet. Use the buttons above to add some.
              </div>
            ) : (
              <SortableContext items={rootChildren.map((c) => c.id)} strategy={verticalListSortingStrategy}>
                {rootChildren.map((child, i) => (
                  <SortableItem key={child.id} id={child.id}>
                    {renderNode(child, i, rootNode.id)}
                  </SortableItem>
                ))}
              </SortableContext>
            )}
          </div>

          {(showSerializedTree || showOperationsLog) && (
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {showSerializedTree && (
                <div>
                  <div className="mb-1 text-xs font-medium text-muted-foreground">Serialized tree (JSON)</div>
                  <pre
                    className="max-h-64 overflow-auto rounded-md border bg-accent/20 p-3 font-mono text-[11px] leading-tight"
                    aria-label="Serialized bookmarks tree JSON"
                    tabIndex={0}
                  >
                    {JSON.stringify(nodes, null, 2)}
                  </pre>
                </div>
              )}

              {showOperationsLog && state.operations && (
                <div>
                  <div className="mb-1 text-xs font-medium text-muted-foreground">Operations log</div>
                  <div className="max-h-64 overflow-auto rounded-md border bg-accent/10 p-2">
                    {state.operations.length === 0 ? (
                      <div className="p-2 text-xs text-muted-foreground">No operations yet.</div>
                    ) : (
                      <ol className="space-y-1 text-xs">
                        {state.operations.map((env, i) => (
                          <li key={env.id} className="rounded bg-background p-1">
                            <span className="mr-2 inline-block w-5 text-right text-muted-foreground">{i + 1}.</span>
                            <code className="font-mono">{formatOp(env)}</code>
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          <DragOverlay>
            {dragPreviewNode ? <DragPreview node={dragPreviewNode} hint={dropHint ?? undefined} /> : null}
          </DragOverlay>
        </DndContext>
      </div>
    </div>
  );
};

// Helper components
const RootDropZone: React.FC = () => {
  const { isOver, setNodeRef } = useDroppable({ id: ROOT_DROPZONE_ID });
  return (
    <div
      ref={setNodeRef}
      className={
        `mt-2 w-full rounded-md border-2 border-dashed p-3 text-center text-xs transition-colors ` +
        (isOver ? "border-primary bg-primary/10 text-primary" : "border-muted-foreground/30 text-muted-foreground")
      }
      aria-label="Drop here to move to root at top"
      tabIndex={0}
    >
      Drop here to move item to Root (top)
    </div>
  );
};

const FolderDropZone: React.FC<{ folderId: string }> = ({ folderId }) => {
  const id = `${FOLDER_DROPZONE_PREFIX}${folderId}`;
  const { isOver, setNodeRef } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={
        `w-full rounded-md border-2 border-dashed p-3 text-center text-xs transition-colors ` +
        (isOver ? "border-primary bg-primary/10 text-primary" : "border-muted-foreground/30 text-muted-foreground")
      }
      aria-label="Drop here to move into this folder (top)"
      tabIndex={0}
    >
      Drop here to move item into this folder (top)
    </div>
  );
};

const SortableItem: React.FC<React.PropsWithChildren<{ id: string }>> = ({ id, children }) => {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  return (
    <div ref={setNodeRef} style={style}>
      <DragHandleContext.Provider value={{ attributes, listeners, setActivatorNodeRef }}>
        {children}
      </DragHandleContext.Provider>
    </div>
  );
};

const DragPreview: React.FC<{ node: BookmarkTreeNode; hint?: string }> = ({ node, hint }) => {
  return (
    <div className="rounded border bg-background px-2 py-1 text-sm">
      <div>{isFolder(node) ? "📁" : "🔗"} {node.title}</div>
      {hint ? <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div> : null}
    </div>
  );
};

const DragHandle: React.FC = () => {
  const drag = useDragHandle();
  return (
    <button
      ref={drag?.setActivatorNodeRef}
      {...(drag?.listeners ?? {})}
      className="inline-flex size-8 items-center justify-center rounded hover:bg-accent"
      aria-label="Drag"
      tabIndex={0}
    >
      <GripVertical className="size-4" />
    </button>
  );
};

const ItemMenu: React.FC<{ onMenu: (action: MenuAction) => void }> = ({ onMenu }) => {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="relative">
      <button
        className="inline-flex size-8 items-center justify-center rounded hover:bg-accent"
        aria-label="Open item menu"
        tabIndex={0}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") setOpen((v) => !v);
        }}
      >
        <MoreVertical className="size-4" />
      </button>
      {open && (
        <div
          className="absolute z-10 mt-1 w-40 rounded-md border bg-background p-1 text-sm shadow"
          role="menu"
          aria-label="Item actions"
        >
          <MenuItem icon={<Plus className="size-3.5" />} label="Create bookmark" onClick={() => { onMenu("createBookmark"); setOpen(false); }} />
          <MenuItem icon={<FolderPlus className="size-3.5" />} label="Create folder" onClick={() => { onMenu("createFolder"); setOpen(false); }} />
          <MenuItem icon={<ArrowUp className="size-3.5" />} label="Move up" onClick={() => { onMenu("moveUp"); setOpen(false); }} />
          <MenuItem icon={<ArrowDown className="size-3.5" />} label="Move down" onClick={() => { onMenu("moveDown"); setOpen(false); }} />
          <MenuItem icon={<Trash2 className="size-3.5" />} label="Remove" onClick={() => { onMenu("remove"); setOpen(false); }} className="text-destructive hover:bg-destructive/10" />
        </div>
      )}
    </div>
  );
};

const MenuItem: React.FC<{ icon?: React.ReactNode; label: string; onClick: () => void; className?: string }> = ({
  icon, label, onClick, className
}) => (
  <button
    className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-accent ${className ?? ""}`}
    onClick={onClick}
    role="menuitem"
  >
    {icon}
    <span>{label}</span>
  </button>
);

// Pretty printer for operations (compact one-liners)
function formatOp(env: { id: string; op: TreeOperation }): string {
  const { op } = env;
  switch (op.type) {
    case "create_folder":
      return `create_folder(title=${op.title}${op.parentId ? ", parent=" + op.parentId : ""}${typeof op.index === "number" ? ", index=" + op.index : ""})`;
    case "create_bookmark":
      return `create_bookmark(title=${op.title}, url=${op.url}${op.parentId ? ", parent=" + op.parentId : ""}${typeof op.index === "number" ? ", index=" + op.index : ""})`;
    case "move_node":
    case "move_item_to_folder":
      return `${op.type}(id=${op.nodeId} -> ${op.toFolderId}${typeof op.index === "number" ? ", index=" + op.index : ""})`;
    case "reorder":
      return `reorder(folder=${op.folderId}, ${op.fromIndex} -> ${op.toIndex})`;
    case "open_folder":
      return `open_folder(${op.folderId})`;
    case "close_folder":
      return `close_folder(${op.folderId})`;
    case "toggle_folder":
      return `toggle_folder(${op.folderId}${typeof op.open === "boolean" ? ", open=" + op.open : ""})`;
    case "remove_node":
      return `remove_node(${op.nodeId})`;
    default:
      return JSON.stringify(op);
  }
}
