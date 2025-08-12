import { SSEProvider } from './contexts/SSEContext';
import { DragDropProvider } from './contexts/DragDropContext';
import { NamespaceSelector } from './components/NamespaceSelector';
import { SSEControls } from './components/SSEControls';
import { EventsList } from './components/EventsList';
import { DragDropDemo } from './components/DragDropDemo';
import { useSSE } from './hooks/useSSE';

function AppContent() {
  const { namespace } = useSSE();

  return (
    <div className="flex min-h-svh flex-col items-center justify-center p-4">
      <h1 className="text-2xl text-black text-center mb-4">Bookmarks</h1>

      {/* Namespace Selection */}
      <NamespaceSelector />
      
      {/* Only show other components when connected to a namespace */}
      {namespace && (
        <>
          {/* SSE Connection Status and Controls */}
          <SSEControls />
          
          {/* Message Display */}
          <EventsList />

          {/* Drag and Drop Demo */}
          <div className="mt-8">
            <DragDropDemo />
          </div>
        </>
      )}
    </div>
  );
}

function App() {
  return (
    <SSEProvider>
      <DragDropProvider>
        <AppContent />
      </DragDropProvider>
    </SSEProvider>
  );
}

export default App;
