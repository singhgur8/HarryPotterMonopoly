// Light / dark switch for the landing page, lobby and game header. Light is the
// default; the choice is remembered per browser and applied before the first
// render (applySavedTheme in main.tsx) so the page never flashes the wrong theme.
import { useState } from "react";
import { Moon, Sun } from "lucide-react";

type Theme = "light" | "dark";
const THEME_KEY = "hp-theme";
const BAR = { light: "#ffffff", dark: "#222733" } as const;

function readTheme(): Theme {
  try { return localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light"; } catch { return "light"; }
}

function apply(t: Theme) {
  const root = document.documentElement;
  root.dataset.theme = t;
  root.classList.toggle("dark", t === "dark");
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.appendChild(meta);
  }
  meta.content = BAR[t];
}

export function applySavedTheme() {
  apply(readTheme());
}

export function ThemeToggle({ className = "" }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>(readTheme);
  const dark = theme === "dark";
  const toggle = () => {
    const next: Theme = dark ? "light" : "dark";
    try { localStorage.setItem(THEME_KEY, next); } catch { /* storage blocked */ }
    apply(next);
    setTheme(next);
  };
  return (
    <button
      className={`hp-btn ghost hp-theme ${className}`}
      onClick={toggle}
      aria-pressed={dark}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
      data-testid="button-theme"
    >
      {dark ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
    </button>
  );
}
