export type ThemePreference = "auto" | "light" | "dark";

export const DEFAULT_THEME_PREFERENCE: ThemePreference = "dark";

export function normalizeThemePreference(value: string | null | undefined): ThemePreference {
  return value === "light" || value === "dark" || value === "auto" ? value : DEFAULT_THEME_PREFERENCE;
}

export function isDarkTheme(preference: ThemePreference, systemPrefersDark: boolean): boolean {
  return preference === "dark" || (preference === "auto" && systemPrefersDark);
}

export function nextThemePreference(preference: ThemePreference): ThemePreference {
  if (preference === "auto") return "dark";
  if (preference === "dark") return "light";
  return "auto";
}
