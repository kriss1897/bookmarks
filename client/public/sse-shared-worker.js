// SSE Shared Worker - manages SSE connections and broadcasts events to all tabs
// This worker maintains a single SSE connection per namespace and distributes events to all connected tabs

class SSESharedWorker {
  constructor() {
    this.connections = new Map();
    this.connectedPorts = new Map();
    this.portNamespaces = new Map();
    
    console.log('SSE Shared Worker initialized');
    
    // Handle new connections from tabs
    self.addEventListener('connect', (event) => {
      const port = event.ports[0];
      const portId = this.generatePortId();
      
      this.connectedPorts.set(portId, port);
      
      port.onmessage = (messageEvent) => {
        this.handleMessage(portId, messageEvent.data);
      };
      
      port.onmessageerror = (error) => {
        console.error('Port message error:', error);
      };
      
      port.start();
      console.log(`New tab connected with port ID: ${portId}`);
    });
  }
  
  generatePortId() {
    return `port-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
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
    
    // Associate this port with the namespace
    this.portNamespaces.set(portId, namespace);
    
    // Get or create SSE connection for this namespace
    let connectionManager = this.connections.get(namespace);
    
    if (!connectionManager) {
      connectionManager = {
        namespace,
        eventSource: null,
        isConnecting: false,
        reconnectAttempt: 0,
        reconnectTimeout: null
      };
      this.connections.set(namespace, connectionManager);
    }
    
    // Create SSE connection if not exists or disconnected
    if (!connectionManager.eventSource || connectionManager.eventSource.readyState === EventSource.CLOSED) {
      await this.createSSEConnection(connectionManager);
    }
    
    // Notify port about connection status
    this.sendToPort(port, {
      type: 'connected',
      namespace,
      portId
    });
    
    // Send current connection count
    this.updateConnectionCount(namespace);
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
    if (connectionManager.isConnecting) {
      return; // Already connecting
    }
    
    connectionManager.isConnecting = true;
    
    try {
      console.log(`Creating SSE connection for namespace: ${connectionManager.namespace}`);
      
      const eventSource = new EventSource(`/api/events?namespace=${encodeURIComponent(connectionManager.namespace)}`);
      connectionManager.eventSource = eventSource;
      
      eventSource.onopen = () => {
        console.log(`SSE connection opened for namespace: ${connectionManager.namespace}`);
        connectionManager.isConnecting = false;
        connectionManager.reconnectAttempt = 0;
        
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
      
      eventSource.onerror = () => {
        console.error(`SSE connection error for namespace: ${connectionManager.namespace}`);
        connectionManager.isConnecting = false;
        
        this.broadcastToNamespace(connectionManager.namespace, {
          type: 'disconnected',
          namespace: connectionManager.namespace
        });
        
        // Implement exponential backoff for reconnection
        this.scheduleReconnect(connectionManager);
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
      
      // Broadcast event to all tabs in this namespace
      this.broadcastToNamespace(namespace, {
        type: 'event',
        namespace,
        data: {
          ...data,
          eventType,
          id: Date.now().toString()
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
  
  scheduleReconnect(connectionManager) {
    const maxReconnectAttempts = 10;
    const baseDelay = 1000; // 1 second
    
    if (connectionManager.reconnectAttempt < maxReconnectAttempts) {
      const delay = Math.min(baseDelay * Math.pow(2, connectionManager.reconnectAttempt), 30000); // Max 30 seconds
      console.log(`Scheduling reconnect for ${connectionManager.namespace} in ${delay}ms (attempt ${connectionManager.reconnectAttempt + 1}/${maxReconnectAttempts})`);
      
      connectionManager.reconnectTimeout = setTimeout(() => {
        connectionManager.reconnectAttempt++;
        this.createSSEConnection(connectionManager);
      }, delay);
    } else {
      console.error(`Max reconnection attempts reached for namespace: ${connectionManager.namespace}`);
      this.broadcastToNamespace(connectionManager.namespace, {
        type: 'error',
        data: { message: 'Connection lost. Please refresh the page.' }
      });
    }
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
    
    connectionManager.isConnecting = false;
    connectionManager.reconnectAttempt = 0;
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
