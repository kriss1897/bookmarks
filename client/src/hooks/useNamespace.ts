import { useCallback, useEffect, useState } from 'react';
import { useSharedWorkerConnection } from './useSharedWorkerConnection';

const STORAGE_KEY = 'bookmarks:selectedNamespace';

export type Namespace = {
  namespace: string;
  rootNodeId: string;
  rootNodeTitle: string;
};

export const useNamespace = () => {
  const { workerProxy, isConnected } = useSharedWorkerConnection();
  const [selected, setSelected] = useState<string | null>(null);
  const [namespaces, setNamespaces] = useState<Namespace[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load current selection
  useEffect(() => {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing) setSelected(existing);
  }, []);

  // Apply saved namespace to worker when connected
  useEffect(() => {
    if (selected && isConnected && workerProxy) {
      void workerProxy.setNamespace(selected).catch(() => {
        /* handled elsewhere */
      });
    }
  }, [selected, isConnected, workerProxy]);

  const fetchNamespaces = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('http://localhost:5000/api/namespaces');
      const json = await res.json();
      if (json?.success && Array.isArray(json.data)) {
        setNamespaces(json.data as Namespace[]);
      } else {
        throw new Error(json?.message || 'Failed to load namespaces');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load namespaces');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchNamespaces();
  }, [fetchNamespaces]);

  const applyNamespace = useCallback(
    async (ns: string) => {
      localStorage.setItem(STORAGE_KEY, ns);
      setSelected(ns);
      if (isConnected && workerProxy) {
        try {
          await workerProxy.setNamespace(ns);
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Failed to set namespace');
        }
      }
    },
    [isConnected, workerProxy]
  );

  return { selected, namespaces, loading, error, setNamespace: applyNamespace, reload: fetchNamespaces };
};
