import { SSEProvider } from './contexts/SSEContext'
import { DragDropProvider } from './contexts/DragDropContext'
import { NamespaceSelector } from './components/NamespaceSelector'
import { BookmarkManager } from './components/BookmarkManager'
// import { SSEControls } from './components/SSEControls'
// import { EventsList } from './components/EventsList'
// import { DragDropDemo } from './components/DragDropDemo'
import { ErrorBoundary } from './components/ErrorBoundary'
import { useSSE } from './hooks/useSSE'

function AppContent() {
  const { namespace } = useSSE();

  return (
    <div className="flex min-h-svh flex-col items-center justify-start p-4">
      <h1 className="text-3xl font-bold text-center mb-6">Bookmarks Manager</h1>

      {/* Namespace Selection */}
      <NamespaceSelector />
      
      {/* Only show other components when connected to a namespace */}
      {namespace && (
        <>
          {/* Main Bookmark Management UI */}
          <div className="w-full mb-8">
            <BookmarkManager namespace={namespace} />
          </div>
        </>
      )}
    </div>
  );
}

function App() {
	return (
		<ErrorBoundary>
			<SSEProvider>
				<DragDropProvider>
					<AppContent />
				</DragDropProvider>
			</SSEProvider>
		</ErrorBoundary>
	)
}

export default App;
