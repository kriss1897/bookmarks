import { SharedWorkerOperationsTree } from "@/components/SharedWorkerOperationsTree";

function App() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-start">
      <div className="w-full max-w-6xl space-y-8 p-4">
        <h1 className="text-2xl font-bold text-center mb-8">Multi-Tab Sync Demo</h1>

        {/* Operations-based SharedWorker Version */}
        <div className="space-y-2">
          <h2 className="text-lg font-semibold">SharedWorker Operations Tree (Fixed Anti-Loop)</h2>
          <p className="text-sm text-muted-foreground">Uses operations log from SharedWorker, prevents feedback loops</p>
          <SharedWorkerOperationsTree />
        </div>
      </div>
    </div>
  )
}

export default App
