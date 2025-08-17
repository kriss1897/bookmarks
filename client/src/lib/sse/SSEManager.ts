import type { ServerEvent, SSEConnectionState } from '../../types/sse';

export interface SSEConfig {
  maxReconnectAttempts: number;
  baseReconnectDelay: number;
  maxReconnectDelay: number;
  backoffMultiplier: number;
}

const DEFAULT_CONFIG: SSEConfig = {
  maxReconnectAttempts: 10,
  baseReconnectDelay: 1000,
  maxReconnectDelay: 30000,
  backoffMultiplier: 2
};

export class SSEManager {
  private eventSource: EventSource | null = null;
  private reconnectAttempts = 0;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private state: SSEConnectionState = { connected: false, connecting: false };
  private config: SSEConfig;
  private url: string;
  private namespace: string;
  private onMessage: (event: ServerEvent) => void;
  private onStateChange: (state: SSEConnectionState) => void;

  constructor(
    url: string,
    namespace: string,
    onMessage: (event: ServerEvent) => void,
    onStateChange: (state: SSEConnectionState) => void,
    config: Partial<SSEConfig> = {}
  ) {
    this.url = url;
    this.namespace = namespace;
    this.onMessage = onMessage;
    this.onStateChange = onStateChange;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  connect(): void {
    if (this.state.connecting || this.state.connected) {
      console.log('SSE already connecting or connected');
      return;
    }

    this.setState({ connecting: true, error: undefined });

    try {
      const sseUrl = `${this.url}?namespace=${encodeURIComponent(this.namespace)}`;
      console.log(`Connecting to SSE: ${sseUrl}`);

      this.eventSource = new EventSource(sseUrl);

      this.eventSource.onopen = () => {
        console.log('SSE connection opened');
        this.reconnectAttempts = 0;
        this.setState({
          connected: true,
          connecting: false,
          lastConnected: Date.now(),
          reconnectAttempt: 0
        });
      };

      this.eventSource.onmessage = (event) => {
        this.handleMessage(event);
      };

      this.eventSource.onerror = (error) => {
        console.error('SSE connection error:', error);
        this.handleError();
      };

      // Listen for specific event types
      this.setupEventListeners();

    } catch (error) {
      console.error('Failed to create SSE connection:', error);
      this.handleError();
    }
  }

  disconnect(): void {
    console.log('Disconnecting SSE');

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    this.setState({ connected: false, connecting: false });
  }

  getState(): SSEConnectionState {
    return { ...this.state };
  }

  private setupEventListeners(): void {
    if (!this.eventSource) return;

    // Standard SSE events
    const eventTypes = [
      'connection',
      'operation',
      'bookmark_created',
      'bookmark_updated',
      'bookmark_deleted',
      'folder_created',
      'folder_updated',
      'folder_deleted',
      'item_moved',
      'folder_toggled'
    ];

    eventTypes.forEach(eventType => {
      this.eventSource!.addEventListener(eventType, (event) => {
        this.handleTypedEvent(eventType, event);
      });
    });
  }

  private handleMessage(event: MessageEvent): void {
    try {
      const data = JSON.parse(event.data);
      console.log('SSE message received:', data);

      const serverEvent: ServerEvent = {
        id: data.id || `sse-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        type: data.type || 'message',
        data,
        timestamp: data.timestamp || new Date().toISOString(),
        namespace: this.namespace
      };

      this.onMessage(serverEvent);
    } catch (error) {
      console.error('Failed to parse SSE message:', error);
    }
  }

  private handleTypedEvent(eventType: string, event: MessageEvent): void {
    try {
      const data = JSON.parse(event.data);
      console.log(`SSE ${eventType} event received:`, data);

      const serverEvent: ServerEvent = {
        id: data.id || `sse-${eventType}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        type: eventType,
        data,
        timestamp: data.timestamp || new Date().toISOString(),
        namespace: this.namespace
      };

      this.onMessage(serverEvent);
    } catch (error) {
      console.error(`Failed to parse SSE ${eventType} event:`, error);
    }
  }

  private handleError(): void {
    const wasConnected = this.state.connected;

    this.setState({
      connected: false,
      connecting: false,
      error: 'Connection failed'
    });

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    // Only schedule reconnect if we were previously connected or this is the first attempt
    if (wasConnected || this.reconnectAttempts === 0) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      console.error('Max reconnect attempts reached');
      this.setState({
        error: 'Max reconnect attempts reached',
        reconnectAttempt: this.reconnectAttempts
      });
      return;
    }

    const delay = Math.min(
      this.config.baseReconnectDelay * Math.pow(this.config.backoffMultiplier, this.reconnectAttempts),
      this.config.maxReconnectDelay
    );

    console.log(`Scheduling SSE reconnect in ${delay}ms (attempt ${this.reconnectAttempts + 1})`);

    this.setState({
      reconnectAttempt: this.reconnectAttempts + 1
    });

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectAttempts++;
      this.reconnectTimeout = null;
      this.connect();
    }, delay) as ReturnType<typeof setTimeout>;
  }

  private setState(newState: Partial<SSEConnectionState>): void {
    this.state = { ...this.state, ...newState };
    this.onStateChange(this.state);
  }
}
