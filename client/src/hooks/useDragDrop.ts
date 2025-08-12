import { useContext } from 'react';
import { DragDropContext } from '../contexts/DragDropContext';

export function useDragDrop() {
  const context = useContext(DragDropContext);
  if (!context) {
    throw new Error('useDragDrop must be used within a DragDropProvider');
  }
  return context;
}
