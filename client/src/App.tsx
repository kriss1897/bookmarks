import { NamespaceProvider } from './contexts/NamespaceContext'
import { EventLogProvider } from './contexts/EventLogContext'
import { WorkerConnectionProvider } from './contexts/WorkerConnectionContext'
import { DragDropProvider } from './contexts/DragDropContext'
// import { NamespaceSelector } from './components/NamespaceSelector'
import { BookmarkManager } from './components/BookmarkManager'
import { DevTools } from './components/DevTools'
import { Header } from './components/Header'
import { EventLogBridge } from './components/EventLogBridge'
// import { SSEControls } from './components/SSEControls'
// import { EventsList } from './components/EventsList'
// import { DragDropDemo } from './components/DragDropDemo'
import { ErrorBoundary } from './components/ErrorBoundary'
import { useNamespace } from './hooks/useNamespace'
import { EventsList } from './components/EventsList'

function AppContent() {
  const { namespace } = useNamespace();

  return (
    <div className="flex h-screen">
      {/* Event log bridge - connects worker events to debug log */}
      <EventLogBridge />
      
      {/* Main content area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Global Header */}
        <Header />

        {/* Scrollable main content */}
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {namespace ? (
            <div className="max-w-4xl mx-auto">
              {/* Main Bookmark Management UI */}
              <div className="w-full">
                <BookmarkManager namespace={namespace} />
              </div>
            </div>
          ) : (
            <div className="max-w-4xl mx-auto text-sm text-neutral-600 dark:text-neutral-400">
              Select a namespace above to get started.
            </div>
          )}
        </div>
      </div>

      {/* Right sidebar - 100vh */}
      {namespace && (
        <aside className="hidden md:block w-100 h-screen bg-neutral-50 dark:bg-neutral-900 border-l dark:border-neutral-800">
          <div className="h-full p-4 space-y-4 flex flex-col">
            <DevTools namespace={namespace} />
            <div className='flex grow'><EventsList variant='sidebar' /></div>
          </div>
        </aside>
      )}
    </div>
  )
}

function App() {
	return (
		<ErrorBoundary>
			<NamespaceProvider>
				<EventLogProvider>
					<WorkerConnectionProvider>
						<DragDropProvider>
							<AppContent />
						</DragDropProvider>
					</WorkerConnectionProvider>
				</EventLogProvider>
			</NamespaceProvider>
		</ErrorBoundary>
	)
}

export default App;
