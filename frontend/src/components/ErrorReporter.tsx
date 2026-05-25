"use client";

import { useEffect } from "react";
import { reportEvent } from "@/lib/report";

/// Mounts once and reports uncaught client errors and unhandled promise
/// rejections to the backend activity log.
export function ErrorReporter() {
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
