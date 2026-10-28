-- Failed owner-password attempts on /authorize, for lockout. IPs are stored as keyed hashes, not raw.
CREATE TABLE login_failures (
  ip_hash TEXT NOT NULL,
  failed_at TEXT NOT NULL
);

CREATE INDEX login_failures_failed_at ON login_failures (failed_at);
CREATE INDEX login_failures_ip ON login_failures (ip_hash, failed_at);
