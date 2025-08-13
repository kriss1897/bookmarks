import { useContext } from 'react';
import { NamespaceContext } from '../contexts/NamespaceContext';

export function useNamespace() {
  const context = useContext(NamespaceContext);
  if (!context) {
    throw new Error('useNamespace must be used within a NamespaceProvider');
  }
  return context;
}
