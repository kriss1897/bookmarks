// SSE Shared Worker - manages SSE connections and broadcasts events to all tabs
// Extended with offline-first functionality: operation queue, sync, and IndexedDB management
// This worker maintains a single SSE connection per namespace and distributes events to all connected tabs

class SSESharedWorker {
  constructor() {
    this.connections = new Map();
    this.connectedPorts = new Map();
    this.portNamespaces = new Map();
    
    // Operation queue and sync management
    this.syncStatus = new Map(); // namespace -> sync status
    this.batchTimeouts = new Map(); // namespace -> timeout
    this.clientId = this.generateClientId();
    
    // Reconnection configuration
    this.reconnectConfig = {
      baseDelay: 1000,        // 1 second base delay
      maxDelay: 60000,        // 60 seconds maximum delay
      maxAttempts: Infinity,  // Infinite attempts (will back off indefinitely)
      jitterFactor: 0.3,      // 30% jitter to prevent thundering herd
      stableThreshold: 30000, // 30 seconds of stable connection before resetting attempts
      backoffMultiplier: 2    // Exponential backoff multiplier
    };
    
    // Sync configuration
    this.syncConfig = {
      batchWindow: 100,       // 100ms batching window
      maxRetries: 5,          // Max retry attempts per operation
      retryDelays: [1000, 2000, 5000, 10000, 30000] // Progressive backoff
    };
    
    console.log('SSE Shared Worker initialized with offline-first capabilities');
    
    // Initialize IndexedDB
    this.initializeDB();
    
    // Check for reachability periodically
    this.startReachabilityCheck();
    
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

  generateClientId() {
    // Try to get from storage first, otherwise generate new one
    try {
      const stored = localStorage.getItem('clientId');
      if (stored) return stored;
    } catch (e) {
      // localStorage not available in worker context
    }
    
    return `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // IndexedDB initialization (simplified for worker context)
  async initializeDB() {
    try {
      this.db = await this.openDB();
      console.log('IndexedDB initialized in worker');
      
      // Resume pending syncs on startup
      await this.resumePendingSyncs();
    } catch (error) {
      console.error('Failed to initialize IndexedDB:', error);
      
      // If it's a version error, try to delete and recreate the database
      if (error.name === 'VersionError') {
        console.log('Attempting to reset IndexedDB due to version conflict...');
        await this.resetDatabase();
      }
    }
  }

  async resetDatabase() {
    try {
      // Delete the database
      const deleteReq = indexedDB.deleteDatabase('BookmarksOfflineDB');
      
      await new Promise((resolve, reject) => {
        deleteReq.onsuccess = () => resolve(true);
        deleteReq.onerror = () => reject(deleteReq.error);
        deleteReq.onblocked = () => {
          console.warn('Database deletion blocked - close all tabs and try again');
          reject(new Error('Database deletion blocked'));
        };
      });
      
      console.log('Database deleted successfully');
      
      // Reinitialize
      this.db = await this.openDB();
      console.log('Database recreated successfully');
      
    } catch (error) {
      console.error('Failed to reset database:', error);
    }
  }

  openDB() {
    return new Promise((resolve, reject) => {
      // Use a high version number to avoid conflicts with existing databases
      const dbVersion = 20250813; // Date-based versioning: YYYYMMDD
      const request = indexedDB.open('BookmarksOfflineDB', dbVersion);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      
      request.onblocked = () => {
        console.warn('Database upgrade blocked by other connections. This usually happens when multiple tabs are open.');
        console.log('Please close other tabs or windows using this app and refresh this page.');
        
        // Show a user-friendly message
        this.broadcastToAllPorts({
          type: 'DATABASE_BLOCKED',
          data: {
            message: 'Database upgrade blocked. Please close other tabs and refresh.',
            action: 'close_other_tabs'
          }
        });
        
        // Try to proceed after a delay, hoping other connections close
        setTimeout(() => {
          console.log('Retrying database opening after blocked upgrade...');
          // Don't recursively call openDB to avoid infinite loops
          const retryRequest = indexedDB.open('BookmarksOfflineDB', dbVersion);
          retryRequest.onsuccess = () => resolve(retryRequest.result);
          retryRequest.onerror = () => reject(retryRequest.error);
          retryRequest.onblocked = () => {
            // If still blocked, reject with helpful message
            reject(new Error('Database upgrade permanently blocked by other connections. Please close all tabs and try again.'));
          };
        }, 2000);
      };
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        console.log(`Upgrading database from version ${event.oldVersion} to ${event.newVersion}`);
        
        // Clear existing stores for clean upgrade
        const existingStoreNames = Array.from(db.objectStoreNames);
        existingStoreNames.forEach(storeName => {
          console.log(`Removing existing store: ${storeName}`);
          db.deleteObjectStore(storeName);
        });
        
        // Create fresh stores
        const bookmarksStore = db.createObjectStore('bookmarks', { keyPath: 'id' });
        bookmarksStore.createIndex('namespace', 'namespace');
        bookmarksStore.createIndex('isTemporary', 'isTemporary');
        
        const foldersStore = db.createObjectStore('folders', { keyPath: 'id' });
        foldersStore.createIndex('namespace', 'namespace');
        foldersStore.createIndex('isTemporary', 'isTemporary');
        
        const operationsStore = db.createObjectStore('operations', { keyPath: 'id' });
        operationsStore.createIndex('namespace', 'namespace');
        operationsStore.createIndex('status', 'status');
        operationsStore.createIndex('clientCreatedAt', 'clientCreatedAt');
        
        db.createObjectStore('syncMeta', { keyPath: 'namespace' });
        
        console.log('Database stores created successfully');
      };
    });
  }

  // Reachability check
  startReachabilityCheck() {
    this.isOnline = navigator.onLine;
    
    // Listen to online/offline events
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
    
    // Periodic ping to verify actual reachability
    setInterval(() => {
      this.checkReachability();
    }, 10000); // Check every 10 seconds
  }

  async checkReachability() {
    try {
      const response = await fetch('/api/ping', { 
        method: 'HEAD',
        signal: AbortSignal.timeout(5000)
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

  onConnectivityChange() {
    // Broadcast status to all tabs
    this.broadcastToAllPorts({
      type: 'connectivityChanged',
      data: { isOnline: this.isOnline }
    });
    
    // Start sync if we're back online
    if (this.isOnline) {
      this.resumePendingSyncs();
    }
  }

  async resumePendingSyncs() {
    if (!this.db) return;
    
    try {
      const transaction = this.db.transaction(['syncMeta'], 'readonly');
      const store = transaction.objectStore('syncMeta');
      const request = store.getAll();
      
      request.onsuccess = () => {
        const metas = request.result;
        for (const meta of metas) {
          if (meta.pendingOperationsCount > 0) {
            console.log(`Resuming sync for namespace: ${meta.namespace}`);
            this.scheduleBatchSync(meta.namespace);
          }
        }
      };
    } catch (error) {
      console.error('Error resuming pending syncs:', error);
    }
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
      // Existing SSE handlers
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
      
      // New offline-first handlers
      case 'enqueueOperation':
        this.handleEnqueueOperation(portId, message.data, port);
        break;
      case 'syncNow':
        this.handleSyncNow(message.data, port);
        break;
      case 'subscribe':
        this.handleSubscribe(portId, message.data, port);
        break;
      case 'getStatus':
        this.handleGetStatus(message.data, port);
        break;
      
      case 'GET_PENDING_OPERATIONS_COUNT':
        this.handleGetPendingOperationsCount(message.namespace, port);
        break;
      
      case 'RESET_DATABASE':
        this.handleResetDatabase(port);
        break;
      
      // Database operation handlers  
      case 'GET_NAMESPACE_ITEMS':
        this.handleGetNamespaceItems(message.data, port);
        break;
      case 'APPLY_OPERATION_OPTIMISTICALLY':
        this.handleApplyOperationOptimistically(message.data, port);
        break;
      case 'GET_BY_ID':
        this.handleGetById(message.data, port);
        break;
      case 'RECONCILE_WITH_SERVER':
        this.handleReconcileWithServer(message.data, port);
        break;
      
      // Initial data fetch handler
      case 'FETCH_INITIAL_DATA':
        this.handleFetchInitialData(message.data, port);
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

  // New offline-first handlers
  async handleEnqueueOperation(portId, data, port) {
    const { namespace, operation } = data;
    
    try {
      // Add operation to IndexedDB
      await this.enqueueOperation(operation);
      
      // Apply operation optimistically to local data
      await this.applyOperationOptimistically(operation);
      
      // Notify all tabs about data change
      this.broadcastToNamespace(namespace, {
        type: 'dataChanged',
        data: { namespace }
      });
      
      // Schedule batch sync
      this.scheduleBatchSync(namespace);
      
      // Send acknowledgment
      this.sendToPort(port, {
        type: 'ack',
        data: { operationId: operation.id }
      });
      
    } catch (error) {
      console.error('Error enqueuing operation:', error);
      this.sendToPort(port, {
        type: 'error',
        data: { 
          reason: 'Failed to enqueue operation',
          operationId: operation.id 
        }
      });
    }
  }

  async handleSyncNow(data, port) {
    const { namespace } = data;
    
    if (namespace) {
      await this.syncNamespace(namespace);
    } else {
      // Sync all namespaces
      const namespaces = Array.from(new Set(Array.from(this.portNamespaces.values())));
      for (const ns of namespaces) {
        await this.syncNamespace(ns);
      }
    }
  }

  async handleSubscribe(portId, data, port) {
    const { namespace } = data;
    
    // Associate port with namespace (for data change notifications)
    this.portNamespaces.set(portId, namespace);
    
    // Send current pending count
    const pendingCount = await this.getPendingCount(namespace);
    this.sendToPort(port, {
      type: 'pendingCount',
      data: { namespace, count: pendingCount }
    });
  }

  async handleGetStatus(data, port) {
    const { namespace } = data;
    
    if (namespace) {
      const pendingCount = await this.getPendingCount(namespace);
      const syncStatus = this.syncStatus.get(namespace) || 'idle';
      
      this.sendToPort(port, {
        type: 'status',
        data: {
          namespace,
          isOnline: this.isOnline,
          pendingCount,
          syncStatus
        }
      });
    } else {
      // Global status
      this.sendToPort(port, {
        type: 'status',
        data: {
          isOnline: this.isOnline,
          clientId: this.clientId
        }
      });
    }
  }

  async handleGetPendingOperationsCount(namespace, port) {
    if (!namespace) {
      console.warn('No namespace provided for pending operations count');
      return;
    }

    try {
      const count = await this.getPendingCount(namespace);
      this.sendToPort(port, {
        type: 'PENDING_OPERATIONS_COUNT',
        namespace,
        count
      });
    } catch (error) {
      console.error('Error getting pending operations count:', error);
      this.sendToPort(port, {
        type: 'PENDING_OPERATIONS_COUNT',
        namespace,
        count: 0
      });
    }
  }

  async handleResetDatabase(port) {
    try {
      console.log('Resetting database as requested by client...');
      await this.resetDatabase();
      
      this.sendToPort(port, {
        type: 'DATABASE_RESET_SUCCESS',
        message: 'Database reset successfully'
      });
    } catch (error) {
      console.error('Failed to reset database:', error);
      this.sendToPort(port, {
        type: 'DATABASE_RESET_ERROR',
        error: error.message
      });
    }
  }

  // Database operation handlers
  async handleGetNamespaceItems(data, port) {
    try {
      const { namespace, requestId } = data;
      const items = await this.getNamespaceItems(namespace);
      
      this.sendToPort(port, {
        type: 'GET_NAMESPACE_ITEMS_RESPONSE',
        requestId,
        data: items
      });
    } catch (error) {
      console.error('Failed to get namespace items:', error);
      this.sendToPort(port, {
        type: 'GET_NAMESPACE_ITEMS_ERROR',
        requestId: data.requestId,
        error: error.message
      });
    }
  }

  async handleApplyOperationOptimistically(data, port) {
    try {
      const { operation, requestId } = data;
      await this.applyOperationOptimistically(operation);
      
      this.sendToPort(port, {
        type: 'APPLY_OPERATION_OPTIMISTICALLY_RESPONSE',
        requestId,
        success: true
      });
    } catch (error) {
      console.error('Failed to apply operation optimistically:', error);
      this.sendToPort(port, {
        type: 'APPLY_OPERATION_OPTIMISTICALLY_ERROR',
        requestId: data.requestId,
        error: error.message
      });
    }
  }

  async handleGetById(data, port) {
    try {
      const { namespace, id, requestId } = data;
      const item = await this.getItemById(namespace, id);
      
      this.sendToPort(port, {
        type: 'GET_BY_ID_RESPONSE',
        requestId,
        data: item
      });
    } catch (error) {
      console.error('Failed to get item by ID:', error);
      this.sendToPort(port, {
        type: 'GET_BY_ID_ERROR',
        requestId: data.requestId,
        error: error.message
      });
    }
  }

  async handleReconcileWithServer(data, port) {
    try {
      const { namespace, serverItems, requestId } = data;
      await this.reconcileWithServerState(namespace, serverItems);
      
      this.sendToPort(port, {
        type: 'RECONCILE_WITH_SERVER_RESPONSE',
        requestId,
        success: true
      });
    } catch (error) {
      console.error('Failed to reconcile with server:', error);
      this.sendToPort(port, {
        type: 'RECONCILE_WITH_SERVER_ERROR',
        requestId: data.requestId,
        error: error.message
      });
    }
  }

  async handleFetchInitialData(data, port) {
    try {
      const { namespace, requestId } = data;
      await this.fetchInitialServerData(namespace);
      
      this.sendToPort(port, {
        type: 'FETCH_INITIAL_DATA_RESPONSE',
        requestId,
        success: true
      });
    } catch (error) {
      console.error('Failed to fetch initial data:', error);
      this.sendToPort(port, {
        type: 'FETCH_INITIAL_DATA_ERROR',
        requestId: data.requestId,
        error: error.message
      });
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
        // Don't broadcast heartbeats to reduce noise - they're just keep-alive signals
        console.debug(`Heartbeat received for namespace: ${connectionManager.namespace}`);
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

  // Operation queue management
  async enqueueOperation(operation) {
    if (!this.db) throw new Error('Database not initialized');
    
    const transaction = this.db.transaction(['operations'], 'readwrite');
    const store = transaction.objectStore('operations');
    
    const storedOperation = {
      id: operation.id,
      clientId: operation.clientId,
      namespace: operation.namespace,
      type: operation.type,
      payload: JSON.stringify(operation.payload),
      clientCreatedAt: operation.clientCreatedAt,
      status: operation.status,
      retryCount: operation.retryCount || 0,
      createdAt: Date.now()
    };
    
    await new Promise((resolve, reject) => {
      const request = store.put(storedOperation);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    
    // Update pending count
    await this.updatePendingCount(operation.namespace);
  }

  async applyOperationOptimistically(operation) {
    if (!this.db) return;
    
    const transaction = this.db.transaction(['bookmarks', 'folders'], 'readwrite');
    const bookmarksStore = transaction.objectStore('bookmarks');
    const foldersStore = transaction.objectStore('folders');
    const now = Date.now();
    
    try {
      switch (operation.type) {
        case 'CREATE_BOOKMARK': {
          const bookmark = {
            id: operation.payload.id,
            name: operation.payload.name,
            url: operation.payload.url,
            parentId: operation.payload.parentId,
            isFavorite: operation.payload.isFavorite || false,
            namespace: operation.namespace,
            isTemporary: operation.payload.id.toString().startsWith('temp_'),
            createdAt: now,
            updatedAt: now
          };
          await new Promise((resolve, reject) => {
            const request = bookmarksStore.put(bookmark);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
          });
          break;
        }
        
        case 'CREATE_FOLDER': {
          const folder = {
            id: operation.payload.id,
            name: operation.payload.name,
            parentId: operation.payload.parentId,
            isOpen: false,
            namespace: operation.namespace,
            isTemporary: operation.payload.id.toString().startsWith('temp_'),
            createdAt: now,
            updatedAt: now
          };
          await new Promise((resolve, reject) => {
            const request = foldersStore.put(folder);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
          });
          break;
        }
        
        case 'UPDATE_BOOKMARK': {
          // Get existing bookmark and update it
          const existing = await new Promise((resolve, reject) => {
            const request = bookmarksStore.get(operation.payload.id);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          
          if (existing) {
            const updated = {
              ...existing,
              ...(operation.payload.name !== undefined && { name: operation.payload.name }),
              ...(operation.payload.url !== undefined && { url: operation.payload.url }),
              ...(operation.payload.isFavorite !== undefined && { isFavorite: operation.payload.isFavorite }),
              updatedAt: now
            };
            
            await new Promise((resolve, reject) => {
              const request = bookmarksStore.put(updated);
              request.onsuccess = () => resolve();
              request.onerror = () => reject(request.error);
            });
          }
          break;
        }
        
        case 'UPDATE_FOLDER': {
          // Get existing folder and update it
          const existing = await new Promise((resolve, reject) => {
            const request = foldersStore.get(operation.payload.id);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          
          if (existing) {
            const updated = {
              ...existing,
              ...(operation.payload.name !== undefined && { name: operation.payload.name }),
              ...(operation.payload.isOpen !== undefined && { isOpen: operation.payload.isOpen }),
              updatedAt: now
            };
            
            await new Promise((resolve, reject) => {
              const request = foldersStore.put(updated);
              request.onsuccess = () => resolve();
              request.onerror = () => reject(request.error);
            });
          }
          break;
        }
        
        case 'DELETE_ITEM': {
          // Try deleting from both stores
          await Promise.all([
            new Promise((resolve) => {
              const request = bookmarksStore.delete(operation.payload.id);
              request.onsuccess = () => resolve();
              request.onerror = () => resolve(); // Don't fail if not found
            }),
            new Promise((resolve) => {
              const request = foldersStore.delete(operation.payload.id);
              request.onsuccess = () => resolve();
              request.onerror = () => resolve(); // Don't fail if not found
            })
          ]);
          break;
        }
        
        case 'MOVE_ITEM': {
          // Update parentId for both bookmarks and folders
          const updateParent = async (store) => {
            const existing = await new Promise((resolve, reject) => {
              const request = store.get(operation.payload.id);
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            });
            
            if (existing) {
              const updated = {
                ...existing,
                parentId: operation.payload.newParentId,
                updatedAt: now
              };
              
              await new Promise((resolve, reject) => {
                const request = store.put(updated);
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
              });
            }
          };
          
          // Try updating in both stores
          try { await updateParent(bookmarksStore); } catch {}
          try { await updateParent(foldersStore); } catch {}
          break;
        }
      }
    } catch (error) {
      console.error('Error applying operation optimistically:', error);
    }
  }

  scheduleBatchSync(namespace) {
    // Clear existing timeout
    if (this.batchTimeouts.has(namespace)) {
      clearTimeout(this.batchTimeouts.get(namespace));
    }
    
    // Schedule new batch
    const timeout = setTimeout(() => {
      this.batchTimeouts.delete(namespace);
      this.syncNamespace(namespace);
    }, this.syncConfig.batchWindow);
    
    this.batchTimeouts.set(namespace, timeout);
  }

  async syncNamespace(namespace) {
    if (!this.isOnline) {
      console.log(`Skipping sync for ${namespace} - offline`);
      return;
    }
    
    if (this.syncStatus.get(namespace) === 'syncing') {
      console.log(`Already syncing ${namespace}`);
      return;
    }
    
    try {
      this.syncStatus.set(namespace, 'syncing');
      this.broadcastToNamespace(namespace, {
        type: 'syncStatus',
        data: { namespace, status: 'syncing' }
      });
      
      // Get pending operations
      const operations = await this.getPendingOperations(namespace);
      
      if (operations.length === 0) {
        this.syncStatus.set(namespace, 'synced');
        this.broadcastToNamespace(namespace, {
          type: 'syncStatus',
          data: { namespace, status: 'synced' }
        });
        return;
      }
      
      console.log(`Syncing ${operations.length} operations for ${namespace}`);
      
      // Send to server
      const response = await fetch(`/api/sync/${encodeURIComponent(namespace)}/operations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          clientId: this.clientId,
          operations: operations
        })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const result = await response.json();
      await this.processSyncResult(namespace, result);
      
      this.syncStatus.set(namespace, 'synced');
      this.broadcastToNamespace(namespace, {
        type: 'syncStatus',
        data: { namespace, status: 'synced' }
      });
      
    } catch (error) {
      console.error(`Sync failed for ${namespace}:`, error);
      this.syncStatus.set(namespace, 'error');
      this.broadcastToNamespace(namespace, {
        type: 'syncStatus',
        data: { 
          namespace, 
          status: 'error',
          error: error.message 
        }
      });
      
      // Schedule retry with exponential backoff
      this.scheduleRetrySync(namespace);
    }
  }

  async processSyncResult(namespace, result) {
    if (!this.db) return;
    
    // Defensive programming: ensure result has expected structure
    const { applied = [], updatedItems = [], mappings = {} } = result || {};
    
    console.log('Processing sync result:', { applied, updatedItems, mappings });
    
    // Mark operations as synced or failed
    const syncedIds = [];
    const failedIds = [];
    
    // Ensure applied is iterable
    if (Array.isArray(applied)) {
      for (const appliedOp of applied) {
        if (appliedOp && appliedOp.operationId) {
          if (appliedOp.status === 'success') {
            syncedIds.push(appliedOp.operationId);
          } else {
            failedIds.push(appliedOp.operationId);
          }
        }
      }
    } else {
      console.warn('Expected applied to be an array, got:', typeof applied, applied);
    }
    
    // Update operation statuses
    if (syncedIds.length > 0) {
      await this.markOperationsSynced(syncedIds);
    }
    
    if (failedIds.length > 0) {
      await this.markOperationsFailed(failedIds);
    }
    
    // Apply ID mappings if any
    if (mappings && Object.keys(mappings).length > 0) {
      await this.applyIdMappings(mappings);
    }
    
    // Update pending count
    await this.updatePendingCount(namespace);
    
    // Notify tabs about data changes
    this.broadcastToNamespace(namespace, {
      type: 'dataChanged',
      data: { namespace }
    });
  }

  async getPendingOperations(namespace) {
    if (!this.db) return [];
    
    const transaction = this.db.transaction(['operations'], 'readonly');
    const store = transaction.objectStore('operations');
    const index = store.index('namespace');
    
    return new Promise((resolve, reject) => {
      const operations = [];
      const request = index.openCursor(IDBKeyRange.only(namespace));
      
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          const op = cursor.value;
          if (op.status === 'pending') {
            operations.push({
              id: op.id,
              clientId: op.clientId,
              namespace: op.namespace,
              type: op.type,
              payload: JSON.parse(op.payload),
              clientCreatedAt: op.clientCreatedAt,
              status: op.status,
              retryCount: op.retryCount
            });
          }
          cursor.continue();
        } else {
          // Sort by creation time
          operations.sort((a, b) => a.clientCreatedAt - b.clientCreatedAt);
          resolve(operations);
        }
      };
      
      request.onerror = () => reject(request.error);
    });
  }

  async getPendingCount(namespace) {
    if (!this.db) return 0;
    
    const transaction = this.db.transaction(['operations'], 'readonly');
    const store = transaction.objectStore('operations');
    const index = store.index('namespace');
    
    return new Promise((resolve, reject) => {
      let count = 0;
      const request = index.openCursor(IDBKeyRange.only(namespace));
      
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          if (cursor.value.status === 'pending') {
            count++;
          }
          cursor.continue();
        } else {
          resolve(count);
        }
      };
      
      request.onerror = () => reject(request.error);
    });
  }

  async markOperationsSynced(operationIds) {
    if (!this.db || operationIds.length === 0) return;
    
    const transaction = this.db.transaction(['operations'], 'readwrite');
    const store = transaction.objectStore('operations');
    
    for (const id of operationIds) {
      const request = store.get(id);
      request.onsuccess = () => {
        const operation = request.result;
        if (operation) {
          operation.status = 'synced';
          store.put(operation);
        }
      };
    }
  }

  async markOperationsFailed(operationIds) {
    if (!this.db || operationIds.length === 0) return;
    
    const transaction = this.db.transaction(['operations'], 'readwrite');
    const store = transaction.objectStore('operations');
    
    for (const id of operationIds) {
      const request = store.get(id);
      request.onsuccess = () => {
        const operation = request.result;
        if (operation) {
          operation.status = 'failed';
          operation.retryCount = (operation.retryCount || 0) + 1;
          store.put(operation);
        }
      };
    }
  }

  async applyIdMappings(mappings) {
    if (!this.db || !mappings) return;
    
    const transaction = this.db.transaction(['bookmarks', 'folders', 'operations'], 'readwrite');
    const bookmarksStore = transaction.objectStore('bookmarks');
    const foldersStore = transaction.objectStore('folders');
    const operationsStore = transaction.objectStore('operations');
    
    for (const [tempId, realId] of Object.entries(mappings)) {
      // Update bookmarks
      const bookmarkRequest = bookmarksStore.get(tempId);
      bookmarkRequest.onsuccess = () => {
        const bookmark = bookmarkRequest.result;
        if (bookmark) {
          bookmarksStore.delete(tempId);
          bookmark.id = realId;
          bookmark.isTemporary = false;
          bookmarksStore.put(bookmark);
        }
      };
      
      // Update folders
      const folderRequest = foldersStore.get(tempId);
      folderRequest.onsuccess = () => {
        const folder = folderRequest.result;
        if (folder) {
          foldersStore.delete(tempId);
          folder.id = realId;
          folder.isTemporary = false;
          foldersStore.put(folder);
        }
      };
      
      // Update operations that reference this ID
      const operationRequest = operationsStore.getAll();
      operationRequest.onsuccess = () => {
        const operations = operationRequest.result;
        for (const op of operations) {
          const payload = JSON.parse(op.payload);
          let changed = false;
          
          if (payload.id === tempId) {
            payload.id = realId;
            changed = true;
          }
          if (payload.parentId === tempId) {
            payload.parentId = realId;
            changed = true;
          }
          
          if (changed) {
            op.payload = JSON.stringify(payload);
            operationsStore.put(op);
          }
        }
      };
    }
  }

  async updatePendingCount(namespace) {
    const count = await this.getPendingCount(namespace);
    
    // Broadcast to namespace tabs
    this.broadcastToNamespace(namespace, {
      type: 'pendingCount',
      data: { namespace, count }
    });
    
    // Update sync meta
    if (this.db) {
      const transaction = this.db.transaction(['syncMeta'], 'readwrite');
      const store = transaction.objectStore('syncMeta');
      
      const request = store.get(namespace);
      request.onsuccess = () => {
        const meta = request.result || { namespace };
        meta.lastSyncTimestamp = Date.now();
        meta.pendingOperationsCount = count;
        meta.clientId = this.clientId;
        store.put(meta);
      };
    }
  }

  scheduleRetrySync(namespace) {
    // Simple retry logic - exponential backoff based on failed sync attempts
    const retryCount = this.retryAttempts?.get(namespace) || 0;
    const delay = this.syncConfig.retryDelays[Math.min(retryCount, this.syncConfig.retryDelays.length - 1)];
    
    if (!this.retryAttempts) this.retryAttempts = new Map();
    this.retryAttempts.set(namespace, retryCount + 1);
    
    setTimeout(() => {
      if (this.isOnline) {
        this.syncNamespace(namespace);
      }
    }, delay);
  }

  broadcastToAllPorts(message) {
    for (const port of this.connectedPorts.values()) {
      this.sendToPort(port, message);
    }
  }

  // Database operation methods
  async getNamespaceItems(namespace) {
    if (!this.db) throw new Error('Database not initialized');
    
    const transaction = this.db.transaction(['bookmarks', 'folders'], 'readonly');
    const bookmarksStore = transaction.objectStore('bookmarks');
    const foldersStore = transaction.objectStore('folders');
    
    // Get all bookmarks and folders for this namespace
    const [bookmarks, folders] = await Promise.all([
      this.getAllFromStore(bookmarksStore, 'namespace', namespace),
      this.getAllFromStore(foldersStore, 'namespace', namespace)
    ]);
    
    // Combine and sort by creation time
    return [...bookmarks, ...folders].sort((a, b) => a.createdAt - b.createdAt);
  }

  async applyOperationOptimistically(operation) {
    if (!this.db) throw new Error('Database not initialized');
    
    const now = Date.now();
    const transaction = this.db.transaction(['bookmarks', 'folders'], 'readwrite');
    
    switch (operation.type) {
      case 'CREATE_BOOKMARK': {
        const payload = operation.payload;
        const bookmark = {
          id: payload.id,
          name: payload.name,
          url: payload.url,
          parentId: payload.parentId,
          isFavorite: payload.isFavorite || false,
          namespace: operation.namespace,
          isTemporary: payload.id.toString().startsWith('temp_'),
          createdAt: now,
          updatedAt: now
        };
        await this.putInStore(transaction.objectStore('bookmarks'), bookmark);
        break;
      }

      case 'CREATE_FOLDER': {
        const payload = operation.payload;
        const folder = {
          id: payload.id,
          name: payload.name,
          parentId: payload.parentId,
          isOpen: false,
          namespace: operation.namespace,
          isTemporary: payload.id.toString().startsWith('temp_'),
          createdAt: now,
          updatedAt: now
        };
        await this.putInStore(transaction.objectStore('folders'), folder);
        break;
      }

      case 'UPDATE_BOOKMARK': {
        const payload = operation.payload;
        const bookmarksStore = transaction.objectStore('bookmarks');
        const existing = await this.getFromStore(bookmarksStore, payload.id);
        if (existing) {
          const updated = {
            ...existing,
            ...(payload.name !== undefined && { name: payload.name }),
            ...(payload.url !== undefined && { url: payload.url }),
            ...(payload.isFavorite !== undefined && { isFavorite: payload.isFavorite }),
            updatedAt: now
          };
          await this.putInStore(bookmarksStore, updated);
        }
        break;
      }

      case 'UPDATE_FOLDER': {
        const payload = operation.payload;
        const foldersStore = transaction.objectStore('folders');
        const existing = await this.getFromStore(foldersStore, payload.id);
        if (existing) {
          const updated = {
            ...existing,
            ...(payload.name !== undefined && { name: payload.name }),
            ...(payload.isOpen !== undefined && { isOpen: payload.isOpen }),
            updatedAt: now
          };
          await this.putInStore(foldersStore, updated);
        }
        break;
      }

      case 'DELETE_ITEM': {
        const payload = operation.payload;
        // Try deleting from both stores
        await Promise.all([
          this.deleteFromStore(transaction.objectStore('bookmarks'), payload.id),
          this.deleteFromStore(transaction.objectStore('folders'), payload.id)
        ]);
        break;
      }

      case 'MOVE_ITEM': {
        const payload = operation.payload;
        // Try updating both stores
        const bookmarksStore = transaction.objectStore('bookmarks');
        const foldersStore = transaction.objectStore('folders');
        
        const [bookmark, folder] = await Promise.all([
          this.getFromStore(bookmarksStore, payload.id),
          this.getFromStore(foldersStore, payload.id)
        ]);

        if (bookmark) {
          await this.putInStore(bookmarksStore, {
            ...bookmark,
            parentId: payload.newParentId,
            updatedAt: now
          });
        }

        if (folder) {
          await this.putInStore(foldersStore, {
            ...folder,
            parentId: payload.newParentId,
            updatedAt: now
          });
        }
        break;
      }
    }
  }

  async getItemById(namespace, id) {
    if (!this.db) throw new Error('Database not initialized');
    
    const transaction = this.db.transaction(['bookmarks', 'folders'], 'readonly');
    const [bookmark, folder] = await Promise.all([
      this.getFromStore(transaction.objectStore('bookmarks'), id),
      this.getFromStore(transaction.objectStore('folders'), id)
    ]);

    if (bookmark && bookmark.namespace === namespace) {
      return {
        id: typeof bookmark.id === 'string' ? parseInt(bookmark.id) || -1 : bookmark.id,
        type: 'bookmark',
        namespace: bookmark.namespace,
        parentId: bookmark.parentId || null,
        prevSiblingId: null,
        nextSiblingId: null,
        createdAt: bookmark.createdAt,
        updatedAt: bookmark.updatedAt,
        title: bookmark.name,
        url: bookmark.url,
        favorite: bookmark.isFavorite
      };
    }

    if (folder && folder.namespace === namespace) {
      return {
        id: typeof folder.id === 'string' ? parseInt(folder.id) || -1 : folder.id,
        type: 'folder',
        namespace: folder.namespace,
        parentId: folder.parentId || null,
        prevSiblingId: null,
        nextSiblingId: null,
        createdAt: folder.createdAt,
        updatedAt: folder.updatedAt,
        name: folder.name,
        open: folder.isOpen,
        children: []
      };
    }

    return null;
  }

  async reconcileWithServerState(namespace, serverItems) {
    if (!this.db) throw new Error('Database not initialized');
    
    const transaction = this.db.transaction(['bookmarks', 'folders'], 'readwrite');
    const bookmarksStore = transaction.objectStore('bookmarks');
    const foldersStore = transaction.objectStore('folders');
    
    // Clear existing non-temporary items for this namespace
    const bookmarks = await this.getAllFromStore(bookmarksStore, 'namespace', namespace);
    const folders = await this.getAllFromStore(foldersStore, 'namespace', namespace);
    
    for (const bookmark of bookmarks) {
      if (!bookmark.isTemporary) {
        await this.deleteFromStore(bookmarksStore, bookmark.id);
      }
    }
    
    for (const folder of folders) {
      if (!folder.isTemporary) {
        await this.deleteFromStore(foldersStore, folder.id);
      }
    }

    // Add server items
    const now = Date.now();
    for (const item of serverItems) {
      if (item.type === 'bookmark') {
        const bookmark = {
          id: item.id,
          name: item.title || '',
          url: item.url || '',
          parentId: item.parentId || undefined,
          isFavorite: item.favorite || false,
          namespace,
          isTemporary: false,
          createdAt: now,
          updatedAt: now
        };
        await this.putInStore(bookmarksStore, bookmark);
      } else if (item.type === 'folder') {
        const folder = {
          id: item.id,
          name: item.name || '',
          parentId: item.parentId || undefined,
          isOpen: item.open || false,
          namespace,
          isTemporary: false,
          createdAt: now,
          updatedAt: now
        };
        await this.putInStore(foldersStore, folder);
      }
    }
  }

  // Fetch initial server data for fresh sessions
  async fetchInitialServerData(namespace) {
    if (!this.isOnline) {
      console.log('Offline - skipping initial server data fetch');
      return;
    }

    try {
      console.log(`Fetching initial server data for namespace: ${namespace}`);
      
      const response = await fetch(`/api/bookmarks/${encodeURIComponent(namespace)}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      
      if (result.success && result.data) {
        console.log(`Received ${result.data.length} items from server for namespace: ${namespace}`);
        
        // Convert server data to local format and reconcile
        const serverItems = result.data.map(item => ({
          id: item.id,
          type: item.type,
          namespace: item.namespace,
          parentId: item.parentId,
          prevSiblingId: item.prevSiblingId,
          nextSiblingId: item.nextSiblingId,
          createdAt: item.createdAt || Date.now(),
          updatedAt: item.updatedAt || Date.now(),
          ...(item.type === 'bookmark' ? {
            title: item.title,
            url: item.url,
            favorite: item.favorite
          } : {
            name: item.name,
            open: item.open
          })
        }));

        // Reconcile with local storage
        await this.reconcileWithServerState(namespace, serverItems);
        
        // Update last sync timestamp
        await this.updateLastSync(namespace);
        
        console.log(`Initial sync completed for namespace: ${namespace}`);
        
        // Notify tabs about the initial data
        this.broadcastToNamespace(namespace, {
          type: 'initialDataLoaded',
          data: { namespace, itemCount: serverItems.length }
        });
      }
    } catch (error) {
      console.error(`Failed to fetch initial server data for namespace ${namespace}:`, error);
      
      // Notify tabs about the failure
      this.broadcastToNamespace(namespace, {
        type: 'initialDataError',
        data: { namespace, error: error.message }
      });
    }
  }

  async updateLastSync(namespace) {
    if (!this.db) return;
    
    const transaction = this.db.transaction(['syncMeta'], 'readwrite');
    const store = transaction.objectStore('syncMeta');
    
    const existing = await this.getFromStore(store, namespace);
    await this.putInStore(store, {
      namespace,
      lastSyncTimestamp: Date.now(),
      pendingOperationsCount: existing?.pendingOperationsCount || 0,
      clientId: this.clientId
    });
  }

  // Helper methods for IndexedDB operations
  async getFromStore(store, key) {
    return new Promise((resolve, reject) => {
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async putInStore(store, value) {
    return new Promise((resolve, reject) => {
      const request = store.put(value);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async deleteFromStore(store, key) {
    return new Promise((resolve, reject) => {
      const request = store.delete(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async getAllFromStore(store, indexName, value) {
    return new Promise((resolve, reject) => {
      const index = store.index(indexName);
      const request = index.getAll(value);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
}

// Initialize the shared worker
new SSESharedWorker();
