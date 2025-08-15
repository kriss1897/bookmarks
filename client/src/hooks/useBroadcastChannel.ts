/**
 * Hook for managing broadcast channel communication
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import type { BroadcastMessage } from '../workers/sharedWorkerAPI';

interface UseBroadcastChannelReturn {
  lastMessage: BroadcastMessage | null;
  sendMessage: (message: BroadcastMessage) => void;
  error: string | null;
}

export function useBroadcastChannel(
  channelName: string,
  onMessage?: (message: BroadcastMessage) => void
): UseBroadcastChannelReturn {
  const channelRef = useRef<BroadcastChannel | null>(null);
  const [lastMessage, setLastMessage] = useState<BroadcastMessage | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sendMessage = useCallback((message: BroadcastMessage) => {
    if (channelRef.current) {
      try {
        channelRef.current.postMessage(message);
        setError(null);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to send message';
        setError(errorMessage);
        console.error(`[BroadcastChannel:${channelName}] Send error:`, err);
      }
    }
  }, [channelName]);

  useEffect(() => {
    try {
      // Create broadcast channel
      const channel = new BroadcastChannel(channelName);
      channelRef.current = channel;

      const handleMessage = (event: MessageEvent<BroadcastMessage>) => {
        const message = event.data;
        setLastMessage(message);
        setError(null);
        
        // Call optional callback
        if (onMessage) {
          onMessage(message);
        }
        
        console.log(`[BroadcastChannel:${channelName}] Message received:`, message);
      };

      channel.addEventListener('message', handleMessage);

      return () => {
        channel.removeEventListener('message', handleMessage);
        channel.close();
        channelRef.current = null;
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to create broadcast channel';
      setError(errorMessage);
      console.error(`[BroadcastChannel:${channelName}] Error:`, err);
    }
  }, [channelName, onMessage]);

  return {
    lastMessage,
    sendMessage,
    error
  };
}
