import { createContext } from 'react';
import type { ReactNode } from 'react';
import { usePersistedState } from '../hooks/usePersistedState';

interface NamespaceContextType {
  namespace: string;
  setNamespace: (namespace: string) => void;
}

const NamespaceContext = createContext<NamespaceContextType | undefined>(undefined);

export { NamespaceContext };

interface NamespaceProviderProps {
  children: ReactNode;
}

export function NamespaceProvider({ children }: NamespaceProviderProps) {
  const [namespace, setNamespace] = usePersistedState('sse-namespace', '');

  const value: NamespaceContextType = {
    namespace,
    setNamespace,
  };

  return (
    <NamespaceContext.Provider value={value}>
      {children}
    </NamespaceContext.Provider>
  );
}
