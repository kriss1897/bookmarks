import React from 'react';
import { useSSE } from '../hooks/useSSE';
import { offlineWorkerService } from '../services/offlineWorkerService';

interface OfflineIndicatorProps {
  namespace: string;
  className?: string;
}

export function OfflineIndicator({ namespace, className = '' }: OfflineIndicatorProps) {
  const { connectionStatus } = useSSE();
  const [pendingOpsCount, setPendingOpsCount] = React.useState(0);
  const [isSyncing, setIsSyncing] = React.useState(false);

  const isConnected = connectionStatus === 'connected';

  // Listen for pending operations count updates
  React.useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      
      if (message.type === 'PENDING_OPERATIONS_COUNT') {
        if (message.namespace === namespace) {
          setPendingOpsCount(message.count);
        }
      } else if (message.type === 'SYNC_STATUS') {
        if (message.namespace === namespace) {
          setIsSyncing(message.syncing);
        }
      }
    };

    offlineWorkerService.addEventListener('message', handleMessage);
    
    // Get initial count
    offlineWorkerService.getPendingOperationsCount(namespace);

    return () => {
      offlineWorkerService.removeEventListener('message', handleMessage);
    };
  }, [namespace]);

  // Determine status
  const getStatus = () => {
    if (isSyncing) {
      return {
        text: 'Syncing...',
        color: 'text-blue-600',
        bg: 'bg-blue-100',
        icon: '🔄'
      };
    }
    
    if (!isConnected && pendingOpsCount > 0) {
      return {
        text: `Offline (${pendingOpsCount} pending)`,
        color: 'text-orange-600',
        bg: 'bg-orange-100',
        icon: '📡'
      };
    }
    
    if (!isConnected) {
      return {
        text: 'Offline',
        color: 'text-red-600',
        bg: 'bg-red-100',
        icon: '❌'
      };
    }
    
    if (pendingOpsCount > 0) {
      return {
        text: `${pendingOpsCount} pending`,
        color: 'text-amber-600',
        bg: 'bg-amber-100',
        icon: '⏳'
      };
    }
    
    return {
      text: 'Online',
      color: 'text-green-600',
      bg: 'bg-green-100',
      icon: '✅'
    };
  };

  const status = getStatus();
  const shouldShow = !isConnected || pendingOpsCount > 0 || isSyncing;

  // Don't show indicator when everything is normal (online with no pending ops)
  if (!shouldShow) {
    return null;
  }

  const handleRetry = async () => {
    try {
      await offlineWorkerService.syncNow(namespace);
    } catch (error) {
      console.error('Manual sync failed:', error);
    }
  };

  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium ${status.bg} ${status.color} ${className}`}>
      <span className="text-lg" role="img" aria-label="Status">
        {status.icon}
      </span>
      <span>{status.text}</span>
      {(!isConnected || pendingOpsCount > 0) && !isSyncing && (
        <button
          onClick={handleRetry}
          className="ml-1 text-xs underline hover:no-underline focus:no-underline"
          title="Retry sync"
        >
          Retry
        </button>
      )}
    </div>
  );
}

export default OfflineIndicator;
