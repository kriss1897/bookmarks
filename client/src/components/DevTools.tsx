import React from 'react';
import { offlineWorkerService } from '../services/offlineWorkerService';
import { localDB } from '../services/localDB';

interface DevToolsProps {
  namespace: string;
}

export function DevTools({ namespace }: DevToolsProps) {
  const [isResetting, setIsResetting] = React.useState(false);
  const [message, setMessage] = React.useState('');

  // Only show in development
  if (process.env.NODE_ENV !== 'development') {
    return null;
  }

  const handleResetDatabase = async () => {
    if (!confirm('Are you sure you want to reset the database? This will delete all local data.')) {
      return;
    }

    setIsResetting(true);
    setMessage('');

    try {
      // Reset both the SharedWorker database and Dexie database
      await Promise.all([
        offlineWorkerService.resetDatabase(),
        localDB.resetDatabase()
      ]);
      
      setMessage('Database reset successfully! Please refresh the page.');
    } catch (error) {
      console.error('Failed to reset database:', error);
      setMessage(`Failed to reset database: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsResetting(false);
    }
  };

  const handleClearStorage = () => {
    if (!confirm('Are you sure you want to clear all localStorage and sessionStorage?')) {
      return;
    }

    try {
      localStorage.clear();
      sessionStorage.clear();
      setMessage('Storage cleared successfully! Please refresh the page.');
    } catch (error) {
      console.error('Failed to clear storage:', error);
      setMessage(`Failed to clear storage: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleClearAllData = async () => {
    if (!confirm('Are you sure you want to clear ALL data including IndexedDB? This will delete everything and require a page refresh.')) {
      return;
    }

    try {
      // Clear all storage
      localStorage.clear();
      sessionStorage.clear();

      // Clear IndexedDB databases
      const databases = await indexedDB.databases();
      const deletePromises = databases.map(db => {
        if (db.name) {
          return new Promise<void>((resolve, reject) => {
            const deleteReq = indexedDB.deleteDatabase(db.name!);
            deleteReq.onsuccess = () => resolve();
            deleteReq.onerror = () => reject(deleteReq.error);
            deleteReq.onblocked = () => {
              console.warn(`Deletion of ${db.name} blocked`);
              resolve(); // Don't fail the whole operation
            };
          });
        }
        return Promise.resolve();
      });

      await Promise.all(deletePromises);
      setMessage('All data cleared successfully! Please close all tabs and restart the app.');
    } catch (error) {
      console.error('Failed to clear all data:', error);
      setMessage(`Failed to clear all data: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleForceSync = async () => {
    try {
      await offlineWorkerService.syncNow(namespace);
      setMessage('Sync triggered successfully!');
    } catch (error) {
      console.error('Failed to trigger sync:', error);
      setMessage(`Failed to trigger sync: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  return (
    <div className="w-full rounded-lg border bg-white p-3 shadow-sm dark:bg-neutral-900 dark:border-neutral-800">
      <h3 className="text-sm font-semibold mb-3 text-neutral-800 dark:text-neutral-200">🔧 Dev Tools</h3>
      
      <div className="space-y-2">
        <button
          onClick={handleResetDatabase}
          disabled={isResetting}
          className="w-full bg-red-600 hover:bg-red-700 disabled:bg-red-400 px-3 py-2 rounded text-xs font-medium text-white transition-colors"
        >
          {isResetting ? 'Resetting...' : 'Reset Database'}
        </button>
        
        <button
          onClick={handleClearStorage}
          className="w-full bg-orange-600 hover:bg-orange-700 px-3 py-2 rounded text-xs font-medium text-white transition-colors"
        >
          Clear Storage
        </button>

        <button
          onClick={handleClearAllData}
          className="w-full bg-red-800 hover:bg-red-900 px-3 py-2 rounded text-xs font-medium text-white transition-colors"
        >
          Clear ALL Data
        </button>
        
        <button
          onClick={handleForceSync}
          className="w-full bg-blue-600 hover:bg-blue-700 px-3 py-2 rounded text-xs font-medium text-white transition-colors"
        >
          Force Sync
        </button>
      </div>
      
      {message && (
        <div className="mt-3 p-2 bg-neutral-100 dark:bg-neutral-800 rounded text-xs text-neutral-700 dark:text-neutral-300">
          {message}
        </div>
      )}
      
      <div className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
        Namespace: {namespace}
      </div>
    </div>
  );
}

export default DevTools;
