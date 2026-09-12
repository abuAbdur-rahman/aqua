import { useCallback, useEffect, useRef, useState } from "react";
import { relaunch } from "@tauri-apps/plugin-process";

type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "uptodate" }
  | { kind: "available"; version: string; body?: string }
  | { kind: "downloading"; percent: number | null }
  | { kind: "installing" }
  | { kind: "error"; message: string };

// Download progress bytes are streamed per chunk with no total length, so a
// determinate bar is only shown when the server sends contentLength.
function useUpdateController() {
  const [state, setState] = useState<UpdateState>({ kind: "idle" });
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const inFlight = useRef(false);
  const updateRef = useRef<import("@tauri-apps/plugin-updater").Update | null>(null);

  useEffect(() => {
    let cancelled = false;
    void import("@tauri-apps/api/app")
      .then(({ getVersion }) => getVersion())
      .then((version) => {
        if (!cancelled) setCurrentVersion(version);
      })
      .catch(() => {
        if (!cancelled) setCurrentVersion(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const check = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setState({ kind: "checking" });
    try {
      if (!("__TAURI_INTERNALS__" in window)) {
        setState({ kind: "error", message: "Updates are available in the installed desktop app." });
        return;
      }
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      updateRef.current = update;
      setState(
        update
          ? { kind: "available", version: update.version, body: update.body }
          : { kind: "uptodate" },
      );
    } catch (cause: unknown) {
      setState({
        kind: "error",
        message: cause instanceof Error ? cause.message : "Couldn't check for updates.",
      });
    } finally {
      inFlight.current = false;
    }
  }, []);

  const downloadAndInstall = useCallback(async () => {
    if (inFlight.current) return;
    const update = updateRef.current;
    if (!update) {
      void check();
      return;
    }
    inFlight.current = true;
    setState({ kind: "downloading", percent: null });
    let downloaded = 0;
    let total: number | null = null;
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? null;
          downloaded = 0;
          setState({ kind: "downloading", percent: null });
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          const percent =
            total && total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : null;
          setState({ kind: "downloading", percent });
        } else {
          setState({ kind: "installing" });
        }
      });
      // Windows exits the app to run the installer; on other platforms the
      // installer needs an explicit relaunch to start the new build.
      setState({ kind: "installing" });
      try {
        await relaunch();
      } catch {
        // relaunch not permitted / app already exiting — the update is done.
      }
    } catch (cause: unknown) {
      setState({
        kind: "error",
        message:
          cause instanceof Error ? cause.message : "The update couldn't be installed.",
      });
    } finally {
      inFlight.current = false;
    }
  }, [check]);

  return { state, currentVersion, check, downloadAndInstall };
}

export function UpdatePane() {
  const { state, currentVersion, check, downloadAndInstall } = useUpdateController();

  const renderBody = () => {
    switch (state.kind) {
      case "checking":
        return (
          <p className="flex items-center gap-2 text-xs text-text-secondary" aria-live="polite">
            <span className="h-3 w-3 animate-spin rounded-full border border-text-tertiary border-t-transparent" aria-hidden="true" />
            Checking for updates…
          </p>
        );
      case "idle":
        return (
          <button
            onClick={() => void check()}
            className="rounded-card bg-accent px-3 py-1.5 text-xs font-medium text-bg-base hover:bg-accent-strong focus-visible:outline-2 focus-visible:outline-accent"
          >
            Check for Updates
          </button>
        );
      case "uptodate":
        return (
          <div className="space-y-3" role="status">
            <p className="text-xs text-text-primary">Aqua is up to date.</p>
            <button
              onClick={() => void check()}
              className="rounded-card bg-bg-hover px-3 py-1.5 text-xs font-medium text-text-primary hover:bg-bg-hover/70 focus-visible:outline-2 focus-visible:outline-accent"
            >
              Check Again
            </button>
          </div>
        );
      case "available":
        return (
          <div className="space-y-3">
            <p className="text-xs text-text-primary" role="status">
              Version {state.version} is available.
            </p>
            {state.body && (
              <p className="max-w-sm whitespace-pre-wrap text-[11px] leading-relaxed text-text-secondary">
                {state.body}
              </p>
            )}
            <button
              onClick={() => void downloadAndInstall()}
              className="rounded-card bg-accent px-3 py-1.5 text-xs font-medium text-bg-base hover:bg-accent-strong focus-visible:outline-2 focus-visible:outline-accent"
            >
              Download &amp; Install
            </button>
          </div>
        );
      case "downloading":
        return (
          <div className="max-w-sm space-y-2" role="status" aria-live="polite">
            <p className="text-xs text-text-primary">Downloading update…</p>
            {state.percent !== null ? (
              <div className="h-1.5 overflow-hidden rounded-full bg-bg-hover" aria-hidden="true">
                <div className="h-full rounded-full bg-accent transition-[width] duration-150" style={{ width: `${state.percent}%` }} />
              </div>
            ) : (
              <div className="h-1.5 animate-pulse rounded-full bg-bg-hover/70" aria-hidden="true" />
            )}
            {state.percent !== null && (
              <p className="text-[11px] tabular-nums text-text-tertiary">{state.percent}%</p>
            )}
          </div>
        );
      case "installing":
        return (
          <p className="text-xs text-text-primary" role="status" aria-live="polite">
            Installing — Aqua will restart…
          </p>
        );
      case "error":
        return (
          <div className="space-y-3" role="alert">
            <p className="max-w-sm text-xs leading-relaxed text-status-danger">{state.message}</p>
            <button
              onClick={() => void check()}
              className="rounded-card bg-bg-hover px-3 py-1.5 text-xs font-medium text-text-primary hover:bg-bg-hover/70 focus-visible:outline-2 focus-visible:outline-accent"
            >
              Try Again
            </button>
          </div>
        );
    }
  };

  return (
    <section aria-label="Updates" className="max-w-md">
      <h2 className="text-sm font-semibold text-text-primary">Software Update</h2>
      <p className="mt-1 text-xs leading-relaxed text-text-secondary">
        Aqua checks GitHub Releases for new versions. The daemon is updated
        separately inside WSL and isn&rsquo;t covered here.
      </p>

      <dl className="mt-4 space-y-2 text-xs">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-text-secondary">Current version</dt>
          <dd className="tabular-nums text-text-primary">{currentVersion ?? "—"}</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-text-secondary">Channel</dt>
          <dd className="text-text-primary">Stable</dd>
        </div>
      </dl>

      <div className="mt-5">{renderBody()}</div>
    </section>
  );
}
