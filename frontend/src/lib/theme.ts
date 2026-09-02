export type ThemePreference = "auto" | "light" | "dark";

export function normalizeThemePreference(value: string | null | undefined): ThemePreference {
  return value === "light" || value === "dark" || value === "auto" ? value : "auto";
}

export function isDarkTheme(preference: ThemePreference, systemPrefersDark: boolean): boolean {
  return preference === "dark" || (preference === "auto" && systemPrefersDark);
}

export function nextThemePreference(preference: ThemePreference): ThemePreference {
  if (preference === "auto") return "dark";
  if (preference === "dark") return "light";
  return "auto";
}
