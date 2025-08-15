/**
 * Test component for SharedWorker functionality
 * This provides a simple interface to test the SharedWorker bookmark system
 */

import React from 'react';
import { useSharedWorkerBookmarks } from '../hooks/useSharedWorkerBookmarks';
import { Button } from './ui/button';
import type { OperationEnvelope } from '../lib/treeOps';

export const SharedWorkerTest: React.FC = () => {
  const {
    tree,
    error,
    connected,
    createFolder,
    createBookmark,
    refreshTree,
    getOperationLog
  } = useSharedWorkerBookmarks();

  const [operationLog, setOperationLog] = React.useState<OperationEnvelope[]>([]);

  const handleCreateTestFolder = async () => {
    try {
      const folderId = await createFolder({
        title: `Test Folder ${Date.now()}`,
        isOpen: true
      });
      console.log('Created folder:', folderId);
    } catch (error) {
      console.error('Error creating folder:', error);
    }
  };

  const handleCreateTestBookmark = async () => {
    try {
      const bookmarkId = await createBookmark({
        title: `Test Bookmark ${Date.now()}`,
        url: `https://example.com/${Date.now()}`
      });
      console.log('Created bookmark:', bookmarkId);
    } catch (error) {
      console.error('Error creating bookmark:', error);
    }
  };

  const handleGetOperationLog = async () => {
    try {
      const log = await getOperationLog();
      setOperationLog(log);
      console.log('Operation log:', log);
    } catch (error) {
      console.error('Error getting operation log:', error);
    }
  };

  if (!connected) {
    return (
      <div className="flex w-full max-w-2xl flex-col gap-3 p-4">
        <div className="text-xl font-semibold">SharedWorker Test</div>
        <div className="text-sm text-muted-foreground">Connecting to SharedWorker...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex w-full max-w-2xl flex-col gap-3 p-4">
        <div className="text-xl font-semibold">SharedWorker Test</div>
        <div className="text-sm text-red-500">Error: {error}</div>
        <Button onClick={refreshTree} variant="outline">Retry Connection</Button>
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-2xl flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <div className="text-xl font-semibold">SharedWorker Test</div>
        <div className={`ml-auto rounded px-2 py-1 text-xs ${connected ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
          {connected ? 'Connected' : 'Disconnected'}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button onClick={handleCreateTestFolder}>Create Test Folder</Button>
        <Button onClick={handleCreateTestBookmark} variant="secondary">Create Test Bookmark</Button>
        <Button onClick={refreshTree} variant="outline">Refresh Tree</Button>
        <Button onClick={handleGetOperationLog} variant="outline">Get Log</Button>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <div className="mb-1 text-xs font-medium text-muted-foreground">Tree State</div>
          <pre className="max-h-64 overflow-auto rounded-md border bg-accent/20 p-3 font-mono text-[11px] leading-tight">
            {tree ? JSON.stringify(tree, null, 2) : 'No tree data'}
          </pre>
        </div>
        <div>
          <div className="mb-1 text-xs font-medium text-muted-foreground">
            Operation Log ({operationLog.length} operations)
          </div>
          <div className="max-h-64 overflow-auto rounded-md border bg-accent/10 p-2">
            {operationLog.length === 0 ? (
              <div className="p-2 text-xs text-muted-foreground">Click "Get Log" to see operations.</div>
            ) : (
              <ol className="space-y-1 text-xs">
                {operationLog.map((op, i) => (
                  <li key={op.id} className="rounded bg-background p-1">
                    <span className="mr-2 inline-block w-5 text-right text-muted-foreground">{i + 1}.</span>
                    <code className="font-mono">{op.op.type}</code>
                    <span className="ml-2 text-muted-foreground">
                      {new Date(op.ts).toLocaleTimeString()}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
