import * as React from "react";
import { Loader2, Signal, WifiOff, TriangleAlert } from "lucide-react";
import { Button } from "./ui/button";
import { useSharedWorkerConnection } from "@/hooks/useSharedWorkerConnection";
import { useBroadcastChannel } from "@/hooks/useBroadcastChannel";
import type { SSEConnectionState } from "@/types/sse";
import type { BroadcastMessage } from "@/workers/sharedWorkerAPI";

/**
 * HeaderEventsIndicator: icon-only SSE connection status for the header with tooltip.
 */
export const HeaderEventsIndicator: React.FC = () => {
  const { workerProxy, isConnected } = useSharedWorkerConnection();
  const [state, setState] = React.useState<SSEConnectionState>({ connected: false, connecting: false });

  // Get initial SSE state
  React.useEffect(() => {
    let mounted = true;
    (async () => {
      if (!workerProxy || !isConnected) return;
      try {
        const s = await workerProxy.getSSEState();
        if (mounted) setState(s);
  } catch {
        // noop
      }
    })();
    return () => {
      mounted = false;
    };
  }, [workerProxy, isConnected]);

  // Subscribe to SSE state changes
  useBroadcastChannel('bookmarks-sse', (message: BroadcastMessage) => {
    if (message.type === 'sse_state_changed') {
      setState(message.state);
    }
  });

  const title = state.error
    ? `SSE error: ${state.error}`
    : state.connecting
      ? 'SSE: Connecting…'
      : state.connected
        ? 'SSE: Connected'
        : 'SSE: Disconnected';

  const { icon, color, spinning } = (() => {
    if (state.error) return { icon: <TriangleAlert className="size-4" />, color: 'text-yellow-600', spinning: false };
    if (state.connecting) return { icon: <Loader2 className="size-4" />, color: 'text-blue-600', spinning: true };
    if (state.connected) return { icon: <Signal className="size-4" />, color: 'text-green-600', spinning: false };
    return { icon: <WifiOff className="size-4" />, color: 'text-red-600', spinning: false };
  })();

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={title}
      title={title}
      className="relative"
      onClick={() => {/* reserved for future quick actions */}}
    >
      <span className={"transition-transform " + (spinning ? "animate-spin" : "") + " " + color} aria-hidden>
        {icon}
      </span>
      <span className="sr-only">SSE status</span>
    </Button>
  );
};

export default HeaderEventsIndicator;
