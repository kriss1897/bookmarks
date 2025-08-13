export const RECONNECT_CONFIG = {
  baseDelay: 1000,
  maxDelay: 60000,
  maxAttempts: Infinity,
  jitterFactor: 0.3,
  stableThreshold: 30000,
  backoffMultiplier: 2
} as const;

export const SYNC_CONFIG = {
  batchWindow: 100,
  maxRetries: 5,
  retryDelays: [1000, 2000, 5000, 10000, 30000]
} as const;

export const DATABASE_CONFIG = {
  name: 'BookmarksOfflineDB',
  version: 20250813
} as const;

export const REACHABILITY_CONFIG = {
  checkInterval: 10000,
  timeoutMs: 5000
} as const;
