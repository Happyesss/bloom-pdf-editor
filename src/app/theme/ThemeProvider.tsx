'use client';

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

export type ThemeMode = 'dark' | 'light';

const STORAGE_KEY = 'pdf-editor-theme';

interface ThemeContextValue {
  theme: ThemeMode;
  setTheme: (mode: ThemeMode) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'dark',
  setTheme: () => {},
  toggleTheme: () => {},
});

function applyTheme(mode: ThemeMode) {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', mode);
  document.documentElement.style.colorScheme = mode;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>('dark');

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY) as ThemeMode | null;
      const initial = stored === 'light' || stored === 'dark' ? stored : 'dark';
      setThemeState(initial);
      applyTheme(initial);
    } catch {
      applyTheme('dark');
    }
  }, []);

  const setTheme = useCallback((mode: ThemeMode) => {
    setThemeState(mode);
    applyTheme(mode);
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      /* ignore */
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setTheme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
