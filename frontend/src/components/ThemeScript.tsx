/// Inline script that applies the saved theme before the page renders.
/// Without this the page hydrates in light first and then flips to dark on
/// mount, which produces a visible flash. Reads the same localStorage key
/// the SettingRow / setSetting helpers use ("arcrun:setting:theme") and
/// adds or removes the `dark` class before the page paints. The default is
/// dark; daylight is an explicit user choice that follows the browser's
/// day/night preference.
///
/// next/script with strategy="beforeInteractive" doesn't run early enough
/// to dodge the flash. Inlining the script straight into <head> via
/// dangerouslySetInnerHTML is the standard recipe for FOUC-free theme.

const SCRIPT = `
(function () {
  try {
    var stored = window.localStorage.getItem("arcrun:setting:theme");
    var preference = stored === "light" || stored === "dark" || stored === "auto" ? stored : "dark";
    var systemPrefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    var dark = preference === "dark" || (preference === "auto" && systemPrefersDark);
    document.documentElement.classList.toggle("dark", !!dark);
  } catch (e) {
    document.documentElement.classList.remove("dark");
  }
})();
`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />;
}
