import { useContext } from 'react';
import { EventLogContext } from '../contexts/EventLogContext';

export function useEventLog() {
  const context = useContext(EventLogContext);
  if (!context) {
    throw new Error('useEventLog must be used within an EventLogProvider');
  }
  return context;
}
