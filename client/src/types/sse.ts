export interface ServerEvent {
  id: string;
  type: string;
  data: Record<string, unknown>;
  timestamp: string;
  namespace?: string;
}

export interface SSEConnectionState {
  connected: boolean;
  connecting: boolean;
  error?: string;
  lastConnected?: number;
  reconnectAttempt?: number;
}
