import { useSSE } from '../hooks/useSSE';

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
    <div className="mb-4 p-4 rounded-lg border max-w-2xl w-full">
      <h2 className="text-lg font-semibold mb-3">Real-time Server Events Demo</h2>
      
      {/* Connection Status */}
      <div className="flex items-center gap-4 mb-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Status:</span>
          <span 
            className={`px-2 py-1 rounded text-xs font-medium ${
              connectionStatus === 'connected' 
                ? 'bg-green-100 text-green-800' 
                : connectionStatus === 'connecting'
                ? 'bg-yellow-100 text-yellow-800'
                : 'bg-red-100 text-red-800'
            }`}
          >
            {connectionStatus}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Connections:</span>
          <span className="px-2 py-1 rounded text-xs font-medium bg-blue-100 text-blue-800">
            {connectionCount}
          </span>
        </div>
      </div>

      {/* Event Trigger Controls */}
      <div className="mb-4">
        <h3 className="text-sm font-semibold mb-2">Trigger Events:</h3>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={triggerCustomEvent}
            disabled={isLoading || connectionStatus !== 'connected'}
            className="px-3 py-1 bg-blue-500 text-white rounded text-sm hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            {isLoading ? 'Sending...' : 'Trigger Event'}
          </button>
          <button
            onClick={() => sendNotification('info')}
            disabled={isLoading || connectionStatus !== 'connected'}
            className="px-3 py-1 bg-cyan-500 text-white rounded text-sm hover:bg-cyan-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            Info Notification
          </button>
          <button
            onClick={() => sendNotification('success')}
            disabled={isLoading || connectionStatus !== 'connected'}
            className="px-3 py-1 bg-green-500 text-white rounded text-sm hover:bg-green-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            Success Notification
          </button>
          <button
            onClick={() => sendNotification('warning')}
            disabled={isLoading || connectionStatus !== 'connected'}
            className="px-3 py-1 bg-yellow-500 text-white rounded text-sm hover:bg-yellow-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            Warning Notification
          </button>
          <button
            onClick={() => sendNotification('error')}
            disabled={isLoading || connectionStatus !== 'connected'}
            className="px-3 py-1 bg-red-500 text-white rounded text-sm hover:bg-red-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            Error Notification
          </button>
          <button
            onClick={clearMessages}
            className="px-3 py-1 bg-gray-500 text-white rounded text-sm hover:bg-gray-600"
          >
            Clear Messages
          </button>
        </div>
      </div>
    </div>
  );
}
