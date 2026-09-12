# Elevation Recommendation – Client Confirmation Required

## Status

**Proposal only.** No daemon or app implementation should begin until the Windows/app team confirms this design and the wire contract.

## Decision needed

Aqua needs to distinguish between:

1. **Normal filesystem operations** – continue through the existing daemon path without a password.
2. **An operation that needs Linux privileges** – the app asks the user for their WSL sudo password and explicitly requests elevation.
3. **Subsequent elevated retries** – the app retries the failed operation with `elevated: true`; it does not resend the password for every operation.

The password is therefore supplied by the app only during an explicit elevation request. It is not included in ordinary `fs/op` requests and is not passed to the privileged filesystem helper.

## Recommended flow

```text
App sends ordinary fs/op
        |
        v
Daemon performs the operation
        |
        +--> success: return normal success
        |
        +--> permission failure: return needsElevation: true

App shows an elevation modal
        |
        v
User enters the WSL sudo password
        |
        v
App sends POST /api/system/elevate { password }
        |
        +--> failure: show a generic authentication/elevation error
        |
        +--> success: receive expiresAt

App retries the original fs/op with elevated: true
        |
        v
Daemon invokes the separate helper with sudo -n
        |
        +--> helper succeeds: return normal success
        +--> sudo cache expired/helper rejects: return needsElevation: true
```

## Password handling

- The app owns the password-entry UI and must treat the value as sensitive.
- The daemon accepts the password only for `POST /api/system/elevate`.
- The daemon passes it to `sudo -S -v` through stdin, never through argv, logs, query strings, or environment variables.
- The daemon must not persist the password or retain it after validation.
- The app must not include the password in `fs/op`, WebSocket messages, telemetry, crash reports, or persisted UI state.
- The privileged helper receives no password. It is invoked with `sudo -n`, relying on sudo's existing credential timestamp.

## Authentication clarification

The password is used to authorize a real Linux privilege transition through sudo. It is **not** a general HTTP authentication mechanism for the daemon.

The existing Aqua security model remains:

- The daemon binds only to `127.0.0.1:61234`.
- The dedicated Tauri WebView is the trusted client boundary.
- Exact Origin checks remain browser hardening.
- No bearer token, session cookie, or request credential is added to ordinary daemon endpoints.

A different authentication model would be a broader contract and security change. The client team should explicitly request that separately rather than treating the sudo password as an HTTP login credential.

## Elevation cache

- Cache only an in-memory expiry timestamp in the daemon.
- Proposed lifetime: five minutes, matching the contract proposal.
- Return `expiresAt` from the elevation endpoint so the app can update its UI, but treat the daemon's cache as authoritative.
- The cache must be invalidated when its timestamp expires.
- A successful `POST /api/system/elevate` refreshes the sudo credential timestamp and the daemon's in-memory expiry.
- The app should be prepared for `needsElevation: true` even before the displayed `expiresAt`, because sudo may invalidate its timestamp independently.

## Privileged helper boundary

Elevated filesystem retries must not run inside the main daemon process. The daemon should invoke a separate, minimal, single-shot helper binary:

```text
sudo -n /path/to/aqua-daemon-helper
```

The helper receives one serialized operation and the daemon's fixed allowed root over stdin, then:

1. Re-derives the allowed-root descriptor.
2. Re-runs the existing traversal, absolute-path, symlink, collision, and root-deletion checks.
3. Performs exactly one operation.
4. Returns one structured result and exits.

The helper must never trust a path validation performed by the unprivileged daemon. It must not use a shell or interpolate paths into shell commands.

## Client behavior requirements

The app team should confirm that the app will:

- Show an elevation modal only after `needsElevation: true`, or when the user explicitly starts a privileged action.
- Keep the original operation available for a retry after successful elevation.
- Avoid repeated prompts while the returned `expiresAt` is still valid.
- Re-prompt if an elevated retry returns `needsElevation: true`.
- Display generic failure text and avoid exposing raw sudo diagnostics.
- Clear the password field immediately after submitting or receiving the result.
- Never persist the password across app restart.
- Treat daemon shutdown/restart as requiring elevation again.

## Contract confirmation requested

Please confirm these points before implementation:

- `POST /api/system/elevate` accepts `{ "password": "..." }` and returns `{ "success": true, "expiresAt": "..." }` on success.
- Ordinary `fs/op` requests do not contain a password.
- `elevated: true` means “perform this one operation through the privileged helper,” not “trust this request automatically.”
- Permission failures use `needsElevation: true`.
- The app owns the modal, password lifecycle, retry, and user-facing errors.
- The daemon owns sudo validation, the in-memory expiry, helper invocation, and all filesystem safety checks.
- This feature does not add general HTTP authentication to the localhost daemon.

## Suggested implementation order after confirmation

1. Agree on the exact request/response shapes with the app team.
2. Add the daemon elevation endpoint and in-memory expiry cache.
3. Add the standalone helper binary and share the existing filesystem safety implementation without weakening it.
4. Add fake-sudo tests for successful elevation, invalid credentials, expired cache, helper failure, and fresh helper revalidation.
5. Have the app implement the modal and retry flow.
6. Run native Windows-to-WSL integration tests without shutting down the real WSL instance.
