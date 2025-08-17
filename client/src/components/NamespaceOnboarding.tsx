import React from 'react';
import { useNamespace } from '@/hooks/useNamespace';
import { Button } from './ui/button';

export const NamespaceOnboarding: React.FC = () => {
  const { selected, namespaces, loading, error, setNamespace, reload } = useNamespace();

  if (loading) {
    return <div className="p-4 text-sm text-muted-foreground">Loading namespaces…</div>;
  }

  if (error) {
    return (
      <div className="p-4 border border-red-300 bg-red-50 rounded">
        <div className="text-red-700 mb-2">{error}</div>
        <Button onClick={reload} variant="destructive" size="sm">Retry</Button>
      </div>
    );
  }

  if (!namespaces.length) {
    return <div className="p-4 text-sm text-muted-foreground">No namespaces available.</div>;
  }

  return (
    <div className="rounded border p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold">Namespace</h3>
          <p className="text-xs text-muted-foreground">Select which namespace to use for this tab</p>
        </div>
        {selected && (
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-700">
            Active: {selected}
          </span>
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {namespaces.map(ns => (
          <button
            key={ns.namespace}
            onClick={() => void setNamespace(ns.namespace)}
            className={
              `flex items-center justify-between rounded border px-3 py-2 text-left hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 ` +
              (selected === ns.namespace ? 'border-blue-500 bg-blue-50' : 'border-slate-200')
            }
            aria-label={`Select namespace ${ns.namespace}`}
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void setNamespace(ns.namespace); } }}
          >
            <div>
              <div className="font-medium">{ns.rootNodeTitle}</div>
              <div className="text-xs text-muted-foreground">{ns.namespace}</div>
            </div>
            {selected === ns.namespace && (
              <span className="ml-2 text-xs text-blue-700">Selected</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
};

export default NamespaceOnboarding;
