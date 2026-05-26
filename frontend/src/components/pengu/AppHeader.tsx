import { ArcLogo } from "@/components/pengu/ArcLogo";
import { LoginButton } from "@/components/pengu/LoginButton";
import { ProfileLink } from "@/components/pengu/ProfileLink";

/// The app navbar (home page and inner surfaces). Logo, route links, and a
/// single LOGIN entry that opens the two-method login popout (wallet or email).
export function AppHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-pengu-blue/15 bg-pengu-card">
      <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-6">
        <a href="/" className="flex items-center gap-2 font-bubble text-2xl uppercase text-pengu-blue">
          <ArcLogo className="h-7 w-7" />
          arcrun
        </a>
        <nav className="hidden items-center gap-2 md:flex">
          <a
            href="/dashboard"
            className="rounded-pill px-4 py-1.5 font-display text-xs uppercase tracking-wide text-pengu-blue2 hover:text-pengu-dark"
          >
            dashboard
          </a>
          <a
            href="/contests"
            className="rounded-pill px-4 py-1.5 font-display text-xs uppercase tracking-wide text-pengu-blue2 hover:text-pengu-dark"
          >
            contests
          </a>
          <a
            href="/challenges"
            className="rounded-pill px-4 py-1.5 font-display text-xs uppercase tracking-wide text-pengu-blue2 hover:text-pengu-dark"
          >
            challenges
          </a>
          <a
            href="/live"
            className="rounded-pill px-4 py-1.5 font-display text-xs uppercase tracking-wide text-pengu-blue2 hover:text-pengu-dark"
          >
            live
          </a>
          <a
            href="/leaderboard"
            className="rounded-pill px-4 py-1.5 font-display text-xs uppercase tracking-wide text-pengu-blue2 hover:text-pengu-dark"
          >
            leaderboard
          </a>
          <a
            href="/syndicates"
            className="rounded-pill px-4 py-1.5 font-display text-xs uppercase tracking-wide text-pengu-blue2 hover:text-pengu-dark"
          >
            syndicates
          </a>
          <ProfileLink />
        </nav>
        <LoginButton />
      </div>
    </header>
  );
}
