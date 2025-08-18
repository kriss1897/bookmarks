import BookmarkTreeView from "@/components/BookmarkTreeView";
import ThemeToggle from "@/components/ThemeToggle";
import HeaderSyncIndicator from "@/components/HeaderSyncIndicator";
import HeaderEventsIndicator from "@/components/HeaderEventsIndicator";

function App() {
  return (
    <div className="min-h-svh bg-background">
      {/* Top Nav */}
      <header className="sticky top-0 z-40 w-full border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <div className="size-6 rounded-md bg-primary/10 ring-1 ring-ring/20" aria-hidden />
            <span className="text-sm font-semibold tracking-tight">Bookmarks</span>
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
  )
}

export default App
