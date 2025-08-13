import { useState, useEffect } from 'react';

interface DatabaseBlockedDetails {
  message: string;
  database: string;
}

export function useDatabaseBlockedNotification() {
  const [isBlocked, setIsBlocked] = useState(false);
  const [blockDetails, setBlockDetails] = useState<DatabaseBlockedDetails | null>(null);

  useEffect(() => {
    const handleDatabaseBlocked = (event: CustomEvent<DatabaseBlockedDetails>) => {
      console.log('Database blocked detected:', event.detail);
      setBlockDetails(event.detail);
      setIsBlocked(true);
    };

    const handleWorkerMessage = (event: MessageEvent) => {
      if (event.data.type === 'DATABASE_BLOCKED') {
        console.log('Worker reported database blocked:', event.data.data);
        setBlockDetails({
          message: event.data.data.message,
          database: 'BookmarksOfflineDB'
        });
        setIsBlocked(true);
      }
    };

    // Listen for custom events from Dexie
    window.addEventListener('database-blocked', handleDatabaseBlocked as EventListener);
    
    // Listen for SharedWorker messages about database blocking
    // Note: This requires the SharedWorker to be available
    try {
      const worker = new SharedWorker('/sse-shared-worker.js');
      worker.port.onmessage = handleWorkerMessage;
      worker.port.start();
    } catch (error) {
      console.warn('Could not connect to SharedWorker for database notifications:', error);
    }

    return () => {
      window.removeEventListener('database-blocked', handleDatabaseBlocked as EventListener);
    };
  }, []);

  const dismissNotification = () => {
    setIsBlocked(false);
    setBlockDetails(null);
  };

  return {
    isBlocked,
    blockDetails,
    dismissNotification
  };
}

export default useDatabaseBlockedNotification;
