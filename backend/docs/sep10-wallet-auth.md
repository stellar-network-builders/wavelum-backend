# SEP-10 Stellar wallet login

The running CommonJS Express server mounts a TypeScript SEP-10 service through
`src/middleware/sep10Auth.middleware.js`. The existing legacy
`POST /api/auth/login` handler remains unchanged.

Set `SEP10_SIGNING_SEED` to a dedicated server Stellar signing key,
`SEP10_HOME_DOMAIN` to the advertised SEP-10 home domain, and
`SEP10_WEB_AUTH_DOMAIN` to the authentication domain. Configure
`STELLAR_NETWORK_PASSPHRASE` for the chosen network (testnet by default).
Do not reuse production and testnet signing material. Redis must be connected
and available, as the replay record has a five-minute TTL.

1. `POST /api/auth/sep10/challenge` with JSON
   `{"account":"G..."}` returns the unsigned-by-client XDR in
   `data.transaction` and `data.network_passphrase`.
2. Sign that XDR using the client Stellar keypair on the specified network.
3. `POST /api/auth/sep10/verify` with
   `{"transaction":"<signed XDR>"}` validates the transaction's
   server/client signatures, home domain, and expiry; atomically consumes its
   Redis record; then returns an ordinary application access token. The refresh
   token uses the application's existing secure HttpOnly cookie.

**Replay protection:** Redis `GETDEL`, or an atomic Lua equivalent, must
consume each challenge exactly once. A missing, expired, mismatched, or replayed
record cannot authenticate. On Redis failure, authentication fails closed;
the server does not issue an access token. Every issued challenge is single-use.

Focused regression (with installed project dependencies):
`cd backend && npx jest test/sep10Auth.integration.test.js --runInBand`.
No live Stellar network or deployed device is needed for this test.
