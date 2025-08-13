import { useEffect } from 'react';
import { useWorkerConnection } from '../hooks/useWorkerConnection';
import { useEventLog } from '../hooks/useEventLog';
import { useNamespace } from '../hooks/useNamespace';

// Generate unique IDs for events to prevent duplicates
let eventCounter = 0;
function generateUniqueEventId(): string {
  return `${Date.now()}-${++eventCounter}`;
}

/**
 * Component that bridges worker events to the event log for debugging purposes
 */
export function EventLogBridge() {
  const { addEventListener } = useWorkerConnection();
  const { addEvent } = useEventLog();
  const { namespace } = useNamespace();

  useEffect(() => {
    const setupEventBridge = async () => {
      try {
        // Bridge all worker events to the event log
        await addEventListener('connected', (data) => {
          addEvent({
            type: 'connected',
            message: `Connected to namespace: ${namespace}`,
            timestamp: new Date().toISOString(),
            id: generateUniqueEventId(),
            namespace,
            data: data as Record<string, unknown>
          });
        });

        await addEventListener('disconnected', (data) => {
          addEvent({
            type: 'disconnected',
            message: `Disconnected from namespace: ${namespace}`,
            timestamp: new Date().toISOString(),
            id: generateUniqueEventId(),
            namespace,
            data: data as Record<string, unknown>
          });
        });

        await addEventListener('reconnecting', (data) => {
          const reconnectData = data as { attempt: number; delayMs: number; nextRetryAt: string };
          addEvent({
            type: 'reconnecting',
            message: `Reconnecting to namespace: ${namespace} (attempt ${reconnectData?.attempt || 1})`,
            timestamp: new Date().toISOString(),
            id: generateUniqueEventId(),
            namespace,
            data: data as Record<string, unknown>
          });
        });

        await addEventListener('event', (data) => {
          const eventData = data as { namespace: string; data: unknown; type: string; timestamp: string; id: string };
          addEvent({
            type: eventData.type || 'event',
            message: eventData.data ? JSON.stringify(eventData.data) : 'SSE Event',
            timestamp: eventData.timestamp || new Date().toISOString(),
            id: eventData.id || generateUniqueEventId(),
            namespace: eventData.namespace,
            data: eventData.data as Record<string, unknown>
          });
        });

        await addEventListener('dataChanged', (data) => {
          const eventData = data as { namespace: string; type?: string; itemCount?: number };
          addEvent({
            type: 'dataChanged',
            message: `Data changed in namespace: ${eventData.namespace}${eventData.itemCount ? ` (${eventData.itemCount} items)` : ''}`,
            timestamp: new Date().toISOString(),
            id: generateUniqueEventId(),
            namespace: eventData.namespace,
            data: eventData
          });
        });

        await addEventListener('error', (data) => {
          const errorData = data as { namespace: string; error: string };
          addEvent({
            type: 'error',
            message: `Error in namespace: ${errorData.namespace} - ${errorData.error}`,
            timestamp: new Date().toISOString(),
            id: generateUniqueEventId(),
            namespace: errorData.namespace,
            data: errorData
          });
        });

      } catch (error) {
        console.error('Failed to setup event bridge:', error);
      }
    };

    if (namespace) {
      setupEventBridge();
    }
  }, [namespace, addEventListener, addEvent]);

  // This component doesn't render anything - it's just a bridge
  return null;
}
