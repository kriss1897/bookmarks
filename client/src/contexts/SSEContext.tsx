import { createContext, useEffect, useState, useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import { TabCoordinator } from '../services/TabCoordinator';

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
  connectionStatus: 'disconnected' | 'connecting' | 'connected';
  connectionCount: number;
  isLoading: boolean;
  namespace: string;
  setNamespace: (namespace: string) => void;
  triggerCustomEvent: () => Promise<void>;
  sendNotification: (type: 'info' | 'success' | 'warning' | 'error') => Promise<void>;
  clearMessages: () => void;
  fetchConnectionCount: () => Promise<void>;
}

const SSEContext = createContext<SSEContextType | undefined>(undefined);

export { SSEContext };

interface SSEProviderProps {
  children: ReactNode;
}

export function SSEProvider({ children }: SSEProviderProps) {
  const [sseMessages, setSseMessages] = useState<SSEMessage[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [connectionCount, setConnectionCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [reconnectAttempt, setReconnectAttempt] = useState<number>(0);
  const [isCleanupReconnect, setIsCleanupReconnect] = useState<boolean>(false);
  const [namespace, setNamespace] = useState<string>('');
  const [isTabLeader, setIsTabLeader] = useState<boolean>(false);
  
  // Tab coordinator for managing tab leadership
  const tabCoordinatorRef = useRef<TabCoordinator | null>(null);

  // API functions for triggering events
  const fetchConnectionCount = useCallback(async () => {
    try {
      const url = namespace ? `/api/connections?namespace=${encodeURIComponent(namespace)}` : '/api/connections';
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        setConnectionCount(data.connections);
      }
    } catch (error) {
      console.error('Error fetching connection count:', error);
    }
  }, [namespace]);

  // Initialize tab coordinator when namespace changes
  useEffect(() => {
    if (!namespace.trim()) {
      // Cleanup if no namespace
      if (tabCoordinatorRef.current) {
        tabCoordinatorRef.current.cleanup();
        tabCoordinatorRef.current = null;
      }
      setIsTabLeader(false);
      return;
    }

    // Initialize tab coordinator
    if (!tabCoordinatorRef.current) {
      tabCoordinatorRef.current = new TabCoordinator();
    }

    const coordinator = tabCoordinatorRef.current;
    
    // Initialize namespace and check leadership
    const isLeader = coordinator.initializeNamespace(namespace);
    setIsTabLeader(isLeader);

    // Setup callbacks
    coordinator.onLeaderChange(namespace, (leader: boolean) => {
      console.log(`Tab leadership changed for namespace ${namespace}: ${leader ? 'leader' : 'follower'}`);
      setIsTabLeader(leader);
    });

    coordinator.onEvent(namespace, (event: unknown) => {
      console.log('Received SSE event from leader tab:', event);
      // Handle events received from leader tab
      if (event && typeof event === 'object' && 'type' in event) {
        setSseMessages(prev => [...prev.slice(-9), { ...event as SSEMessage, id: Date.now().toString() }]);
      }
    });

    // Cleanup on unmount or namespace change
    return () => {
      if (coordinator) {
        coordinator.cleanup(namespace);
      }
    };
  }, [namespace]);

  // SSE connection effect with reconnection logic - only for leader tabs
  useEffect(() => {
    // Only leader tabs should maintain SSE connections
    if (!isTabLeader || !namespace.trim()) {
      console.log(`Not creating SSE connection - isTabLeader: ${isTabLeader}, namespace: "${namespace}"`);
      setConnectionStatus('disconnected');
      return;
    }

    let currentEventSource: EventSource | null = null;
    let reconnectTimeout: NodeJS.Timeout | null = null;

    const createSSEConnection = () => {
      console.log(`Creating SSE connection for namespace: ${namespace} (leader tab)...`);
      setConnectionStatus('connecting');
      
      const es = new EventSource(`/api/events?namespace=${encodeURIComponent(namespace)}`);
      currentEventSource = es;
      
      es.onopen = () => {
        console.log('SSE connection opened (leader tab)');
        setConnectionStatus('connected');
        setReconnectAttempt(0); // Reset reconnect attempts on successful connection
        setIsCleanupReconnect(false); // Reset cleanup flag on successful connection
        fetchConnectionCount(); // Get initial connection count
      };
      
      // Handle different event types
      es.addEventListener('connection', (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('Connection event:', data);
          const message = { ...data, id: Date.now().toString() };
          setSseMessages(prev => [...prev.slice(-9), message]);
          
          // Broadcast to other tabs
          if (tabCoordinatorRef.current) {
            tabCoordinatorRef.current.broadcastEvent(namespace, message);
          }
          
          fetchConnectionCount();
          
          // Handle cleanup events - prepare for graceful reconnection
          if (data.type === 'cleanup' || data.type === 'forced_cleanup') {
            console.log('Server cleanup event received, preparing for reconnection...');
            setIsCleanupReconnect(true);
          }
        } catch (error) {
          console.error('Error parsing connection event:', error);
        }
      });

      es.addEventListener('trigger', (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('Trigger event:', data);
          const message = { ...data, id: Date.now().toString() };
          setSseMessages(prev => [...prev.slice(-9), message]);
          
          // Broadcast to other tabs
          if (tabCoordinatorRef.current) {
            tabCoordinatorRef.current.broadcastEvent(namespace, message);
          }
        } catch (error) {
          console.error('Error parsing trigger event:', error);
        }
      });

      es.addEventListener('notification', (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('Notification event:', data);
          const message = { ...data, id: Date.now().toString() };
          setSseMessages(prev => [...prev.slice(-9), message]);
          
          // Broadcast to other tabs
          if (tabCoordinatorRef.current) {
            tabCoordinatorRef.current.broadcastEvent(namespace, message);
          }
        } catch (error) {
          console.error('Error parsing notification event:', error);
        }
      });

      es.addEventListener('heartbeat', (event) => {
        try {
          JSON.parse(event.data); // Parse to validate JSON but don't store
          console.log('Heartbeat event received (leader tab)');
          // Don't add heartbeats to visible messages to reduce noise
        } catch (error) {
          console.error('Error parsing heartbeat event:', error);
        }
      });

      es.addEventListener('close', (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('Close event received:', data);
          if (data.type === 'connection_closing') {
            console.log('Server is closing connection gracefully');
            setIsCleanupReconnect(true);
          }
        } catch (error) {
          console.error('Error parsing close event:', error);
        }
      });
      
      es.onerror = (error) => {
        console.error('SSE connection error:', error);
        setConnectionStatus('disconnected');
        es.close();
        
        // Implement exponential backoff for reconnection
        const maxReconnectAttempts = 10;
        let baseDelay = 1000; // 1 second for normal errors
        
        // Use longer initial delay for cleanup-related disconnections
        if (isCleanupReconnect) {
          baseDelay = 3000; // 3 seconds for cleanup reconnections
          console.log('Cleanup-related disconnection detected, using longer initial delay');
        }
        
        if (reconnectAttempt < maxReconnectAttempts) {
          const delay = Math.min(baseDelay * Math.pow(2, reconnectAttempt), 30000); // Max 30 seconds
          console.log(`Attempting to reconnect in ${delay}ms (attempt ${reconnectAttempt + 1}/${maxReconnectAttempts})`);
          
          reconnectTimeout = setTimeout(() => {
            setReconnectAttempt(prev => prev + 1);
            createSSEConnection();
          }, delay);
        } else {
          console.error('Max reconnection attempts reached. Please refresh the page.');
          setSseMessages(prev => [...prev, {
            type: 'error',
            message: 'Connection lost. Please refresh the page.',
            timestamp: new Date().toISOString(),
            id: Date.now().toString()
          }]);
        }
      };
    };

    // Start initial connection
    createSSEConnection();
    
    // Cleanup on component unmount
    return () => {
      console.log('Cleaning up SSE connection (leader tab)');
      if (currentEventSource) {
        currentEventSource.close();
      }
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
      setConnectionStatus('disconnected');
    };
  }, [reconnectAttempt, isCleanupReconnect, namespace, fetchConnectionCount, isTabLeader]);

  // API functions for triggering events
  const triggerCustomEvent = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/trigger', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: 'Custom event triggered from client!',
          namespace: namespace || undefined, // Send namespace if set
          data: {
            triggeredAt: new Date().toISOString(),
            source: 'bookmarks-client',
            namespace: namespace
          }
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      console.log('Trigger response:', result);
    } catch (error) {
      console.error('Error triggering event:', error);
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
      
      const response = await fetch('/api/notify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: notification.title,
          body: notification.body,
          type,
          namespace: namespace || undefined // Send namespace if set
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      console.log('Notification response:', result);
    } catch (error) {
      console.error('Error sending notification:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const clearMessages = () => {
    setSseMessages([]);
  };

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
  };

  return (
    <SSEContext.Provider value={value}>
      {children}
    </SSEContext.Provider>
  );
}
