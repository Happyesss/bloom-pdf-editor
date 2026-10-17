'use client';

import React, { createContext, useCallback, useContext, useEffect, useSyncExternalStore } from 'react';

export type ThemeMode = 'dark' | 'light';

/** Same key next-themes uses on bloompdf.app, so the preference reads the same way. */
const STORAGE_KEY = 'theme';

/**
 * Runs before first paint (see layout.tsx) so the page never flashes the wrong
 * theme. Mirrors next-themes' "system" default used by the main site.
 */
export const themeInitScript = `(function(){try{var t=localStorage.getItem('${STORAGE_KEY}');var d=t==='dark'||((t===null||t==='system')&&window.matchMedia('(prefers-color-scheme: dark)').matches);var r=document.documentElement;r.classList.toggle('dark',d);r.style.colorScheme=d?'dark':'light';}catch(e){}})();`;

interface ThemeContextValue {
  theme: ThemeMode;
  setTheme: (mode: ThemeMode) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'light',
  setTheme: () => {},
  toggleTheme: () => {},
});

function applyTheme(mode: ThemeMode) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  // Suppress transitions for one frame so every surface swaps at once.
  const css = document.createElement('style');
  css.textContent = '*,*::before,*::after{transition:none!important}';
  document.head.appendChild(css);
  root.classList.toggle('dark', mode === 'dark');
  root.style.colorScheme = mode;
  void window.getComputedStyle(root).opacity;
  requestAnimationFrame(() => requestAnimationFrame(() => css.remove()));
}

// The `dark` class on <html> is the source of truth (the init script sets it
// before React loads), so read it as an external store.
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
}
const getSnapshot = (): ThemeMode => (document.documentElement.classList.contains('dark') ? 'dark' : 'light');
const getServerSnapshot = (): ThemeMode => 'light';

function storedTheme(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // With no saved choice, keep following the operating-system setting.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      const saved = storedTheme();
      if (saved === 'dark' || saved === 'light') return;
      applyTheme(mq.matches ? 'dark' : 'light');
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const setTheme = useCallback((mode: ThemeMode) => {
    applyTheme(mode);
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      /* ignore */
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(getSnapshot() === 'dark' ? 'light' : 'dark');
  }, [setTheme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
