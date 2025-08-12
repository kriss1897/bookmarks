import { useSSE } from '../hooks/useSSE';

export function EventsList() {
  const { sseMessages, namespace } = useSSE();

  // Helper function to style messages based on type
  const getMessageStyle = (type: string) => {
    switch (type) {
      case 'connection':
        return 'border-blue-400 bg-blue-50';
      case 'trigger':
        return 'border-purple-400 bg-purple-50';
      case 'notification':
        return 'border-green-400 bg-green-50';
      case 'heartbeat':
        return 'border-gray-400 bg-gray-50';
      default:
        return 'border-gray-400 bg-gray-50';
    }
  };

  return (
    <div className="max-w-2xl w-full">
      <h3 className="text-sm font-semibold mb-2">
        Live Events for "{namespace}" ({sseMessages.length}):
      </h3>
      <div className="max-h-60 overflow-y-auto bg-gray-50 p-3 rounded border">
        {sseMessages.length > 0 ? (
          <div className="space-y-2">
            {sseMessages.map((msg, index) => (
              <div key={msg.id || index} className={`p-2 rounded text-xs border-l-4 ${getMessageStyle(msg.type)}`}>
                <div className="flex justify-between items-start mb-1">
                  <span className="font-semibold text-gray-800 uppercase tracking-wide">
                    {msg.type}
                    {msg.namespace && (
                      <span className="text-xs text-gray-500 ml-2">
                        @{msg.namespace}
                      </span>
                    )}
                  </span>
                  <span className="text-gray-500 text-xs">
                    {new Date(msg.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <div className="text-gray-700 mb-1">
                  {msg.message}
                </div>
                {msg.data && (
                  <div className="mt-1 p-2 bg-gray-100 rounded text-xs">
                    <div className="text-gray-600 font-mono">
                      {typeof msg.data === 'string' 
                        ? msg.data 
                        : JSON.stringify(msg.data, null, 2)
                      }
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-gray-500 text-center py-4">
            No events yet for namespace "{namespace}". Try triggering some events using the buttons above!
          </div>
        )}
      </div>
    </div>
  );
}
