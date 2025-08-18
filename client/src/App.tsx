import BookmarkTreeView from "@/components/BookmarkTreeView";
import ThemeToggle from "@/components/ThemeToggle";
import HeaderSyncIndicator from "@/components/HeaderSyncIndicator";
import HeaderEventsIndicator from "@/components/HeaderEventsIndicator";

function App() {
  return (
    <div className="bg-background min-h-svh">
      {/* Top Nav */}
      <header className="bg-background/80 supports-[backdrop-filter]:bg-background/60 sticky top-0 z-40 w-full border-b backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <div
              className="bg-primary/10 ring-ring/20 size-6 rounded-md ring-1"
              aria-hidden
            />
            <span className="text-sm font-semibold tracking-tight">
              Bookmarks
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <HeaderEventsIndicator />
            <HeaderSyncIndicator />
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Page body */}
      <main className="mx-auto w-full px-4 py-6">
        <BookmarkTreeView />
      </main>
    </div>
  );
}

export default App;
