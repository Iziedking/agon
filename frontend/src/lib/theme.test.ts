import test from "node:test";
import assert from "node:assert/strict";

import { isDarkTheme, nextThemePreference, normalizeThemePreference } from "./theme.ts";

test("unknown or missing preferences default to dark", () => {
  assert.equal(normalizeThemePreference(null), "dark");
  assert.equal(normalizeThemePreference("legacy-dark"), "dark");
});

test("daylight follows the system while explicit modes win", () => {
  assert.equal(isDarkTheme("auto", false), false);
  assert.equal(isDarkTheme("auto", true), true);
  assert.equal(isDarkTheme("light", true), false);
  assert.equal(isDarkTheme("dark", false), true);
});

test("the compact theme control cycles dark, light, daylight", () => {
  assert.equal(nextThemePreference("auto"), "dark");
  assert.equal(nextThemePreference("dark"), "light");
  assert.equal(nextThemePreference("light"), "auto");
});
