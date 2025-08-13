import { useContext } from 'react';
import { WorkerConnectionContext } from '../contexts/WorkerConnectionContext';

export function useWorkerConnection() {
  const context = useContext(WorkerConnectionContext);
  if (!context) {
    throw new Error('useWorkerConnection must be used within a WorkerConnectionProvider');
  }
  return context;
}
