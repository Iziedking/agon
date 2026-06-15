import { redirect } from "next/navigation";

/// The old standalone bridge page is gone: top up and withdraw now live in the
/// dashboard Funds section. Keep this route as a redirect so any existing link
/// or bookmark lands in the right place.
export default function BridgeRedirect() {
  redirect("/dashboard");
}
