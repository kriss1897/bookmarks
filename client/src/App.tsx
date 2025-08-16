import { SharedWorkerOperationsTree } from "@/components/SharedWorkerOperationsTree";
import { ServerSyncStatus } from "@/components/ServerSyncStatus";

function App() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-start">
      <div className="w-full max-w-6xl space-y-8 p-4">
        <h1 className="text-2xl font-bold text-center mb-8">Multi-Tab Sync Demo</h1>

        {/* Server Sync Status */}
        <div className="space-y-2">
          <h2 className="text-lg font-semibold">Server Synchronization Status</h2>
          <p className="text-sm text-muted-foreground">Real-time status of local operations being synced to server</p>
          <ServerSyncStatus />
        </div>

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
