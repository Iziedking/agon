"use client";

import { useEffect } from "react";
import { reportEvent } from "@/lib/report";

/// Mounts once and reports uncaught client errors and unhandled promise
/// rejections to the backend activity log.
export function ErrorReporter() {
  // Security hygiene: an earlier build briefly held the admin console token in
  // localStorage. The current build keeps it in memory only (per-tab), but a
  // stale `arcrun_admin_token` can still linger in any browser that used the old
  // page, where a script on the domain could read it. Purge it on every load.
  useEffect(() => {
    try {
      localStorage.removeItem("arcrun_admin_token");
    } catch {
      /* localStorage unavailable (e.g. private mode); nothing to purge */
    }
  }, []);

  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      reportEvent("client_error", {
        level: "error",
        message: e.message,
        context: { src: e.filename, line: e.lineno, col: e.colno },
      });
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const reason = e.reason;
      reportEvent("client_unhandled_rejection", {
        level: "error",
        message: reason instanceof Error ? reason.message : String(reason),
      });
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
