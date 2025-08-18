/**
 * Component to display server synchronization status
 * Shows sync progress, pending operations, and allows manual retry
 */

import { useServerSync } from "../hooks/useServerSync";
import { Button } from "./ui/button";

export const ServerSyncStatus = () => {
  const { syncStatus, refreshSyncStatus, isLoading, error } = useServerSync();

  const handleRefresh = () => {
    refreshSyncStatus();
  };

  const getStatusColor = () => {
    if (!syncStatus.isConnected) return "bg-gray-400";
    if (syncStatus.isSyncing) return "bg-blue-500 animate-pulse";
    if (syncStatus.failedCount && syncStatus.failedCount > 0)
      return "bg-yellow-500";
    return "bg-green-500";
  };

  const getStatusText = () => {
    if (!syncStatus.isConnected) return "Disconnected";
    if (syncStatus.isSyncing) return "Syncing...";
    if (syncStatus.failedCount && syncStatus.failedCount > 0)
      return "Issues detected";
    return "Synced";
  };

  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2">
        <div className="h-2 w-2 rounded-full bg-red-500" aria-hidden="true" />
        <span className="text-sm text-red-700">Sync Error: {error}</span>
        <Button
          size="sm"
          variant="outline"
          onClick={handleRefresh}
          disabled={isLoading}
          className="ml-auto"
          aria-label="Retry synchronization"
        >
          {isLoading ? "..." : "Retry"}
        </Button>
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2"
      role="status"
      aria-label={`Sync status: ${getStatusText()}`}
    >
      {/* Status Indicator */}
      <div
        className={`h-2 w-2 rounded-full ${getStatusColor()}`}
        aria-hidden="true"
      />

      {/* Status Text */}
      <span className="text-sm text-gray-700">{getStatusText()}</span>

      {/* Connection Status */}
      {!syncStatus.isConnected && (
        <span className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-500">
          Offline
        </span>
      )}

      {/* Pending/Failed Counts */}
      {syncStatus.pendingCount !== undefined && syncStatus.pendingCount > 0 && (
        <span
          className="rounded bg-orange-100 px-2 py-1 text-xs text-orange-600"
          title={`${syncStatus.pendingCount} operations waiting to sync`}
        >
          {syncStatus.pendingCount} pending
        </span>
      )}

      {syncStatus.failedCount !== undefined && syncStatus.failedCount > 0 && (
        <span
          className="rounded bg-red-100 px-2 py-1 text-xs text-red-600"
          title={`${syncStatus.failedCount} operations failed to sync`}
        >
          {syncStatus.failedCount} failed
        </span>
      )}

      {/* Last Sync Error */}
      {syncStatus.lastSyncError && (
        <span
          className="text-xs text-red-600"
          title={`Last sync error: ${syncStatus.lastSyncError}`}
          aria-label={`Warning: Last sync failed with error: ${syncStatus.lastSyncError}`}
        >
          ⚠️ Last sync failed
        </span>
      )}

      {/* Refresh Button */}
      <Button
        size="sm"
        variant="ghost"
        onClick={handleRefresh}
        disabled={isLoading || !syncStatus.isConnected}
        className="ml-auto h-6 w-6 p-0"
        aria-label="Refresh sync status"
        title={isLoading ? "Refreshing..." : "Refresh sync status"}
      >
        {isLoading ? "•••" : "🔄"}
      </Button>
    </div>
  );
};
