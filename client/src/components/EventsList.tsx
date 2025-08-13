import { useSSE } from '../hooks/useSSE'

interface EventsListProps {
  variant?: 'default' | 'sidebar'
}

export function EventsList({ variant = 'default' }: EventsListProps) {
	const { sseMessages, namespace } = useSSE()

	function getMessageStyle(type: string) {
		switch (type) {
			case 'connection':
				return 'border-blue-400 bg-blue-50 dark:border-blue-700 dark:bg-blue-950'
			case 'trigger':
				return 'border-purple-400 bg-purple-50 dark:border-purple-700 dark:bg-purple-950'
			case 'notification':
				return 'border-green-400 bg-green-50 dark:border-green-700 dark:bg-green-950'
			case 'heartbeat':
				return 'border-neutral-300 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900'
			default:
				return 'border-neutral-300 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900'
		}
	}

	// Sort by timestamp descending so latest is on top
	const messagesDesc = [...sseMessages].sort((a, b) => {
		const ta = new Date(a.timestamp).getTime()
		const tb = new Date(b.timestamp).getTime()
		return tb - ta
	})

  const containerClasses = variant === 'sidebar'
    ? 'w-full rounded-lg border bg-white p-3 shadow-sm dark:bg-neutral-900'
    : 'w-full max-w-2xl rounded-lg border bg-white p-4 shadow-sm dark:bg-neutral-900'

  const scrollAreaClasses = variant === 'sidebar'
    ? 'h-[calc(100vh-200px)] overflow-y-auto rounded-md border bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-950'
    : 'max-h-60 overflow-y-auto rounded-md border bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-950'

	return (
		<div className={containerClasses}>
			<h3 className="text-sm font-semibold mb-2 text-neutral-800 dark:text-neutral-200">
				Live Events for "{namespace}" ({sseMessages.length}):
			</h3>
			<div className={scrollAreaClasses}>
				{sseMessages.length > 0 ? (
					<div className="space-y-2">
						{messagesDesc.map((msg, index) => (
							<div key={msg.id || index} className={`p-2 rounded text-xs border-l-4 ${getMessageStyle(msg.type)}`}>
								<div className="flex justify-between items-start mb-1">
									<span className="font-semibold text-neutral-800 uppercase tracking-wide dark:text-neutral-100">
										{msg.type}
										{msg.namespace && (
											<span className="text-xs text-neutral-500 ml-2">@{msg.namespace}</span>
										)}
									</span>
									<span className="text-neutral-500 text-[11px]">
										{new Date(msg.timestamp).toLocaleTimeString()}
									</span>
								</div>
								<div className="text-neutral-700 mb-1 dark:text-neutral-300">
									{msg.message}
								</div>
								{msg.data && (
									<pre className="mt-1 overflow-x-auto rounded bg-white p-2 font-mono text-[10px] text-neutral-700 shadow-inner dark:bg-neutral-900 dark:text-neutral-300">
										{typeof msg.data === 'string' ? msg.data : JSON.stringify(msg.data, null, 2)}
									</pre>
								)}
							</div>
						))}
					</div>
				) : (
					<div className="flex h-28 flex-col items-center justify-center rounded border border-dashed text-center text-sm text-neutral-500 dark:border-neutral-800">
						No events yet for
						<span className="mx-1 font-medium">"{namespace}"</span>
						Try triggering events above.
					</div>
				)}
			</div>
		</div>
	)
}
