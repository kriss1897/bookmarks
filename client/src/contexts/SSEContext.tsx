import { createContext, useEffect, useState, useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import { usePersistedState } from '../hooks/usePersistedState';

interface SSEMessage {
  type: string;
  message: string;
  timestamp: string;
  data?: Record<string, unknown> | string | number | null;
  id?: string;
  namespace?: string;
}

interface SSEContextType {
  sseMessages: SSEMessage[];
  connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
  connectionCount: number;
  isLoading: boolean;
  namespace: string;
  setNamespace: (namespace: string) => void;
  triggerCustomEvent: () => Promise<void>;
  sendNotification: (type: 'info' | 'success' | 'warning' | 'error') => Promise<void>;
  clearMessages: () => void;
  fetchConnectionCount: () => Promise<void>;
  reconnectInfo?: {
    attempt: number;
    delayMs: number;
    nextRetryAt: string;
  };
  countdownSeconds: number;
}

const SSEContext = createContext<SSEContextType | undefined>(undefined);

export { SSEContext };

interface SSEProviderProps {
  children: ReactNode;
}

export function SSEProvider({ children }: SSEProviderProps) {
  // Use persisted state for namespace (localStorage - shared across tabs)
  const [namespace, setNamespace] = usePersistedState('sse-namespace', '');
  
  // Use regular state for messages - will implement custom persistence logic
  const [sseMessages, setSseMessages] = useState<SSEMessage[]>([]);
  
  // Regular state for transient data
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'reconnecting'>('disconnected');
  const [connectionCount, setConnectionCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [reconnectInfo, setReconnectInfo] = useState<{
    attempt: number;
    delayMs: number;
    nextRetryAt: string;
  } | undefined>(undefined);
  const [countdownSeconds, setCountdownSeconds] = useState<number>(0);

  // Load persisted messages on mount
  useEffect(() => {
    const loadPersistedMessages = () => {
      try {
        const stored = sessionStorage.getItem('sse-messages');
        if (stored) {
          const parsed = JSON.parse(stored) as SSEMessage[];
          // Filter messages by TTL (2 hours)
          const now = Date.now();
          const validMessages = parsed.filter((msg) => {
            const msgTime = new Date(msg.timestamp).getTime();
            return now - msgTime < 2 * 60 * 60 * 1000; // 2 hours
          });
          setSseMessages(validMessages);
        }
      } catch (error) {
        console.warn('Error loading persisted messages:', error);
      }
    };
    
    loadPersistedMessages();
  }, []);

  // Persist messages when they change
  useEffect(() => {
    try {
      // Only persist last 20 messages
      const messagesToPersist = sseMessages.slice(-20);
      sessionStorage.setItem('sse-messages', JSON.stringify(messagesToPersist));
    } catch (error) {
      console.warn('Error persisting messages:', error);
    }
  }, [sseMessages]);
  
  // Shared Worker management
  const sharedWorkerRef = useRef<SharedWorker | null>(null);
  const portRef = useRef<MessagePort | null>(null);
  const connectedNamespaceRef = useRef<string | null>(null);
  const connectionStatusRef = useRef<'disconnected' | 'connecting' | 'connected' | 'reconnecting'>('disconnected');

  // API functions for triggering events
  const fetchConnectionCount = useCallback(async () => {
    // Connection count is now handled by the shared worker
    // We'll receive updates via worker messages
  }, []);

  // Handle messages from shared worker
  const handleWorkerMessage = useCallback((message: { type: string; namespace?: string; data?: unknown }) => {
    console.log('Received worker message:', message);
    
    switch (message.type) {
      case 'connected':
        setConnectionStatus('connected');
        connectionStatusRef.current = 'connected';
        setReconnectInfo(undefined);
        setCountdownSeconds(0);
        console.log(`Connected to namespace: ${message.namespace}`);
        break;
        
      case 'disconnected':
        // Only change to disconnected if we're not already reconnecting
        if (connectionStatusRef.current !== 'reconnecting') {
          setConnectionStatus('disconnected');
          connectionStatusRef.current = 'disconnected';
          setReconnectInfo(undefined);
          setCountdownSeconds(0);
        }
        console.log(`Disconnected from namespace: ${message.namespace}`);
        break;
        
      case 'reconnecting': {
        setConnectionStatus('reconnecting');
        connectionStatusRef.current = 'reconnecting';
        const data = message.data as { attempt: number; delayMs: number; nextRetryAt: string };
        setReconnectInfo(data);
        // Initialize countdown
        setCountdownSeconds(Math.ceil(data.delayMs / 1000));
        console.log(`Reconnecting to namespace: ${message.namespace} (attempt ${data.attempt})`);
        break;
      }
        
      case 'error':
        console.error('Worker error:', message.data);
        setSseMessages(prev => [...prev.slice(-9), {
          type: 'error',
          message: (message.data as { message?: string })?.message || 'Unknown error',
          timestamp: new Date().toISOString(),
          id: Date.now().toString()
        }]);
        break;
        
      case 'event': {
        // Handle SSE events broadcasted from shared worker
        const eventData = message.data as SSEMessage;
        setSseMessages(prev => [...prev.slice(-9), {
          ...eventData,
          id: eventData.id || Date.now().toString()
        }]);
        break;
      }
        
      case 'connection-count':
        setConnectionCount((message.data as { connections: number }).connections);
        break;
        
      default:
        console.warn('Unknown worker message type:', message.type);
    }
  }, [setSseMessages]); // Stable dependency

  // Create a stable reference to handleWorkerMessage
  const handleWorkerMessageRef = useRef(handleWorkerMessage);
  handleWorkerMessageRef.current = handleWorkerMessage;

  // Countdown timer for reconnection
  useEffect(() => {
    let interval: NodeJS.Timeout;
    
    if (connectionStatus === 'reconnecting' && countdownSeconds > 0) {
      interval = setInterval(() => {
        setCountdownSeconds(prev => {
          if (prev <= 1) {
            // When countdown reaches 0, we should be attempting to reconnect
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

  // Initialize shared worker once
  useEffect(() => {
    if (!sharedWorkerRef.current) {
      try {
        console.log('SSEContext: Initializing Shared Worker...');
        const worker = new SharedWorker('/sse-shared-worker.js');
        sharedWorkerRef.current = worker;
        
        const port = worker.port;
        portRef.current = port;
        
        // Set up message handling
        port.onmessage = (event) => {
          handleWorkerMessageRef.current(event.data);
        };
        
        port.onmessageerror = (error) => {
          console.error('Worker message error:', error);
          setConnectionStatus('disconnected');
        };
        
        port.start();
        console.log('SSEContext: Shared Worker initialized');
        
      } catch (error) {
        console.error('Failed to initialize Shared Worker:', error);
        setConnectionStatus('disconnected');
      }
    }
  }, []); // No dependencies - runs once

  // Handle namespace connection with debouncing
  useEffect(() => {
    if (!portRef.current) {
      console.log('SSEContext: Port not ready, skipping namespace connection');
      return;
    }

    // Debounce namespace changes to prevent rapid connect/disconnect
    const timeoutId = setTimeout(() => {
      const currentNamespace = connectedNamespaceRef.current;
      
      // Disconnect from previous namespace if different
      if (currentNamespace && currentNamespace !== namespace && namespace.trim()) {
        console.log(`SSEContext: Disconnecting from previous namespace: ${currentNamespace}`);
        portRef.current!.postMessage({
          type: 'disconnect',
          namespace: currentNamespace
        });
      }

      if (!namespace.trim()) {
        // Cleanup if no namespace
        if (currentNamespace) {
          console.log(`SSEContext: Disconnecting from namespace: ${currentNamespace}`);
          portRef.current!.postMessage({
            type: 'disconnect',
            namespace: currentNamespace
          });
          connectedNamespaceRef.current = null;
        }
        setConnectionStatus('disconnected');
        connectionStatusRef.current = 'disconnected';
        return;
      }

      // Connect to new namespace if different from current
      if (currentNamespace !== namespace) {
        console.log(`SSEContext: Connecting to namespace: ${namespace}`);
        setConnectionStatus('connecting');
        connectionStatusRef.current = 'connecting';
        
        portRef.current!.postMessage({
          type: 'connect',
          namespace: namespace
        });
        
        connectedNamespaceRef.current = namespace;
      }
    }, 100); // 100ms debounce

    // Cleanup function
    return () => {
      clearTimeout(timeoutId);
    };
  }, [namespace]); // Only depend on namespace

  // Initialize shared worker and handle namespace changes
  useEffect(() => {
    return () => {
      // Final cleanup on unmount
      if (portRef.current && connectedNamespaceRef.current) {
        console.log(`SSEContext: Final cleanup for namespace: ${connectedNamespaceRef.current}`);
        portRef.current.postMessage({
          type: 'disconnect',
          namespace: connectedNamespaceRef.current
        });
        connectedNamespaceRef.current = null;
      }
    };
  }, []); // Only run on mount/unmount

  // API functions for triggering events via shared worker
  const triggerCustomEvent = async () => {
    setIsLoading(true);
    try {
      if (portRef.current) {
        portRef.current.postMessage({
          type: 'trigger',
          data: {
            message: 'Custom event triggered from client!',
            namespace: namespace || undefined,
            data: {
              triggeredAt: new Date().toISOString(),
              source: 'bookmarks-client',
              namespace: namespace
            }
          }
        });
      } else {
        throw new Error('Shared worker not available');
      }
    } catch (error) {
      console.error('Error triggering event:', error);
      setSseMessages(prev => [...prev.slice(-9), {
        type: 'error',
        message: 'Failed to trigger event',
        timestamp: new Date().toISOString(),
        id: Date.now().toString()
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const sendNotification = async (type: 'info' | 'success' | 'warning' | 'error') => {
    setIsLoading(true);
    try {
      const notifications = {
        info: { title: 'Information', body: 'This is an informational notification' },
        success: { title: 'Success!', body: 'Operation completed successfully' },
        warning: { title: 'Warning', body: 'Please check your input' },
        error: { title: 'Error', body: 'Something went wrong' }
      };

      const notification = notifications[type];
      
      if (portRef.current) {
        portRef.current.postMessage({
          type: 'notify',
          data: {
            title: notification.title,
            body: notification.body,
            type,
            namespace: namespace || undefined
          }
        });
      } else {
        throw new Error('Shared worker not available');
      }
    } catch (error) {
      console.error('Error sending notification:', error);
      setSseMessages(prev => [...prev.slice(-9), {
        type: 'error',
        message: 'Failed to send notification',
        timestamp: new Date().toISOString(),
        id: Date.now().toString()
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const clearMessages = () => {
    setSseMessages([]);
  };

  // Cleanup shared worker on unmount
  useEffect(() => {
    return () => {
      if (portRef.current && namespace) {
        console.log(`SSEContext: Final cleanup for namespace: ${namespace}`);
        portRef.current.postMessage({
          type: 'disconnect',
          namespace: namespace
        });
      }
    };
  }, [namespace]);

  const value: SSEContextType = {
    sseMessages,
    connectionStatus,
    connectionCount,
    isLoading,
    namespace,
    setNamespace,
    triggerCustomEvent,
    sendNotification,
    clearMessages,
    fetchConnectionCount,
    reconnectInfo,
    countdownSeconds,
  };

  return (
    <SSEContext.Provider value={value}>
      {children}
    </SSEContext.Provider>
  );
}
