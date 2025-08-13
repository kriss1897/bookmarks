// SSE Shared Worker - manages SSE connections and broadcasts events to all tabs
// This worker maintains a single SSE connection per namespace and distributes events to all connected tabs

class SSESharedWorker {
  constructor() {
    this.connections = new Map();
    this.connectedPorts = new Map();
    this.portNamespaces = new Map();
    
    // Reconnection configuration
    this.reconnectConfig = {
      baseDelay: 1000,        // 1 second base delay
      maxDelay: 60000,        // 60 seconds maximum delay
      maxAttempts: Infinity,  // Infinite attempts (will back off indefinitely)
      jitterFactor: 0.3,      // 30% jitter to prevent thundering herd
      stableThreshold: 30000, // 30 seconds of stable connection before resetting attempts
      backoffMultiplier: 2    // Exponential backoff multiplier
    };
    
    console.log('SSE Shared Worker initialized');
    
    // Handle new connections from tabs
    self.addEventListener('connect', (event) => {
      const port = event.ports[0];
      const portId = this.generatePortId();
      
      console.log(`New tab connected with port ID: ${portId}, total ports: ${this.connectedPorts.size + 1}`);
      
      this.connectedPorts.set(portId, port);
      
      port.onmessage = (messageEvent) => {
        console.log(`Message received from port ${portId}:`, messageEvent.data);
        this.handleMessage(portId, messageEvent.data);
      };
      
      port.onmessageerror = (error) => {
        console.error('Port message error:', error);
      };
      
      port.start();
    });
  }
  
  generatePortId() {
    return `port-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
  
  getConnectionStatus(connectionManager) {
    if (connectionManager.isConnecting) {
      return 'connecting';
    }
    if (connectionManager.reconnectTimeout) {
      return 'reconnecting';
    }
    if (connectionManager.eventSource && connectionManager.eventSource.readyState === EventSource.OPEN) {
      return 'connected';
    }
    return 'disconnected';
  }
  
  getTimeUntilNextReconnect(connectionManager) {
    if (!connectionManager.nextRetryAt) {
      return 0;
    }
    const now = Date.now();
    const retryTime = new Date(connectionManager.nextRetryAt).getTime();
    return Math.max(0, retryTime - now);
  }
  
  handleMessage(portId, message) {
    const port = this.connectedPorts.get(portId);
    if (!port) {
      console.error(`Port ${portId} not found`);
      return;
    }
    
    switch (message.type) {
      case 'connect':
        this.handleConnect(portId, message.namespace, port);
        break;
      case 'disconnect':
        this.handleDisconnect(portId, message.namespace);
        break;
      case 'trigger':
        this.handleTrigger(message.data);
        break;
      case 'notify':
        this.handleNotify(message.data);
        break;
      case 'cleanup':
        this.handleCleanup(message.namespace);
        break;
      default:
        console.warn(`Unknown message type: ${message.type}`);
    }
  }
  
  async handleConnect(portId, namespace, port) {
    if (!namespace?.trim()) {
      this.sendToPort(port, {
        type: 'error',
        data: { message: 'Namespace is required' }
      });
      return;
    }

    console.log(`HandleConnect called for portId: ${portId}, namespace: ${namespace}`);

    // Associate this port with the namespace
    this.portNamespaces.set(portId, namespace);

    // Get or create SSE connection for this namespace
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
    } else {
      console.log(`Connection manager exists for namespace: ${namespace}, status: ${this.getConnectionStatus(connectionManager)}`);
    }

    // Only create SSE connection if we don't have one or it's completely dead
    const needsConnection = !connectionManager.eventSource || 
                           connectionManager.eventSource.readyState === EventSource.CLOSED;
    const notReconnecting = !connectionManager.reconnectTimeout && !connectionManager.isConnecting;
    
    if (needsConnection && notReconnecting) {
      console.log(`Creating SSE connection for namespace: ${namespace}`);
      await this.createSSEConnection(connectionManager);
    } else {
      console.log(`Skipping SSE connection creation for namespace: ${namespace} - needsConnection: ${needsConnection}, notReconnecting: ${notReconnecting}`);
    }

    // Notify port about current connection status
    const currentStatus = this.getConnectionStatus(connectionManager);
    console.log(`Sending status ${currentStatus} to port ${portId} for namespace ${namespace}`);
    
    this.sendToPort(port, {
      type: currentStatus,
      namespace,
      portId,
      ...(currentStatus === 'reconnecting' && connectionManager.nextRetryAt ? {
        data: {
          attempt: connectionManager.reconnectAttempt + 1,
          delayMs: this.getTimeUntilNextReconnect(connectionManager),
          nextRetryAt: connectionManager.nextRetryAt
        }
      } : {})
    });

    // Send current connection count only if connected
    if (currentStatus === 'connected') {
      this.updateConnectionCount(namespace);
    }
  }
  
  handleDisconnect(portId, namespace) {
    // Remove port association
    this.portNamespaces.delete(portId);
    
    // Check if any other ports are using this namespace
    const stillInUse = Array.from(this.portNamespaces.values()).includes(namespace);
    
    if (!stillInUse) {
      // No more tabs using this namespace, close the SSE connection
      const connectionManager = this.connections.get(namespace);
      if (connectionManager) {
        this.closeSSEConnection(connectionManager);
        this.connections.delete(namespace);
        console.log(`Closed SSE connection for namespace: ${namespace}`);
      }
    }
  }
  
  async handleTrigger(data) {
    try {
      const response = await fetch('/api/trigger', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data)
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      console.log('Trigger event sent successfully');
    } catch (error) {
      console.error('Error sending trigger event:', error);
      this.broadcastToNamespace(data.namespace, {
        type: 'error',
        data: { message: 'Failed to trigger event' }
      });
    }
  }
  
  async handleNotify(data) {
    try {
      const response = await fetch('/api/notify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data)
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      console.log('Notification sent successfully');
    } catch (error) {
      console.error('Error sending notification:', error);
      this.broadcastToNamespace(data.namespace, {
        type: 'error',
        data: { message: 'Failed to send notification' }
      });
    }
  }
  
  async handleCleanup(namespace) {
    if (namespace) {
      // Cleanup specific namespace
      const connectionManager = this.connections.get(namespace);
      if (connectionManager) {
        this.closeSSEConnection(connectionManager);
        this.connections.delete(namespace);
      }
    } else {
      // Cleanup all connections
      for (const [ns, manager] of this.connections) {
        this.closeSSEConnection(manager);
      }
      this.connections.clear();
    }
  }
  
  async createSSEConnection(connectionManager) {
    console.log(`createSSEConnection called for namespace: ${connectionManager.namespace}`);
    
    if (connectionManager.isConnecting) {
      console.log(`Already connecting to namespace: ${connectionManager.namespace}`);
      return; // Already connecting
    }
    
    if (connectionManager.reconnectTimeout) {
      console.log(`Reconnection already scheduled for namespace: ${connectionManager.namespace}`);
      return; // Reconnection already scheduled
    }
    
    // Check if we already have a live connection
    if (connectionManager.eventSource && connectionManager.eventSource.readyState === EventSource.OPEN) {
      console.log(`Already have an open connection for namespace: ${connectionManager.namespace}`);
      return;
    }
    
    connectionManager.isConnecting = true;
    console.log(`Setting isConnecting=true for namespace: ${connectionManager.namespace}`);
    
    try {
      console.log(`Actually creating new EventSource for namespace: ${connectionManager.namespace}`);
      
      const eventSource = new EventSource(`/api/events?namespace=${encodeURIComponent(connectionManager.namespace)}`);
      connectionManager.eventSource = eventSource;
      
      eventSource.onopen = () => {
        console.log(`SSE connection opened for namespace: ${connectionManager.namespace}`);
        connectionManager.isConnecting = false;
        connectionManager.lastSuccessfulConnection = Date.now();
        connectionManager.connectionStartTime = Date.now();
        connectionManager.isStable = false;
        
        // Schedule stability check to reset reconnect attempts after stable connection
        this.scheduleStabilityCheck(connectionManager);
        
        this.broadcastToNamespace(connectionManager.namespace, {
          type: 'connected',
          namespace: connectionManager.namespace
        });
        
        this.updateConnectionCount(connectionManager.namespace);
      };
      
      // Handle different event types
      eventSource.addEventListener('connection', (event) => {
        this.handleSSEEvent(connectionManager.namespace, 'connection', event);
      });
      
      eventSource.addEventListener('trigger', (event) => {
        this.handleSSEEvent(connectionManager.namespace, 'trigger', event);
      });
      
      eventSource.addEventListener('notification', (event) => {
        this.handleSSEEvent(connectionManager.namespace, 'notification', event);
      });
      
      eventSource.addEventListener('heartbeat', (event) => {
        // Don't broadcast heartbeats to reduce noise
        console.log(`Heartbeat received for namespace: ${connectionManager.namespace}`);
      });
      
      eventSource.addEventListener('close', (event) => {
        this.handleSSEEvent(connectionManager.namespace, 'close', event);
      });
      
      // Handle bookmark-related events
      eventSource.addEventListener('folder_created', (event) => {
        this.handleSSEEvent(connectionManager.namespace, 'folder_created', event);
      });
      
      eventSource.addEventListener('bookmark_created', (event) => {
        this.handleSSEEvent(connectionManager.namespace, 'bookmark_created', event);
      });
      
      eventSource.addEventListener('item_moved', (event) => {
        this.handleSSEEvent(connectionManager.namespace, 'item_moved', event);
      });
      
      eventSource.addEventListener('folder_toggled', (event) => {
        this.handleSSEEvent(connectionManager.namespace, 'folder_toggled', event);
      });
      
      eventSource.addEventListener('bookmark_favorite_toggled', (event) => {
        this.handleSSEEvent(connectionManager.namespace, 'bookmark_favorite_toggled', event);
      });
      
      eventSource.addEventListener('item_deleted', (event) => {
        this.handleSSEEvent(connectionManager.namespace, 'item_deleted', event);
      });
      
      // Also listen for general message events to catch any other events
      eventSource.onmessage = (event) => {
        this.handleSSEEvent(connectionManager.namespace, 'message', event);
      };
      
      eventSource.onerror = () => {
        console.error(`SSE connection error for namespace: ${connectionManager.namespace}`);
        
        // Only handle the error if we're not already in a reconnecting state
        if (connectionManager.isConnecting) {
          connectionManager.isConnecting = false;
        }
        
        // Don't process multiple error events if we're already reconnecting
        if (connectionManager.reconnectTimeout) {
          console.log(`Already in reconnecting state for namespace: ${connectionManager.namespace}`);
          return;
        }
        
        connectionManager.isStable = false;
        
        // Clear stability check timeout if it exists
        if (connectionManager.stabilityTimeout) {
          clearTimeout(connectionManager.stabilityTimeout);
          connectionManager.stabilityTimeout = null;
        }
        
        // Only broadcast disconnected if we were previously connected
        if (connectionManager.eventSource && 
            (connectionManager.lastSuccessfulConnection || connectionManager.eventSource.readyState !== EventSource.CONNECTING)) {
          this.broadcastToNamespace(connectionManager.namespace, {
            type: 'disconnected',
            namespace: connectionManager.namespace
          });
        }
        
        // Implement enhanced exponential backoff for reconnection
        this.scheduleReconnectWithBackoff(connectionManager);
      };
      
    } catch (error) {
      console.error('Error creating SSE connection:', error);
      connectionManager.isConnecting = false;
      this.scheduleReconnect(connectionManager);
    }
  }
  
  handleSSEEvent(namespace, eventType, event) {
    try {
      const data = JSON.parse(event.data);
      console.log(`SSE ${eventType} event for namespace ${namespace}:`, data);
      
      // Use the actual event type from the data if it exists, otherwise use the eventType parameter
      const actualEventType = data.type || eventType;
      
      // Broadcast event to all tabs in this namespace
      this.broadcastToNamespace(namespace, {
        type: 'event',
        namespace,
        data: {
          ...data,
          type: actualEventType,
          eventType: actualEventType,
          id: data.id || Date.now().toString(),
          timestamp: data.timestamp || new Date().toISOString()
        }
      });
      
      // Update connection count for connection events
      if (eventType === 'connection') {
        this.updateConnectionCount(namespace);
      }
      
    } catch (error) {
      console.error(`Error parsing SSE ${eventType} event:`, error);
    }
  }
  
  scheduleStabilityCheck(connectionManager) {
    // Clear any existing stability timeout
    if (connectionManager.stabilityTimeout) {
      clearTimeout(connectionManager.stabilityTimeout);
    }
    
    // Set timeout to mark connection as stable and reset reconnect attempts
    connectionManager.stabilityTimeout = setTimeout(() => {
      if (connectionManager.eventSource && connectionManager.eventSource.readyState === EventSource.OPEN) {
        console.log(`Connection stable for namespace: ${connectionManager.namespace}, resetting reconnect attempts`);
        connectionManager.reconnectAttempt = 0;
        connectionManager.isStable = true;
        connectionManager.stabilityTimeout = null;
      }
    }, this.reconnectConfig.stableThreshold);
  }
  
  calculateReconnectDelay(attempt) {
    // Exponential backoff with jitter
    const { baseDelay, maxDelay, backoffMultiplier, jitterFactor } = this.reconnectConfig;
    
    // Calculate exponential backoff delay
    const exponentialDelay = baseDelay * Math.pow(backoffMultiplier, attempt);
    
    // Cap the delay at maxDelay
    const cappedDelay = Math.min(exponentialDelay, maxDelay);
    
    // Add jitter to prevent thundering herd (±jitterFactor% of the delay)
    const jitter = cappedDelay * jitterFactor * (Math.random() * 2 - 1);
    const finalDelay = Math.max(cappedDelay + jitter, baseDelay);
    
    return Math.round(finalDelay);
  }
  
  scheduleReconnectWithBackoff(connectionManager) {
    // Check if any tabs are still using this namespace
    const stillInUse = Array.from(this.portNamespaces.values()).includes(connectionManager.namespace);
    
    if (!stillInUse) {
      console.log(`No tabs using namespace ${connectionManager.namespace}, skipping reconnect`);
      return;
    }
    
    // Don't schedule if already scheduled
    if (connectionManager.reconnectTimeout) {
      console.log(`Reconnect already scheduled for namespace ${connectionManager.namespace}`);
      return;
    }
    
    const delay = this.calculateReconnectDelay(connectionManager.reconnectAttempt);
    const nextRetryAt = new Date(Date.now() + delay);
    connectionManager.nextRetryAt = nextRetryAt.toISOString();
    
    console.log(`Scheduling reconnect for ${connectionManager.namespace} in ${delay}ms (attempt ${connectionManager.reconnectAttempt + 1})`);
    
    // Broadcast reconnection status to tabs (don't send disconnected here since it's handled in error handler)
    this.broadcastToNamespace(connectionManager.namespace, {
      type: 'reconnecting',
      namespace: connectionManager.namespace,
      data: { 
        attempt: connectionManager.reconnectAttempt + 1,
        delayMs: delay,
        nextRetryAt: connectionManager.nextRetryAt
      }
    });
    
    connectionManager.reconnectTimeout = setTimeout(() => {
      connectionManager.reconnectAttempt++;
      
      // Clear the timeout and retry timestamp
      connectionManager.reconnectTimeout = null;
      connectionManager.nextRetryAt = null;
      
      // Only reconnect if tabs are still using this namespace
      const currentlyInUse = Array.from(this.portNamespaces.values()).includes(connectionManager.namespace);
      if (currentlyInUse) {
        console.log(`Attempting reconnect for ${connectionManager.namespace} (attempt ${connectionManager.reconnectAttempt})`);
        this.createSSEConnection(connectionManager);
      } else {
        console.log(`Namespace ${connectionManager.namespace} no longer in use, cancelling reconnect`);
      }
    }, delay);
  }
  
  scheduleReconnect(connectionManager) {
    // Deprecated: Use scheduleReconnectWithBackoff instead
    this.scheduleReconnectWithBackoff(connectionManager);
  }
  
  closeSSEConnection(connectionManager) {
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
  
  broadcastToNamespace(namespace, message) {
    // Find all ports associated with this namespace
    const namespacePorts = [];
    
    for (const [portId, portNamespace] of this.portNamespaces) {
      if (portNamespace === namespace) {
        const port = this.connectedPorts.get(portId);
        if (port) {
          namespacePorts.push(port);
        }
      }
    }
    
    // Broadcast to all ports in this namespace
    namespacePorts.forEach(port => {
      this.sendToPort(port, message);
    });
    
    console.log(`Broadcasted message to ${namespacePorts.length} tabs in namespace: ${namespace}`);
  }
  
  sendToPort(port, message) {
    try {
      port.postMessage(message);
    } catch (error) {
      console.error('Error sending message to port:', error);
    }
  }
  
  async updateConnectionCount(namespace) {
    try {
      const url = `/api/connections?namespace=${encodeURIComponent(namespace)}`;
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        this.broadcastToNamespace(namespace, {
          type: 'connection-count',
          namespace,
          data: { connections: data.connections }
        });
      }
    } catch (error) {
      console.error('Error fetching connection count:', error);
    }
  }
}

// Initialize the shared worker
new SSESharedWorker();
