import { createContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';

export interface EventLogMessage {
  type: string;
  message: string;
  timestamp: string;
  data?: Record<string, unknown> | string | number | null;
  id?: string;
  namespace?: string;
}

interface EventLogContextType {
  events: EventLogMessage[];
  addEvent: (event: EventLogMessage) => void;
  clearEvents: () => void;
}

const EventLogContext = createContext<EventLogContextType | undefined>(undefined);

export { EventLogContext };

interface EventLogProviderProps {
  children: ReactNode;
}

export function EventLogProvider({ children }: EventLogProviderProps) {
  const [events, setEvents] = useState<EventLogMessage[]>([]);

  // Load persisted events on mount
  useEffect(() => {
    const loadPersistedEvents = () => {
      try {
        const stored = sessionStorage.getItem('event-log');
        if (stored) {
          const parsed = JSON.parse(stored) as EventLogMessage[];
          // Filter events by TTL (2 hours) and exclude infrastructure events
          const now = Date.now();
          const validEvents = parsed.filter((event) => {
            const eventTime = new Date(event.timestamp).getTime();
            const isNotExpired = now - eventTime < 2 * 60 * 60 * 1000; // 2 hours
            const isNotInfrastructureEvent = !['connection', 'reconnection', 'disconnect', 'heartbeat'].includes(event.type);
            return isNotExpired && isNotInfrastructureEvent;
          });
          setEvents(validEvents);
        }
      } catch (error) {
        console.warn('Error loading persisted events:', error);
      }
    };
    
    loadPersistedEvents();
  }, []);

  // Persist events when they change
  useEffect(() => {
    try {
      // Only persist last 20 events (infrastructure events are already filtered out)
      const eventsToPersist = events.slice(-20);
      sessionStorage.setItem('event-log', JSON.stringify(eventsToPersist));
    } catch (error) {
      console.warn('Error persisting events:', error);
    }
  }, [events]);

  const addEvent = (event: EventLogMessage) => {
    // Only log connection-related and heartbeat events to console, don't add to state
    if (event.type === 'connection' || event.type === 'reconnection' || event.type === 'disconnect' || event.type === 'heartbeat') {
      console.log(`[${event.type.toUpperCase()}]`, event.message, event.data ? event.data : '');
      return;
    }

    setEvents(prev => {
      // Check if event with same ID already exists (prevent duplicates)
      const eventId = event.id || `${event.timestamp}-${event.type}`;
      if (prev.some(existingEvent => (existingEvent.id || `${existingEvent.timestamp}-${existingEvent.type}`) === eventId)) {
        return prev; // Skip adding duplicate
      }
      
      return [...prev.slice(-9), event];
    });
  };

  const clearEvents = () => {
    setEvents([]);
  };

  const value: EventLogContextType = {
    events,
    addEvent,
    clearEvents,
  };

  return (
    <EventLogContext.Provider value={value}>
      {children}
    </EventLogContext.Provider>
  );
}
