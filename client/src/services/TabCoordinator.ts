export interface TabLeaderInfo {
  tabId: string;
  timestamp: number;
  heartbeat: number;
}

export interface BroadcastMessage {
  type: 'sse-event' | 'leader-heartbeat' | 'leader-change' | 'leader-election';
  namespace: string;
  tabId: string;
  data?: unknown;
  timestamp: number;
}

/**
 * TabCoordinator manages tab leadership for SSE connections
 * Ensures only one tab per browser maintains SSE connection per namespace
 */
export class TabCoordinator {
  private tabId: string;
  private broadcastChannels: Map<string, BroadcastChannel> = new Map();
  private heartbeatIntervals: Map<string, NodeJS.Timeout> = new Map();
  private leadershipStatus: Map<string, boolean> = new Map();
  private onEventCallbacks: Map<string, (event: unknown) => void> = new Map();
  private onLeaderChangeCallbacks: Map<string, (isLeader: boolean) => void> = new Map();
  
  private readonly HEARTBEAT_INTERVAL = 5000; // 5 seconds
  private readonly LEADER_TIMEOUT = 15000; // 15 seconds
  private readonly ELECTION_DELAY = 1000; // 1 second

  constructor() {
    this.tabId = this.generateTabId();
    this.setupBeforeUnload();
    console.log(`TabCoordinator initialized with ID: ${this.tabId}`);
  }

  /**
   * Initialize coordination for a specific namespace
   */
  initializeNamespace(namespace: string): boolean {
    if (this.broadcastChannels.has(namespace)) {
      return this.leadershipStatus.get(namespace) || false;
    }

    // Setup BroadcastChannel for this namespace
    const channel = new BroadcastChannel(`sse-${namespace}`);
    this.broadcastChannels.set(namespace, channel);

    // Listen for messages from other tabs
    channel.onmessage = (event) => {
      this.handleBroadcastMessage(namespace, event.data as BroadcastMessage);
    };

    // Elect leader for this namespace
    return this.electLeader(namespace);
  }

  /**
   * Check if this tab is the leader for a namespace
   */
  isLeader(namespace: string): boolean {
    return this.leadershipStatus.get(namespace) || false;
  }

  /**
   * Set event callback for receiving SSE events from leader tab
   */
  onEvent(namespace: string, callback: (event: unknown) => void): void {
    this.onEventCallbacks.set(namespace, callback);
  }

  /**
   * Set callback for leadership changes
   */
  onLeaderChange(namespace: string, callback: (isLeader: boolean) => void): void {
    this.onLeaderChangeCallbacks.set(namespace, callback);
  }

  /**
   * Broadcast SSE event to other tabs (only called by leader)
   */
  broadcastEvent(namespace: string, event: unknown): void {
    if (!this.isLeader(namespace)) {
      console.warn(`Tab ${this.tabId} is not leader for namespace ${namespace}, cannot broadcast event`);
      return;
    }

    const channel = this.broadcastChannels.get(namespace);
    if (channel) {
      const message: BroadcastMessage = {
        type: 'sse-event',
        namespace,
        tabId: this.tabId,
        data: event,
        timestamp: Date.now()
      };
      channel.postMessage(message);
    }
  }

  /**
   * Cleanup resources for a namespace
   */
  cleanup(namespace?: string): void {
    if (namespace) {
      // Cleanup specific namespace
      this.cleanupNamespace(namespace);
    } else {
      // Cleanup all namespaces
      this.broadcastChannels.forEach((_, ns) => {
        this.cleanupNamespace(ns);
      });
    }
  }

  /**
   * Generate unique tab ID
   */
  private generateTabId(): string {
    return `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Elect leader for a namespace
   */
  private electLeader(namespace: string): boolean {
    const storageKey = `tab-leader-${namespace}`;
    const now = Date.now();
    
    try {
      const existingLeaderData = localStorage.getItem(storageKey);
      
      if (existingLeaderData) {
        const leaderInfo: TabLeaderInfo = JSON.parse(existingLeaderData);
        
        // Check if existing leader is still alive
        if (now - leaderInfo.heartbeat < this.LEADER_TIMEOUT) {
          console.log(`Existing leader found for namespace ${namespace}: ${leaderInfo.tabId}`);
          this.leadershipStatus.set(namespace, false);
          this.startFollowerMode(namespace);
          return false;
        }
      }

      // No valid leader found, become leader
      console.log(`Becoming leader for namespace ${namespace}`);
      this.becomeLeader(namespace);
      return true;

    } catch (error) {
      console.error('Error during leader election:', error);
      // If localStorage fails, assume leadership to ensure functionality
      this.becomeLeader(namespace);
      return true;
    }
  }

  /**
   * Become leader for a namespace
   */
  private becomeLeader(namespace: string): void {
    this.leadershipStatus.set(namespace, true);
    this.updateLeaderInfo(namespace);
    this.startHeartbeat(namespace);
    
    // Notify other tabs about leadership change
    this.broadcastLeaderChange(namespace);
    
    // Notify callback
    const callback = this.onLeaderChangeCallbacks.get(namespace);
    if (callback) {
      callback(true);
    }
  }

  /**
   * Start follower mode for a namespace
   */
  private startFollowerMode(namespace: string): void {
    this.leadershipStatus.set(namespace, false);
    
    // Check periodically if we should take over leadership
    const checkInterval = setInterval(() => {
      if (this.shouldTakeOverLeadership(namespace)) {
        clearInterval(checkInterval);
        this.becomeLeader(namespace);
      }
    }, this.HEARTBEAT_INTERVAL);

    // Store interval for cleanup
    this.heartbeatIntervals.set(`${namespace}-check`, checkInterval);
  }

  /**
   * Check if this tab should take over leadership
   */
  private shouldTakeOverLeadership(namespace: string): boolean {
    const storageKey = `tab-leader-${namespace}`;
    
    try {
      const existingLeaderData = localStorage.getItem(storageKey);
      
      if (!existingLeaderData) {
        return true;
      }

      const leaderInfo: TabLeaderInfo = JSON.parse(existingLeaderData);
      const now = Date.now();
      
      // Take over if leader hasn't sent heartbeat recently
      return now - leaderInfo.heartbeat > this.LEADER_TIMEOUT;
      
    } catch (error) {
      console.error('Error checking leadership:', error);
      return true;
    }
  }

  /**
   * Update leader info in localStorage
   */
  private updateLeaderInfo(namespace: string): void {
    const storageKey = `tab-leader-${namespace}`;
    const leaderInfo: TabLeaderInfo = {
      tabId: this.tabId,
      timestamp: Date.now(),
      heartbeat: Date.now()
    };
    
    try {
      localStorage.setItem(storageKey, JSON.stringify(leaderInfo));
    } catch (error) {
      console.error('Error updating leader info:', error);
    }
  }

  /**
   * Start heartbeat for leader
   */
  private startHeartbeat(namespace: string): void {
    const interval = setInterval(() => {
      if (this.isLeader(namespace)) {
        this.updateLeaderInfo(namespace);
        this.broadcastHeartbeat(namespace);
      } else {
        clearInterval(interval);
      }
    }, this.HEARTBEAT_INTERVAL);

    this.heartbeatIntervals.set(namespace, interval);
  }

  /**
   * Broadcast heartbeat to other tabs
   */
  private broadcastHeartbeat(namespace: string): void {
    const channel = this.broadcastChannels.get(namespace);
    if (channel) {
      const message: BroadcastMessage = {
        type: 'leader-heartbeat',
        namespace,
        tabId: this.tabId,
        timestamp: Date.now()
      };
      channel.postMessage(message);
    }
  }

  /**
   * Broadcast leader change to other tabs
   */
  private broadcastLeaderChange(namespace: string): void {
    const channel = this.broadcastChannels.get(namespace);
    if (channel) {
      const message: BroadcastMessage = {
        type: 'leader-change',
        namespace,
        tabId: this.tabId,
        timestamp: Date.now()
      };
      channel.postMessage(message);
    }
  }

  /**
   * Handle incoming broadcast messages
   */
  private handleBroadcastMessage(namespace: string, message: BroadcastMessage): void {
    // Ignore messages from this tab
    if (message.tabId === this.tabId) {
      return;
    }

    switch (message.type) {
      case 'sse-event': {
        // Forward SSE event to callback
        const eventCallback = this.onEventCallbacks.get(namespace);
        if (eventCallback && !this.isLeader(namespace)) {
          eventCallback(message.data);
        }
        break;
      }

      case 'leader-heartbeat': {
        // Leader is alive, remain follower
        if (this.isLeader(namespace) && message.timestamp > Date.now() - this.ELECTION_DELAY) {
          // Another tab claimed leadership more recently, step down
          console.log(`Stepping down as leader for namespace ${namespace}, newer leader detected`);
          this.stepDownAsLeader(namespace);
        }
        break;
      }

      case 'leader-change': {
        // New leader elected
        if (this.isLeader(namespace) && message.tabId !== this.tabId) {
          console.log(`New leader elected for namespace ${namespace}: ${message.tabId}`);
          this.stepDownAsLeader(namespace);
        }
        break;
      }
    }
  }

  /**
   * Step down as leader
   */
  private stepDownAsLeader(namespace: string): void {
    this.leadershipStatus.set(namespace, false);
    
    // Clear heartbeat
    const interval = this.heartbeatIntervals.get(namespace);
    if (interval) {
      clearInterval(interval);
      this.heartbeatIntervals.delete(namespace);
    }

    // Start follower mode
    this.startFollowerMode(namespace);

    // Notify callback
    const callback = this.onLeaderChangeCallbacks.get(namespace);
    if (callback) {
      callback(false);
    }
  }

  /**
   * Cleanup resources for a specific namespace
   */
  private cleanupNamespace(namespace: string): void {
    // Close broadcast channel
    const channel = this.broadcastChannels.get(namespace);
    if (channel) {
      channel.close();
      this.broadcastChannels.delete(namespace);
    }

    // Clear intervals
    const interval = this.heartbeatIntervals.get(namespace);
    if (interval) {
      clearInterval(interval);
      this.heartbeatIntervals.delete(namespace);
    }

    const checkInterval = this.heartbeatIntervals.get(`${namespace}-check`);
    if (checkInterval) {
      clearInterval(checkInterval);
      this.heartbeatIntervals.delete(`${namespace}-check`);
    }

    // Clear leader status
    this.leadershipStatus.delete(namespace);

    // Clear callbacks
    this.onEventCallbacks.delete(namespace);
    this.onLeaderChangeCallbacks.delete(namespace);

    // Remove from localStorage if this tab was leader
    try {
      const storageKey = `tab-leader-${namespace}`;
      const existingLeaderData = localStorage.getItem(storageKey);
      
      if (existingLeaderData) {
        const leaderInfo: TabLeaderInfo = JSON.parse(existingLeaderData);
        if (leaderInfo.tabId === this.tabId) {
          localStorage.removeItem(storageKey);
        }
      }
    } catch (error) {
      console.error('Error cleaning up leader info:', error);
    }
  }

  /**
   * Setup beforeunload handler for cleanup
   */
  private setupBeforeUnload(): void {
    window.addEventListener('beforeunload', () => {
      this.cleanup();
    });
  }
}
