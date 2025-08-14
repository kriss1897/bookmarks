import React from "react";
import { Button } from "@/components/ui/button";
import { isFolder, type TreeNode } from "@/lib/bookmarksTree";
import { TreeOpsBuilder, type OperationEnvelope } from "@/lib/treeOps";
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
import { createContext, useContext } from "react";

// Lightweight, accessible demo of BookmarkTree operations
export const BookmarksDemo: React.FC = () => {
  const [builder, setBuilder] = React.useState(() => new TreeOpsBuilder());
  const tree = builder.tree;
  const [, force] = React.useReducer((c: number) => c + 1, 0);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [hoveredFolderId, setHoveredFolderId] = React.useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor)
  );

  // Start from empty (root only). No initial seeding.

  const handleAddFolder = (parentId: string) => {
    builder.createFolder({ parentId, title: `New Folder` });
    force();
  };

  const handleAddBookmark = (parentId: string) => {
    const n = Math.floor(Math.random() * 1000);
    builder.createBookmark({ parentId, title: `Link ${n}`, url: `https://example.com/${n}` });
    force();
  };

  const handleToggle = (folderId: string) => {
    builder.toggleFolder({ folderId });
    force();
  };

  const handleRemove = (id: string) => {
    if (window.confirm("Remove item?")) {
      builder.removeNode({ nodeId: id });
      force();
    }
  };

  const handleMoveUp = (parentId: string, index: number) => {
    if (index <= 0) return;
    builder.reorder({ folderId: parentId, fromIndex: index, toIndex: index - 1 });
    force();
  };

  const handleMoveDown = (parentId: string, index: number) => {
    const folder = tree.requireFolder(parentId);
    if (index >= folder.children.length - 1) return;
    builder.reorder({ folderId: parentId, fromIndex: index, toIndex: index + 1 });
    force();
  };

  const handleDragStart = (event: DragStartEvent) => {
    const id = String(event.active.id);
    setActiveId(id);
    setHoveredFolderId(null);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const overId = event.over ? String(event.over.id) : null;
    if (!overId) {
      setHoveredFolderId(null);
      return;
    }
    if (overId === ROOT_DROPZONE_ID) {
      setHoveredFolderId(null);
      return;
    }
    if (overId.startsWith(FOLDER_DROPZONE_PREFIX)) {
      setHoveredFolderId(overId.slice(FOLDER_DROPZONE_PREFIX.length));
      return;
    }
    const overNode = tree.getNode(overId);
    if (overNode && isFolder(overNode)) {
      setHoveredFolderId(overNode.id);
      return;
    }
    setHoveredFolderId(null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const active = String(event.active.id);
    const over = event.over ? String(event.over.id) : null;
    if (!over || active === over) {
      setActiveId(null);
      setHoveredFolderId(null);
      return;
    }

    const activeNode = tree.getNode(active);
    if (!activeNode) {
      setActiveId(null);
      setHoveredFolderId(null);
      return;
    }

    // Special case: root drop zone
    if (over === ROOT_DROPZONE_ID) {
      builder.moveNode({ nodeId: active, toFolderId: tree.rootId, index: 0 });
      setActiveId(null);
      setHoveredFolderId(null);
      force();
      return;
    }

    // Special case: empty folder drop zone
    if (over.startsWith(FOLDER_DROPZONE_PREFIX)) {
      const folderId = over.slice(FOLDER_DROPZONE_PREFIX.length);
      builder.moveItemToFolder({ nodeId: active, toFolderId: folderId, index: 0 });
      setActiveId(null);
      setHoveredFolderId(null);
      force();
      return;
    }

    const overNode = tree.getNode(over);
    if (!overNode) {
      setActiveId(null);
      setHoveredFolderId(null);
      return;
    }

    // Determine target folder and index using current structure
    let targetFolderId: string;
    let targetIndex: number | undefined;

    if (isFolder(overNode)) {
      // Dropped onto a folder header -> append to that folder
      targetFolderId = overNode.id;
      targetIndex = tree.requireFolder(targetFolderId).children.length; // append
    } else {
      // Dropped over an item -> insert before that item in its parent
      targetFolderId = overNode.parentId!;
      const parent = tree.requireFolder(targetFolderId);
      targetIndex = parent.children.indexOf(overNode.id);
    }

    // Move using tree logic (computes new orderKey)
  builder.moveNode({ nodeId: active, toFolderId: targetFolderId, index: targetIndex });
    setActiveId(null);
    setHoveredFolderId(null);
    force();
  };

  const handleMenuAction = (
    ctx: { action: MenuAction; nodeId: string; parentId: string; index: number }
  ) => {
    const { action, nodeId, parentId, index } = ctx;
    const n = tree.getNode(nodeId);
    if (!n) return;
    switch (action) {
      case "createBookmark": {
        const targetParent = isFolder(n) ? n.id : parentId;
        handleAddBookmark(targetParent);
        break;
      }
      case "createFolder": {
        const targetParent = isFolder(n) ? n.id : parentId;
        handleAddFolder(targetParent);
        break;
      }
      case "remove": {
        handleRemove(nodeId);
        break;
      }
      case "moveUp": {
        handleMoveUp(parentId, index);
        break;
      }
      case "moveDown": {
        handleMoveDown(parentId, index);
        break;
      }
      default:
        break;
    }
  };

  const renderNode = (node: TreeNode, idx: number, parentId: string) => {
    const index = idx;
    if (isFolder(node)) {
      const children = tree.listChildren(node.id);
      const hovered = hoveredFolderId === node.id;
      return (
        <div key={node.id} className={"mb-2 rounded-lg border p-2 " + (hovered ? "bg-accent/30" : "")}>
          <div className="flex items-center gap-2">
            <DragHandle />
            <button
              className="rounded px-2 py-1 text-left text-sm font-medium hover:bg-accent"
              onClick={() => handleToggle(node.id)}
              onKeyDown={(e) => e.key === "Enter" && handleToggle(node.id)}
              aria-label={node.isOpen ? "Close folder" : "Open folder"}
              tabIndex={0}
            >
              {node.isOpen ? "📂" : "📁"} {node.title}
              <span className="ml-2 rounded bg-accent px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                {node.orderKey ?? "-"}
              </span>
            </button>
            <div className="grow"></div>
            <ItemMenu onMenu={(action) => handleMenuAction({ action, nodeId: node.id, parentId, index })} />
          </div>

          {node.isOpen && (
            <div className="ml-4 mt-2 flex flex-col gap-1">
              {children.length === 0 ? (
                <FolderDropZone folderId={node.id} />
              ) : (
                <SortableContext items={children.map((c) => c.id)} strategy={verticalListSortingStrategy}>
                  {children.map((child, i) => (
                    <SortableItem key={child.id} id={child.id}>
                      {renderNode(child, i, node.id)}
                    </SortableItem>
                  ))}
                </SortableContext>
              )}
            </div>
          )}
        </div>
      );
    }

    return (
      <div key={node.id} className="flex items-center gap-2 rounded border p-2" data-id={node.id}>
        <DragHandle />
        <a
          href={node.kind === "bookmark" ? node.url : "#"}
          target="_blank"
          rel="noreferrer"
          className="truncate text-sm underline"
          tabIndex={0}
          aria-label={`Open ${node.title}`}
        >
          🔗 {node.title}
        </a>
        <span className="rounded bg-accent px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
          {node.orderKey ?? "-"}
        </span>
        <div className="grow"></div>
        <ItemMenu onMenu={(action) => handleMenuAction({ action, nodeId: node.id, parentId, index })} />
      </div>
    );
  };

  const root = tree.root;
  const rootChildren = tree.listChildren(root.id);
  const ops: OperationEnvelope[] = builder.log;

  const handleReset = () => {
    setBuilder(new TreeOpsBuilder());
    setActiveId(null);
    setHoveredFolderId(null);
  };

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd}>
      <div className="flex w-full max-w-2xl flex-col gap-3 p-4">
        <div className="flex items-center gap-2">
          <div className="text-xl font-semibold">Bookmarks Demo (Ops-driven)</div>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="secondary" onClick={() => handleAddFolder(root.id)}>+ Root Folder</Button>
            <Button onClick={() => handleAddBookmark(root.id)}>+ Root Bookmark</Button>
            <Button variant="outline" onClick={handleReset}>Reset</Button>
          </div>
        </div>
        <div className="text-xs text-muted-foreground">Drag and drop enabled (nested). Ordering uses fractional keys.</div>
        <RootDropZone />
        <div className="mt-2 space-y-2">
          {rootChildren.length === 0 ? (
            <div className="rounded border p-4 text-sm text-muted-foreground">No items yet. Use the buttons above to add some.</div>
          ) : (
            <SortableContext items={rootChildren.map((c) => c.id)} strategy={verticalListSortingStrategy}>
              {rootChildren.map((child, i) => (
                <SortableItem key={child.id} id={child.id}>
                  {renderNode(child, i, root.id)}
                </SortableItem>
              ))}
            </SortableContext>
          )}
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div>
            <div className="mb-1 text-xs font-medium text-muted-foreground">Serialized tree (JSON)</div>
            <pre
              className="max-h-64 overflow-auto rounded-md border bg-accent/20 p-3 font-mono text-[11px] leading-tight"
              aria-label="Serialized bookmarks tree JSON"
              tabIndex={0}
            >
              {JSON.stringify(tree.serialize(), null, 2)}
            </pre>
          </div>
          <div>
            <div className="mb-1 text-xs font-medium text-muted-foreground">Operations log</div>
            <div className="max-h-64 overflow-auto rounded-md border bg-accent/10 p-2">
              {ops.length === 0 ? (
                <div className="p-2 text-xs text-muted-foreground">No operations yet.</div>
              ) : (
                <ol className="space-y-1 text-xs">
                  {ops.map((env, i) => (
                    <li key={env.id} className="rounded bg-background p-1">
                      <span className="mr-2 inline-block w-5 text-right text-muted-foreground">{i + 1}.</span>
                      <code className="font-mono">{formatOp(env)}</code>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        </div>
      </div>
      <DragOverlay>
        {activeId ? <DragPreview node={tree.getNode(activeId)!} /> : null}
      </DragOverlay>
    </DndContext>
  );
};

// Pretty printer for operations (compact one-liners)
function formatOp(env: OperationEnvelope): string {
  const { op } = env;
  switch (op.type) {
    case "create_folder":
      return `create_folder(title=${op.title}${op.parentId ? ", parent=" + op.parentId : ""}${
        typeof op.index === "number" ? ", index=" + op.index : ""
      })`;
    case "create_bookmark":
      return `create_bookmark(title=${op.title}, url=${op.url}${op.parentId ? ", parent=" + op.parentId : ""}${
        typeof op.index === "number" ? ", index=" + op.index : ""
      })`;
    case "move_node":
    case "move_item_to_folder":
      return `${op.type}(id=${op.nodeId} -> ${op.toFolderId}${
        typeof op.index === "number" ? ", index=" + op.index : ""
      })`;
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

const ROOT_DROPZONE_ID = "root-dropzone" as const;
const FOLDER_DROPZONE_PREFIX = "folder-dropzone:" as const;

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

// Sortable wrapper for each row
type DragCtx = {
  attributes: ReturnType<typeof useSortable>["attributes"];
  listeners: ReturnType<typeof useSortable>["listeners"];
  setActivatorNodeRef: ReturnType<typeof useSortable>["setActivatorNodeRef"];
};

const DragHandleContext = createContext<DragCtx | null>(null);

const useDragHandle = () => useContext(DragHandleContext);

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

const DragPreview: React.FC<{ node: TreeNode }> = ({ node }) => {
  if (isFolder(node)) {
    return <div className="rounded border bg-background px-2 py-1 text-sm">📁 {node.title}</div>;
  }
  return <div className="rounded border bg-background px-2 py-1 text-sm">🔗 {node.title}</div>;
};

type MenuAction = "createBookmark" | "createFolder" | "remove" | "moveUp" | "moveDown";

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

const MenuItem: React.FC<{ icon?: React.ReactNode; label: string; onClick: () => void; className?: string }> = ({ icon, label, onClick, className }) => (
  <button
    className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-accent ${className ?? ""}`}
    onClick={onClick}
    role="menuitem"
  >
    {icon}
    <span>{label}</span>
  </button>
);
