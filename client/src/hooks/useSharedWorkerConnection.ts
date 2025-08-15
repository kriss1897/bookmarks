/**
 * Hook for managing SharedWorker connection
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import * as Comlink from 'comlink';
import { SharedWorkerConnection, type ConnectionStatus } from '../workers/SharedWorkerConnection';
import type { SharedWorkerAPI } from '../workers/sharedWorkerAPI';

interface UseSharedWorkerConnectionReturn {
  workerProxy: Comlink.Remote<SharedWorkerAPI> | null;
  isConnected: boolean;
  error: string | null;
  reconnect: () => Promise<void>;
}

export function useSharedWorkerConnection(): UseSharedWorkerConnectionReturn {
  const connectionRef = useRef<SharedWorkerConnection | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>({
    state: 'disconnected'
  });

  const reconnect = useCallback(async () => {
    if (connectionRef.current) {
      await connectionRef.current.disconnect();
      await connectionRef.current.connect();
    }
  }, []);

  useEffect(() => {
    // Create connection instance
    const connection = new SharedWorkerConnection();
    connectionRef.current = connection;

    // Subscribe to status changes
    const unsubscribe = connection.onStateChange(setStatus);

    // Initiate connection
    connection.connect();

    return () => {
      unsubscribe();
      connection.disconnect();
    };
  }, []);

  return {
    workerProxy: status.api || null,
    isConnected: status.state === 'connected',
    error: status.error || null,
    reconnect
  };
}
