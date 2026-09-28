---
paths:
  - "src/data/**/*"
  - "src/contracts/**/*"
  - "src/test-support/**/*"
---

# Data layer and contracts

Rules are in `GUIDELINES.md` §1 and §2. They apply here in these ways:

- Any behaviour change must hold for **both** `SimulatedSource` and `TckrGatewaySource`. Run
  or extend `src/data/__tests__/conformance/`.
- The wire shape is frozen by `docs/phase-3-web-client/client-contract.md` (repo root).
  Change it only with an ADR. Gateway ambiguities are listed in ADR-006's addenda; don't
  resolve them silently in code.
- Prices stay `DecimalString`. Read `decimal.no-float.test.ts` before touching a price
  path.
- Reconnect, backoff and close-code handling lives in `reconnect.ts` / `closeCodes.ts`.
  Never add a second retry loop.
- This area triggers `/security-review` in `/postflight`.
