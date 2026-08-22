# Aqua UI Spec — System Modals (Confirmation & Elevation)

Two modal types shared across the whole OS — every app and the System Menu route through these same two components rather than inventing per-app dialogs, so a confirmation always looks and behaves the same whether it's Finder asking about a delete or the System Menu asking about a restart.

Data source: Confirmation Modal is pure UI (caller supplies copy + action). Elevation Modal talks to a new daemon endpoint, `POST /api/system/elevate` — see the CONTRACT addendum.

## Shared modal shell

Centered overlay, `--bg-overlay` panel, `10px` corner radius (matches window radius — these read as belonging to the same OS as the windows they interrupt), max-width ~380px, sits above everything including the Menu Bar. Backdrop: the whole desktop dims under a `--bg-base` scrim at ~50% opacity — high enough to make clear input is blocked, not so dark it reads as an error state.

Both modal types are strictly modal: no click-outside-to-dismiss (a system-level confirmation or a password prompt dismissing on a stray click is exactly the kind of thing that causes real mistakes), `Esc` always maps to Cancel, and focus is trapped inside the modal while open.

## 1. Confirmation Modal

```
┌───────────────────────────────────────┐
│                                         │
│   Restart the daemon?                  │
│   Open terminal sessions will end.     │
│                                         │
│                    [ Cancel ]  [ Restart ]│
└───────────────────────────────────────┘
```

Title: one line, plain statement of the action as a question ("Restart the daemon?" not "Are you sure?" — name the actual action, per the interface-voice conventions already used elsewhere in this project's specs). Body: one line, states the concrete consequence, not a vague warning — "Open terminal sessions will end," not "This action cannot be undone."

Two buttons, right-aligned, Cancel always first (left) and secondary-styled (`--bg-hover` fill, `--text-primary`), the affirmative action always second (right) and primary-styled. Affirmative button color depends on consequence level, reusing the same two tokens everywhere rather than a bespoke severity scale:
- **Destructive / irreversible** (Shut Down Aqua, Restart Daemon, Finder's "Move to Trash" on a non-recoverable path, deleting a custom wallpaper) → `--status-danger` fill.
- **Disruptive but not destructive** (Restart Aqua) → `--accent` fill — it's real friction, not data loss, so it doesn't need the danger treatment.

Keyboard: `Enter` activates the affirmative action **only** when it's the non-danger (`--accent`) variant; for danger-styled confirmations, `Enter` does nothing and the mouse (or an explicit Tab-to-button-then-Enter) is required — a blanket "Enter always confirms" pattern is exactly how people accidentally nuke something by hitting Enter out of habit from the previous dialog.

## 2. Elevation Modal (sudo)

```
┌───────────────────────────────────────┐
│   🔒                                    │
│   Finder wants to make changes         │
│   Changing permissions on              │
│   /etc/hosts requires your password.   │
│                                         │
│   User:      abdul                     │
│   Password:  [ ●●●●●●●●●●●●        ]   │
│                                         │
│                    [ Cancel ]  [ Authenticate ]│
└───────────────────────────────────────┘
```

Lock glyph, `--text-secondary`, top-left of the text block, small — this is the one modal in the OS with an icon, since "this is the elevation dialog" needs to be recognizable at a glance before reading a word of it. Title always follows the pattern "{Requesting app} wants to make changes" — never a generic "Authentication Required," naming the actual caller matches this project's existing "name the actual action" convention and makes it obvious this isn't a phishing-style fake prompt from something unexpected.

Body line names the *specific* operation that triggered elevation (path + op), not a generic "elevated privileges are required" — pulled straight from the `FsOp` that got a `needsElevation` response, so the person sees exactly what they're authorizing.

**User** field: read-only, pre-filled with the WSL user the daemon runs as — not editable, this isn't a multi-user login, it's confirming *who* is being elevated.

**Password** field: standard masked input, autofocus on open, `--bg-hover` fill, `--accent-ring` focus state. No password strength meter, no "show password" toggle — this is an authentication step, not an account-creation form.

Buttons: same Cancel/primary pattern as the Confirmation Modal. The affirmative button reads "Authenticate," styled `--accent` (not danger — entering a password isn't itself the destructive act; whatever operation gets retried after succeeds through its own normal path, this dialog just unlocks it).

**Wrong password:** the modal doesn't close. The panel does a short horizontal shake (~4 cycles, 240ms total — brief, not comedic), the password field clears, and a one-line message appears under the field in `--status-danger`: "Wrong password." No attempt counter, no lockout UI — the daemon can rate-limit server-side if it wants to, but the dialog itself doesn't nag about attempts.

**Security notes for whoever implements the daemon side of this** (also called out in the CONTRACT addendum, repeated here because it's a UI-affecting constraint): the password field's value is sent once, directly to `POST /api/system/elevate`, and nowhere else — it's never embedded back into a retried `FsOp` payload, never logged, and the field's local React state should be cleared immediately after the request fires (success or failure), not just on modal close.

## States

**Elevation in flight:** "Authenticate" button shows a small inline spinner in place of its label and disables both buttons — the password field itself stays visible (not blanked), since re-typing a password because the field vanished mid-submit is a bad experience.

**Daemon unreachable when either modal is about to fire:** don't open the modal at all — the triggering action should already be disabled/erroring per its own app's disconnected state (Finder's error banner, etc.) before it ever gets far enough to ask for confirmation or a password.
