/// Inline script that applies the saved theme before the page renders.
/// Without this the page hydrates in light first and then flips to dark on
/// mount, which produces a visible flash. Reads the same localStorage key
/// the SettingRow / setSetting helpers use ("arcrun:setting:theme") and
/// adds the `dark` class to <html> when value === "dark".
///
/// next/script with strategy="beforeInteractive" doesn't run early enough
/// to dodge the flash. Inlining the script straight into <head> via
/// dangerouslySetInnerHTML is the standard recipe for FOUC-free theme.

const SCRIPT = `
(function () {
  try {
    var stored = window.localStorage.getItem("arcrun:setting:theme");
    if (stored === "dark") {
      document.documentElement.classList.add("dark");
    }
  } catch (e) { /* localStorage disabled, default to light */ }
})();
`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />;
}
