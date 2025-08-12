import { useState, useEffect, useCallback } from 'react';

type StorageType = 'localStorage' | 'sessionStorage';

interface UsePersistedStateOptions<T> {
  storageType?: StorageType;
  serialize?: (value: T) => string;
  deserialize?: (value: string) => T;
}

/**
 * Custom hook for persisting state to browser storage
 * @param key - Storage key
 * @param defaultValue - Default value if nothing in storage
 * @param options - Configuration options
 */
export function usePersistedState<T>(
  key: string,
  defaultValue: T,
  options: UsePersistedStateOptions<T> = {}
): [T, (value: T | ((prev: T) => T)) => void, () => void] {
  const {
    storageType = 'localStorage',
    serialize = JSON.stringify,
    deserialize = JSON.parse,
  } = options;

  const storage = typeof window !== 'undefined' ? window[storageType] as Storage : null;

  // Initialize state from storage or default value
  const [state, setState] = useState<T>(() => {
    if (!storage) return defaultValue;
    
    try {
      const item = storage.getItem(key);
      return item ? deserialize(item) : defaultValue;
    } catch (error) {
      console.warn(`Error reading from ${storageType} for key "${key}":`, error);
      return defaultValue;
    }
  });

  // Update storage when state changes
  const setValue = useCallback((value: T | ((prev: T) => T)) => {
    try {
      setState((prevState) => {
        const newValue = typeof value === 'function' ? (value as (prev: T) => T)(prevState) : value;
        
        if (storage) {
          try {
            storage.setItem(key, serialize(newValue));
          } catch (error) {
            console.warn(`Error writing to ${storageType} for key "${key}":`, error);
          }
        }
        
        return newValue;
      });
    } catch (error) {
      console.warn(`Error updating persisted state for key "${key}":`, error);
    }
  }, [key, serialize, storage, storageType]);

  // Clear persisted value
  const clearValue = useCallback(() => {
    try {
      if (storage) {
        storage.removeItem(key);
      }
      setState(defaultValue);
    } catch (error) {
      console.warn(`Error clearing ${storageType} for key "${key}":`, error);
    }
  }, [key, defaultValue, storage, storageType]);

  // Sync with storage changes from other tabs (localStorage only)
  useEffect(() => {
    if (storageType !== 'localStorage' || !storage) return;

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === key && e.newValue !== null) {
        try {
          setState(deserialize(e.newValue));
        } catch (error) {
          console.warn(`Error syncing storage change for key "${key}":`, error);
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [key, deserialize, storageType, storage]);

  return [state, setValue, clearValue];
}

interface PersistedMessage {
  [key: string]: unknown;
  persistedAt?: number;
}

/**
 * Hook for persisting messages with TTL and size limits
 */
export function usePersistedMessages(
  key: string,
  maxMessages: number = 50,
  ttlHours: number = 24
) {
  const [messages, setMessages, clearMessages] = usePersistedState(
    key,
    [] as PersistedMessage[],
    {
      storageType: 'sessionStorage', // Use sessionStorage for messages
      serialize: (messages: PersistedMessage[]) => {
        // Add timestamp and limit messages
        const now = Date.now();
        const validMessages = messages
          .map((msg: PersistedMessage) => ({
            ...msg,
            persistedAt: msg.persistedAt || now
          }))
          .filter((msg: PersistedMessage) => {
            const age = now - (msg.persistedAt || 0);
            return age < ttlHours * 60 * 60 * 1000; // TTL check
          })
          .slice(-maxMessages); // Limit size
        
        return JSON.stringify(validMessages);
      }
    }
  );

  return [messages, setMessages, clearMessages];
}
