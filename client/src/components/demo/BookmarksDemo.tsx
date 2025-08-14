import React from "react";
import { Button } from "@/components/ui/button";
import { BookmarkTree, isFolder, type TreeNode } from "@/lib/bookmarksTree";

// Lightweight, accessible demo of BookmarkTree operations
export const BookmarksDemo: React.FC = () => {
  const [tree, setTree] = React.useState(() => new BookmarkTree());
  const [, force] = React.useReducer((c: number) => c + 1, 0);

  // Build some initial data
  React.useEffect(() => {
    const t = new BookmarkTree();
    const fWork = t.createFolder({ title: "Work" });
    const fPlay = t.createFolder({ title: "Play" });
    t.createBookmark({ parentId: fWork, title: "Docs", url: "https://example.com/docs" });
    t.createBookmark({ parentId: fWork, title: "Roadmap", url: "https://example.com/roadmap" });
    t.createBookmark({ parentId: fPlay, title: "Games", url: "https://example.com/games" });
    setTree(t);
  }, []);

  const handleAddFolder = (parentId: string) => {
    tree.createFolder({ parentId, title: `New Folder` });
    setTree(tree);
    force();
  };

  const handleAddBookmark = (parentId: string) => {
    const n = Math.floor(Math.random() * 1000);
    tree.createBookmark({ parentId, title: `Link ${n}`, url: `https://example.com/${n}` });
    setTree(tree);
    force();
  };

  const handleToggle = (folderId: string) => {
    tree.toggleFolder(folderId);
    setTree(tree);
    force();
  };

  const handleRemove = (id: string) => {
    if (window.confirm("Remove item?")) {
      tree.remove(id);
      setTree(tree);
      force();
    }
  };

  const handleMoveUp = (parentId: string, index: number) => {
    if (index <= 0) return;
    tree.reorder({ folderId: parentId, fromIndex: index, toIndex: index - 1 });
    setTree(tree);
    force();
  };

  const handleMoveDown = (parentId: string, index: number) => {
    const folder = tree.requireFolder(parentId);
    if (index >= folder.children.length - 1) return;
    tree.reorder({ folderId: parentId, fromIndex: index, toIndex: index + 1 });
    setTree(tree);
    force();
  };

  const renderNode = (node: TreeNode, idx: number, parentId: string) => {
    const index = idx;
    if (isFolder(node)) {
      const children = tree.listChildren(node.id);
      return (
        <div key={node.id} className="mb-2 rounded-lg border p-2">
          <div className="flex items-center gap-2">
            <button
              className="rounded px-2 py-1 text-left text-sm font-medium hover:bg-accent"
              onClick={() => handleToggle(node.id)}
              onKeyDown={(e) => e.key === "Enter" && handleToggle(node.id)}
              aria-label={node.isOpen ? "Close folder" : "Open folder"}
              tabIndex={0}
            >
              {node.isOpen ? "📂" : "📁"} {node.title}
            </button>
            <div className="ml-auto flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => handleAddBookmark(node.id)}>+ Bookmark</Button>
              <Button variant="outline" size="sm" onClick={() => handleAddFolder(node.id)}>+ Folder</Button>
              <Button variant="ghost" size="sm" onClick={() => handleMoveUp(parentId, index)}>↑</Button>
              <Button variant="ghost" size="sm" onClick={() => handleMoveDown(parentId, index)}>↓</Button>
              <Button variant="destructive" size="sm" onClick={() => handleRemove(node.id)}>Remove</Button>
            </div>
          </div>
          {node.isOpen && (
            <div className="ml-4 mt-2 flex flex-col gap-1">
              {children.map((child, i) => renderNode(child, i, node.id))}
            </div>
          )}
        </div>
      );
    }

  return (
      <div key={node.id} className="flex items-center gap-2 rounded border p-2">
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
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => handleMoveUp(parentId, index)}>↑</Button>
          <Button variant="ghost" size="sm" onClick={() => handleMoveDown(parentId, index)}>↓</Button>
          <Button variant="destructive" size="sm" onClick={() => handleRemove(node.id)}>Remove</Button>
        </div>
      </div>
    );
  };

  const root = tree.root;
  const rootChildren = tree.listChildren(root.id);

  return (
    <div className="flex w-full max-w-2xl flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <div className="text-xl font-semibold">Bookmarks Demo</div>
        <div className="ml-auto">
          <Button variant="secondary" onClick={() => handleAddFolder(root.id)}>+ Root Folder</Button>
          <Button className="ml-2" onClick={() => handleAddBookmark(root.id)}>+ Root Bookmark</Button>
        </div>
      </div>
      <div className="text-xs text-muted-foreground">Ordering uses fractional indexing keys; you can add, move (↑/↓), toggle folders, and remove.</div>
      <div className="mt-2">
        {rootChildren.length === 0 ? (
          <div className="rounded border p-4 text-sm text-muted-foreground">No items yet. Use the buttons above to add some.</div>
        ) : (
          rootChildren.map((child, i) => renderNode(child, i, root.id))
        )}
      </div>
    </div>
  );
};
