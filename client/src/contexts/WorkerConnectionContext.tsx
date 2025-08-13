import { createContext, useState, useEffect, useRef, useCallback } from 'react';
import type { ReactNode } from 'react';
import { offlineWorkerService } from '../services/offlineWorkerService';
import type { WorkerEventType } from '../workers/sse-shared-worker';

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

interface ReconnectInfo {
  attempt: number;
  delayMs: number;
  nextRetryAt: string;
}

interface WorkerConnectionContextType {
  connectionStatus: ConnectionStatus;
  isConnected: boolean;
  reconnectInfo?: ReconnectInfo;
  countdownSeconds: number;
  connect: (namespace: string) => Promise<void>;
  disconnect: (namespace: string) => Promise<void>;
  addEventListener: (eventType: WorkerEventType, handler: (data: unknown) => void) => Promise<void>;
}

const WorkerConnectionContext = createContext<WorkerConnectionContextType | undefined>(undefined);

export { WorkerConnectionContext };

interface WorkerConnectionProviderProps {
  children: ReactNode;
}

export function WorkerConnectionProvider({ children }: WorkerConnectionProviderProps) {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [reconnectInfo, setReconnectInfo] = useState<ReconnectInfo | undefined>(undefined);
  const [countdownSeconds, setCountdownSeconds] = useState<number>(0);
  
  const connectedNamespaceRef = useRef<string | null>(null);
  const eventHandlersSetupRef = useRef<boolean>(false);

  // Setup worker event handlers once
  useEffect(() => {
    if (eventHandlersSetupRef.current) return;
    
    const setupEventHandlers = async () => {
      try {
        await offlineWorkerService.addEventListener('connected', () => {
          setConnectionStatus('connected');
        });
        
        await offlineWorkerService.addEventListener('disconnected', () => {
          setConnectionStatus('disconnected');
        });
        
        await offlineWorkerService.addEventListener('reconnecting', (data) => {
          setConnectionStatus('reconnecting');
          const reconnectData = data as ReconnectInfo;
          if (reconnectData) {
            setReconnectInfo(reconnectData);
            setCountdownSeconds(Math.ceil(reconnectData.delayMs / 1000));
          }
        });
        
        eventHandlersSetupRef.current = true;
      } catch (error) {
        console.error('Failed to set up worker event handlers:', error);
        setConnectionStatus('disconnected');
      }
    };
    
    setupEventHandlers();
  }, []);

  // Countdown timer for reconnection
  useEffect(() => {
    let interval: NodeJS.Timeout;
    
    if (connectionStatus === 'reconnecting' && countdownSeconds > 0) {
      interval = setInterval(() => {
        setCountdownSeconds(prev => {
          if (prev <= 1) {
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    
    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [connectionStatus, countdownSeconds]);

  const connect = useCallback(async (namespace: string) => {
    const currentNamespace = connectedNamespaceRef.current;
    
    // Disconnect from previous namespace if different
    if (currentNamespace && currentNamespace !== namespace && namespace.trim()) {
      try {
        await offlineWorkerService.disconnect(currentNamespace);
      } catch (error) {
        console.error('Error disconnecting from previous namespace:', error);
      }
    }
    
    // Connect to new namespace
    if (namespace && namespace.trim() && namespace !== currentNamespace) {
      setConnectionStatus('connecting');
      
      try {
        await offlineWorkerService.connect(namespace);
        connectedNamespaceRef.current = namespace;
      } catch (error) {
        console.error('Error connecting to namespace:', error);
        setConnectionStatus('disconnected');
        throw error;
      }
    }
  }, []);

  const disconnect = useCallback(async (namespace: string) => {
    try {
      await offlineWorkerService.disconnect(namespace);
      if (connectedNamespaceRef.current === namespace) {
        connectedNamespaceRef.current = null;
      }
    } catch (error) {
      console.error('Error disconnecting from namespace:', error);
      throw error;
    }
  }, []);

  const addEventListener = useCallback(async (eventType: WorkerEventType, handler: (data: unknown) => void) => {
    return offlineWorkerService.addEventListener(eventType, handler);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (connectedNamespaceRef.current) {
        offlineWorkerService.disconnect(connectedNamespaceRef.current).catch(console.error);
        connectedNamespaceRef.current = null;
      }
    };
  }, []);

  const value: WorkerConnectionContextType = {
    connectionStatus,
    isConnected: connectionStatus === 'connected',
    reconnectInfo,
    countdownSeconds,
    connect,
    disconnect,
    addEventListener,
  };

  return (
    <WorkerConnectionContext.Provider value={value}>
      {children}
    </WorkerConnectionContext.Provider>
  );
}
