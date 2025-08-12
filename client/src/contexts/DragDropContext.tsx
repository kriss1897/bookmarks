import { createContext, useState } from 'react';
import {
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import type { ReactNode } from 'react';

interface DragDropContextType {
  items: number[];
  sensors: ReturnType<typeof useSensors>;
  handleDragEnd: (event: DragEndEvent) => void;
}

const DragDropContext = createContext<DragDropContextType | undefined>(undefined);

export { DragDropContext };

interface DragDropProviderProps {
  children: ReactNode;
}

export function DragDropProvider({ children }: DragDropProviderProps) {
  const [items, setItems] = useState([1, 2, 3]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;

    if (active.id !== over?.id) {
      setItems((items) => {
        const oldIndex = items.indexOf(active.id as number);
        const newIndex = items.indexOf(over?.id as number);

        return arrayMove(items, oldIndex, newIndex);
      });
    }
  }

  const value: DragDropContextType = {
    items,
    sensors,
    handleDragEnd,
  };

  return (
    <DragDropContext.Provider value={value}>
      {children}
    </DragDropContext.Provider>
  );
}
