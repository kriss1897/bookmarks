/**
 * SharedWorker connection manager
 * Handles the low-level connection, Comlink wrapping, and lifecycle
 */

import * as Comlink from 'comlink';
import type { SharedWorkerAPI } from '../workers/sharedWorkerAPI';

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface ConnectionStatus {
  state: ConnectionState;
  error?: string;
  api?: Comlink.Remote<SharedWorkerAPI>;
}

export class SharedWorkerConnection {
  private worker: SharedWorker | null = null;
  private api: Comlink.Remote<SharedWorkerAPI> | null = null;
  private state: ConnectionState = 'disconnected';
  private error: string | null = null;
  private tabId: string;
  private listeners: Array<(status: ConnectionStatus) => void> = [];

  constructor() {
    this.tabId = this.generateTabId();
  }

  private generateTabId(): string {
    return `tab-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`;
  }

  private notifyListeners(): void {
    const status: ConnectionStatus = {
      state: this.state,
      error: this.error || undefined,
      api: this.api || undefined
    };
    this.listeners.forEach(listener => listener(status));
  }

  private setState(state: ConnectionState, error?: string): void {
    this.state = state;
    this.error = error || null;
    this.notifyListeners();
  }

  public onStateChange(listener: (status: ConnectionStatus) => void): () => void {
    this.listeners.push(listener);
    // Call immediately with current state
    listener({
      state: this.state,
      error: this.error || undefined,
      api: this.api || undefined
    });
    
    // Return unsubscribe function
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  public async connect(): Promise<void> {
    if (this.state === 'connected' || this.state === 'connecting') {
      return;
    }

    try {
      this.setState('connecting');

      // Create SharedWorker
      this.worker = new SharedWorker(
        new URL('../workers/bookmarkWorker.ts', import.meta.url),
        { type: 'module' }
      );

      // Set up error handling
      this.worker.addEventListener('error', (event) => {
        this.setState('error', `Worker error: ${event.message}`);
      });

      // Wrap with Comlink
      this.api = Comlink.wrap<SharedWorkerAPI>(this.worker.port);

      // Connect to worker
      await this.api.connect(this.tabId);

      console.log('connected');

      this.setState('connected');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to connect to SharedWorker';
      this.setState('error', errorMessage);
      throw error;
    }
  }

  public async disconnect(): Promise<void> {
    try {
      if (this.api) {
        await this.api.disconnect(this.tabId);
      }
    } catch (error) {
      console.warn('Error during disconnect:', error);
    } finally {
      this.api = null;
      this.worker = null;
      this.setState('disconnected');
    }
  }

  public getAPI(): Comlink.Remote<SharedWorkerAPI> | null {
    return this.api;
  }

  public isConnected(): boolean {
    return this.state === 'connected' && this.api !== null;
  }

  public getState(): ConnectionState {
    return this.state;
  }

  public getError(): string | null {
    return this.error;
  }
}
