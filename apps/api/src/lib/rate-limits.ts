/** Rate-limit policies, shared by the server setup and the routes that override them. */

/** Global default per IP: generous for a single-operator dashboard. */
export const GLOBAL_RATE_LIMIT = { max: 300, timeWindow: "1 minute" } as const;

/** Login attempts per IP: small on purpose (brute-force protection). */
export const LOGIN_RATE_LIMIT = { max: 5, timeWindow: "1 minute" } as const;
