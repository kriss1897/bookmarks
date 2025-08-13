import type { ConnectionManager as IConnectionManager, WorkerEventType } from './worker-types';
import { RECONNECT_CONFIG, REACHABILITY_CONFIG } from './worker-config';

export class ConnectionManager {
  private connections = new Map<string, IConnectionManager>();
  private isOnline: boolean = navigator.onLine;
  private eventEmitter: (event: WorkerEventType, data: unknown) => void;

  constructor(eventEmitter: (event: WorkerEventType, data: unknown) => void) {
    this.eventEmitter = eventEmitter;
    this.startReachabilityCheck();
  }

  async connect(namespace: string): Promise<void> {
    if (!namespace?.trim()) {
      throw new Error('Namespace is required');
    }

    console.log(`Connect called for namespace: ${namespace}`);

    let connectionManager = this.connections.get(namespace);

    if (!connectionManager) {
      console.log(`Creating new connection manager for namespace: ${namespace}`);
      connectionManager = {
        namespace,
        eventSource: null,
        isConnecting: false,
        reconnectAttempt: 0,
        reconnectTimeout: null,
        lastSuccessfulConnection: null,
        connectionStartTime: null,
        isStable: false,
        nextRetryAt: null
      };
      this.connections.set(namespace, connectionManager);
    }

    const needsConnection = !connectionManager.eventSource || 
                           connectionManager.eventSource.readyState === EventSource.CLOSED;
    const notReconnecting = !connectionManager.reconnectTimeout && !connectionManager.isConnecting;
    
    if (needsConnection && notReconnecting) {
      console.log(`Creating SSE connection for namespace: ${namespace}`);
      await this.createSSEConnection(connectionManager);
    }
  }

  async disconnect(namespace: string): Promise<void> {
    const connectionManager = this.connections.get(namespace);
    if (connectionManager) {
      this.closeSSEConnection(connectionManager);
      this.connections.delete(namespace);
      console.log(`Disconnected from namespace: ${namespace}`);
    }
  }

  async cleanup(namespace?: string): Promise<void> {
    if (namespace) {
      await this.disconnect(namespace);
    } else {
      for (const [, manager] of this.connections) {
        this.closeSSEConnection(manager);
      }
      this.connections.clear();
    }
  }

  getConnectionState(namespace: string): IConnectionManager | undefined {
    return this.connections.get(namespace);
  }

  getAllNamespaces(): string[] {
    return Array.from(this.connections.keys());
  }

  get onlineStatus(): boolean {
    return this.isOnline;
  }

  private async createSSEConnection(connectionManager: IConnectionManager): Promise<void> {
    if (connectionManager.isConnecting) {
      return;
    }
    
    if (connectionManager.eventSource && connectionManager.eventSource.readyState === EventSource.OPEN) {
      return;
    }
    
    connectionManager.isConnecting = true;
    console.log(`Creating EventSource for namespace: ${connectionManager.namespace}`);
    
    try {
      const eventSource = new EventSource(`/api/events?namespace=${encodeURIComponent(connectionManager.namespace)}`);
      connectionManager.eventSource = eventSource;
      
      eventSource.onopen = () => {
        console.log(`SSE connection opened for namespace: ${connectionManager.namespace}`);
        connectionManager.isConnecting = false;
        connectionManager.lastSuccessfulConnection = Date.now();
        connectionManager.connectionStartTime = Date.now();
        connectionManager.isStable = false;
        
        this.scheduleStabilityCheck(connectionManager);
        this.eventEmitter('connected', { namespace: connectionManager.namespace });
      };
      
      // Handle different event types
      const eventTypes = [
        'connection', 'trigger', 'notification', 'heartbeat', 'close',
        'folder_created', 'bookmark_created', 'item_moved', 'folder_toggled',
        'bookmark_favorite_toggled', 'item_deleted'
      ];
      
      eventTypes.forEach(eventType => {
        eventSource.addEventListener(eventType, (event) => {
          this.handleSSEEvent(connectionManager.namespace, eventType, event);
        });
      });
      
      eventSource.onmessage = (event) => {
        this.handleSSEEvent(connectionManager.namespace, 'message', event);
      };
      
      eventSource.onerror = () => {
        console.error(`SSE connection error for namespace: ${connectionManager.namespace}`);
        
        if (connectionManager.isConnecting) {
          connectionManager.isConnecting = false;
        }
        
        if (connectionManager.reconnectTimeout) {
          return;
        }
        
        connectionManager.isStable = false;
        
        if (connectionManager.stabilityTimeout) {
          clearTimeout(connectionManager.stabilityTimeout);
          connectionManager.stabilityTimeout = null;
        }
        
        if (connectionManager.eventSource && 
            (connectionManager.lastSuccessfulConnection || connectionManager.eventSource.readyState !== EventSource.CONNECTING)) {
          this.eventEmitter('disconnected', { namespace: connectionManager.namespace });
        }
        
        this.scheduleReconnectWithBackoff(connectionManager);
      };
      
    } catch (error) {
      console.error('Error creating SSE connection:', error);
      connectionManager.isConnecting = false;
      this.scheduleReconnectWithBackoff(connectionManager);
    }
  }

  private handleSSEEvent(namespace: string, eventType: string, event: MessageEvent): void {
    try {
      const data = JSON.parse(event.data);
      console.log(`SSE ${eventType} event for namespace ${namespace}:`, data);
      
      const actualEventType = data.type || eventType;
      
      this.eventEmitter('event', {
        namespace,
        data: {
          ...data,
          type: actualEventType,
          eventType: actualEventType,
          id: data.id || Date.now().toString(),
          timestamp: data.timestamp || new Date().toISOString()
        }
      });
      
    } catch (error) {
      console.error(`Error parsing SSE ${eventType} event:`, error);
    }
  }

  private scheduleStabilityCheck(connectionManager: IConnectionManager): void {
    if (connectionManager.stabilityTimeout) {
      clearTimeout(connectionManager.stabilityTimeout);
    }
    
    connectionManager.stabilityTimeout = setTimeout(() => {
      if (connectionManager.eventSource && connectionManager.eventSource.readyState === EventSource.OPEN) {
        console.log(`Connection stable for namespace: ${connectionManager.namespace}, resetting reconnect attempts`);
        connectionManager.reconnectAttempt = 0;
        connectionManager.isStable = true;
        connectionManager.stabilityTimeout = null;
      }
    }, RECONNECT_CONFIG.stableThreshold);
  }

  private calculateReconnectDelay(attempt: number): number {
    const { baseDelay, maxDelay, backoffMultiplier, jitterFactor } = RECONNECT_CONFIG;
    
    const exponentialDelay = baseDelay * Math.pow(backoffMultiplier, attempt);
    const cappedDelay = Math.min(exponentialDelay, maxDelay);
    const jitter = cappedDelay * jitterFactor * (Math.random() * 2 - 1);
    const finalDelay = Math.max(cappedDelay + jitter, baseDelay);
    
    return Math.round(finalDelay);
  }

  private scheduleReconnectWithBackoff(connectionManager: IConnectionManager): void {
    if (connectionManager.reconnectTimeout) {
      return;
    }
    
    const delay = this.calculateReconnectDelay(connectionManager.reconnectAttempt);
    const nextRetryAt = new Date(Date.now() + delay);
    connectionManager.nextRetryAt = nextRetryAt.toISOString();
    
    console.log(`Scheduling reconnect for ${connectionManager.namespace} in ${delay}ms (attempt ${connectionManager.reconnectAttempt + 1})`);
    
    this.eventEmitter('reconnecting', {
      namespace: connectionManager.namespace,
      data: { 
        attempt: connectionManager.reconnectAttempt + 1,
        delayMs: delay,
        nextRetryAt: connectionManager.nextRetryAt
      }
    });
    
    connectionManager.reconnectTimeout = setTimeout(() => {
      connectionManager.reconnectAttempt++;
      connectionManager.reconnectTimeout = null;
      connectionManager.nextRetryAt = null;
      
      console.log(`Attempting reconnect for ${connectionManager.namespace} (attempt ${connectionManager.reconnectAttempt})`);
      this.createSSEConnection(connectionManager);
    }, delay);
  }

  private closeSSEConnection(connectionManager: IConnectionManager): void {
    if (connectionManager.eventSource) {
      connectionManager.eventSource.close();
      connectionManager.eventSource = null;
    }
    
    if (connectionManager.reconnectTimeout) {
      clearTimeout(connectionManager.reconnectTimeout);
      connectionManager.reconnectTimeout = null;
    }
    
    if (connectionManager.stabilityTimeout) {
      clearTimeout(connectionManager.stabilityTimeout);
      connectionManager.stabilityTimeout = null;
    }
    
    connectionManager.isConnecting = false;
    connectionManager.reconnectAttempt = 0;
    connectionManager.lastSuccessfulConnection = null;
    connectionManager.connectionStartTime = null;
    connectionManager.isStable = false;
    connectionManager.nextRetryAt = null;
  }

  private startReachabilityCheck(): void {
    this.isOnline = navigator.onLine;
    
    self.addEventListener('online', () => {
      console.log('Worker detected online');
      this.isOnline = true;
      this.onConnectivityChange();
    });
    
    self.addEventListener('offline', () => {
      console.log('Worker detected offline');
      this.isOnline = false;
      this.onConnectivityChange();
    });
    
    setInterval(() => {
      this.checkReachability();
    }, REACHABILITY_CONFIG.checkInterval);
  }

  private async checkReachability(): Promise<void> {
    try {
      const response = await fetch('/api/ping', { 
        method: 'HEAD',
        signal: AbortSignal.timeout(REACHABILITY_CONFIG.timeoutMs)
      });
      const isReachable = response.ok;
      
      if (this.isOnline !== isReachable) {
        this.isOnline = isReachable;
        this.onConnectivityChange();
      }
    } catch {
      if (this.isOnline) {
        this.isOnline = false;
        this.onConnectivityChange();
      }
    }
  }

  private onConnectivityChange(): void {
    this.eventEmitter('connectivityChanged', { isOnline: this.isOnline });
  }
}
