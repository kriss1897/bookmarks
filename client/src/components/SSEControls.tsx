import { useSSE } from '../hooks/useSSE';
import { Button } from '@/components/ui/button';

export function SSEControls() {
  const {
    connectionStatus,
    connectionCount,
    isLoading,
    triggerCustomEvent,
    sendNotification,
    clearMessages,
  } = useSSE();

  return (
    <div className="mb-4 w-full max-w-2xl rounded-lg border bg-white p-4 shadow-sm dark:bg-neutral-900">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Realtime Server Events</h2>
        <div className="flex items-center gap-3">
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
              connectionStatus === 'connected'
                ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300'
                : connectionStatus === 'connecting'
                ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300'
                : 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300'
            }`}
          >
            <span className="size-1.5 rounded-full bg-current opacity-70" />
            {connectionStatus}
          </span>
          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">
            {connectionCount} connections
          </span>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <div>
          <h3 className="mb-2 text-sm font-medium text-neutral-600 dark:text-neutral-400">
            Trigger Events
          </h3>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={triggerCustomEvent}
              disabled={isLoading || connectionStatus !== 'connected'}
            >
              {isLoading ? 'Sending…' : 'Trigger Event'}
            </Button>
            <Button
              variant="outline"
              className="border-transparent bg-cyan-500 text-white hover:bg-cyan-600"
              onClick={() => sendNotification('info')}
              disabled={isLoading || connectionStatus !== 'connected'}
            >
              Info
            </Button>
            <Button
              variant="outline"
              className="border-transparent bg-green-600 text-white hover:bg-green-700"
              onClick={() => sendNotification('success')}
              disabled={isLoading || connectionStatus !== 'connected'}
            >
              Success
            </Button>
            <Button
              variant="outline"
              className="border-transparent bg-amber-500 text-white hover:bg-amber-600"
              onClick={() => sendNotification('warning')}
              disabled={isLoading || connectionStatus !== 'connected'}
            >
              Warning
            </Button>
            <Button
              variant="destructive"
              onClick={() => sendNotification('error')}
              disabled={isLoading || connectionStatus !== 'connected'}
            >
              Error
            </Button>
            <Button variant="outline" onClick={clearMessages}>
              Clear Messages
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
