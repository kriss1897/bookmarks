import * as React from "react";
import { WifiOff, CheckCircle2, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "./ui/button";
import { useServerSync } from "@/hooks/useServerSync";

/**
 * HeaderSyncIndicator: icon-only sync status for the header with tooltip.
 */
export const HeaderSyncIndicator: React.FC = () => {
  const { syncStatus, refreshSyncStatus, isLoading, error } = useServerSync();

  const handleClick = () => {
    if (!isLoading) refreshSyncStatus();
  };

  const { icon, color, title, spinning } = React.useMemo(() => {
    if (!syncStatus?.isConnected) {
      return {
        icon: <WifiOff className="size-4" />,
        color: "text-red-600",
        title: error ? `Sync error: ${error}` : "Disconnected",
        spinning: false,
      };
    }
    if (syncStatus.isSyncing || isLoading) {
      return {
        icon: <Loader2 className="size-4" />,
        color: "text-blue-600",
        title: "Syncing…",
        spinning: true,
      };
    }
    if (syncStatus.failedCount && syncStatus.failedCount > 0) {
      const t = `${syncStatus.failedCount} failed • Click to retry`;
      return {
        icon: <TriangleAlert className="size-4" />,
        color: "text-yellow-600",
        title: t,
        spinning: false,
      };
    }
    return {
      icon: <CheckCircle2 className="size-4" />,
      color: "text-green-600",
      title: "Synced",
      spinning: false,
    };
  }, [syncStatus, isLoading, error]);

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={handleClick}
      aria-label={title}
      title={title}
      className="relative"
    >
      <span
        className={
          "transition-transform " +
          (spinning ? "animate-spin" : "") +
          " " +
          color
        }
        aria-hidden
      >
        {icon}
      </span>
      <span className="sr-only">Sync status</span>
    </Button>
  );
};

export default HeaderSyncIndicator;
