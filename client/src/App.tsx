import { BookmarksTree } from "@/components/BookmarksTree";
import { SharedWorkerTest } from "@/components/SharedWorkerTest";

function App() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-start">
      <div className="w-full max-w-6xl space-y-8 p-4">
        <SharedWorkerTest />
        <div className="border-t pt-8">
          <BookmarksTree />
        </div>
      </div>
    </div>
  )
}

export default App
