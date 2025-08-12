import { useSortable } from "@dnd-kit/sortable";
import { CSS } from '@dnd-kit/utilities';

interface SortableItemProps {
  id: number;
}

export function SortableItem({ id }: SortableItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id });
  
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <div className="p-4 mb-2 bg-gray-200 rounded shadow pointer">
        Item {id}
      </div>
    </div>
  );
}
