import { AgonLandingPage } from "@/components/AgonLandingPage";

/**
 * The canonical root of the repository is always Agon.
 *
 * Legacy ArcRun remains available only through its explicit compatibility
 * routes. Keeping the root route free of an ArcRun fallback prevents a
 * missing or stale environment variable from changing the product identity.
 */
export default function Home() {
  return <AgonLandingPage />;
}
