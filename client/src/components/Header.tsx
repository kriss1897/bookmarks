import { useNamespace } from '../hooks/useNamespace';
import { useWorkerConnection } from '../hooks/useWorkerConnection';

export function Header() {
  const { namespace, setNamespace } = useNamespace();
  const { connectionStatus, reconnectInfo, countdownSeconds } = useWorkerConnection();

  const predefinedNamespaces = ['bookmarks', 'notifications', 'chat', 'updates'];

  const statusStyles = {
    badge: connectionStatus === 'connected'
      ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300'
      : connectionStatus === 'connecting'
      ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300'
      : connectionStatus === 'reconnecting'
      ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300'
      : 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
    dot: connectionStatus === 'connected'
      ? 'bg-green-600'
      : connectionStatus === 'connecting'
      ? 'bg-yellow-600'
      : connectionStatus === 'reconnecting'
      ? 'bg-blue-600'
      : 'bg-red-600',
  } as const;

  return (
    <div className="flex-shrink-0 m-4 mb-6 rounded-lg border bg-white/70 p-3 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-white/50 dark:border-neutral-800 dark:bg-neutral-900/70">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Bookmarks Manager</h1>
          {namespace && <span className="text-sm text-neutral-500">/ {namespace}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label htmlFor="global-ns-select" className="text-sm text-neutral-600 dark:text-neutral-300">Namespace</label>
            <select
              id="global-ns-select"
              value={namespace}
              onChange={(e) => setNamespace(e.target.value)}
              className="rounded-md border bg-white px-2 py-1 text-sm shadow-xs outline-none ring-0 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
            >
              <option value="" disabled>Select namespace…</option>
              {predefinedNamespaces.map((ns) => (
                <option key={ns} value={ns}>{ns}</option>
              ))}
              {namespace && !predefinedNamespaces.includes(namespace) && (
                <option value={namespace}>{namespace}</option>
              )}
            </select>
          </div>
          <span
            className={`inline-flex items-center gap-2 rounded-full px-2 py-0.5 text-xs font-medium ${statusStyles.badge}`}
            title={connectionStatus === 'reconnecting' && reconnectInfo ? `attempt ${reconnectInfo.attempt}${countdownSeconds > 0 ? ` • retry in ${countdownSeconds}s` : ''}` : ''}
          >
            <span className={`size-2 rounded-full ${statusStyles.dot}`} />
            {connectionStatus}
          </span>
        </div>
      </div>
    </div>
  );
}
