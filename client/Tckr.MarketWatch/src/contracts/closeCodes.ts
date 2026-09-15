/** WebSocket close codes from client-contract.md §3.4. */
export const CloseCode = {
  Normal: 1000,
  Unauthenticated: 4401,
  TokenExpired: 4403,
  HeartbeatTimeout: 4408,
  SlowConsumer: 4429,
} as const;

export type CloseCode = (typeof CloseCode)[keyof typeof CloseCode];
