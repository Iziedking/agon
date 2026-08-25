import { Suspense } from "react";
import { CliAuthorizeClient } from "./CliAuthorizeClient";

export const metadata = {
  title: "Authorize CLI | Agon",
  description: "Approve a short-lived Agon CLI session from your signed-in browser.",
};

export default function CliAuthorizePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-canvas" />}>
      <CliAuthorizeClient />
    </Suspense>
  );
}
