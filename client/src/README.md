# Bookmarks Client - Modular Structure

This document explains the modular architecture of the Bookmarks client application.

## Architecture Overview

The application has been restructured using React Context API and custom hooks to separate concerns and improve maintainability.

## Directory Structure

```
src/
├── components/          # Reusable UI components
│   ├── SSEControls.tsx     # Server-Sent Events controls and status
│   ├── EventsList.tsx      # Display of live events
│   ├── DragDropDemo.tsx    # Drag and drop interface
│   └── SortableItem.tsx    # Individual draggable item
├── contexts/            # React contexts for state management
│   ├── SSEContext.tsx      # Server-Sent Events state and operations
│   └── DragDropContext.tsx # Drag and drop state management
├── hooks/               # Custom React hooks
│   ├── useSSE.ts          # Hook for SSE context
│   └── useDragDrop.ts     # Hook for drag and drop context
├── App.tsx             # Main application component
└── index.ts            # Export barrel for easy imports
```

## Components

### SSEControls
- Displays connection status and connection count
- Provides buttons to trigger various types of events
- Handles user interactions for SSE operations

### EventsList
- Displays live events received from the server
- Handles message styling based on event type
- Shows timestamps and event data

### DragDropDemo
- Implements drag and drop functionality
- Uses the DragDropContext for state management

### SortableItem
- Individual draggable item component
- Handles its own drag and drop behavior

## Contexts

### SSEContext
- Manages Server-Sent Events connection
- Handles event listeners for different event types
- Provides API functions for triggering events and notifications
- Manages connection state and message history

### DragDropContext
- Manages drag and drop state (items array)
- Provides sensors for drag and drop interactions
- Handles drag end events and reordering logic

## Custom Hooks

### useSSE
- Provides access to SSE context
- Returns connection state, messages, and control functions
- Must be used within SSEProvider

### useDragDrop
- Provides access to drag and drop context
- Returns items, sensors, and drag handlers
- Must be used within DragDropProvider

## Usage

The main App component wraps everything in the context providers:

```tsx
function App() {
  return (
    <SSEProvider>
      <DragDropProvider>
        {/* Application content */}
      </DragDropProvider>
    </SSEProvider>
  );
}
```

Components can then use the custom hooks to access context:

```tsx
function MyComponent() {
  const { connectionStatus, triggerCustomEvent } = useSSE();
  const { items, handleDragEnd } = useDragDrop();
  
  // Component logic...
}
```

## Benefits

1. **Separation of Concerns**: Each component has a single responsibility
2. **Reusability**: Components and hooks can be easily reused
3. **Testability**: Isolated components and hooks are easier to test
4. **Maintainability**: Clear structure makes the code easier to understand and modify
5. **Type Safety**: Full TypeScript support with proper type definitions
6. **Performance**: Context prevents unnecessary re-renders by isolating state updates
