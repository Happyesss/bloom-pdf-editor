'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/app/theme/ThemeProvider';
import { cn } from '@/lib/utils';

/** Same control as the bloompdf.app header. */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';
  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={cn(
        'w-9 h-9 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors relative shrink-0',
        className,
      )}
      aria-label="Toggle theme"
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      <Sun className={cn('h-[18px] w-[18px] transition-transform duration-150', isDark ? '-rotate-90 scale-0 opacity-0' : 'rotate-0 scale-100 opacity-100')} />
      <Moon className={cn('absolute h-[18px] w-[18px] transition-transform duration-150', isDark ? 'rotate-0 scale-100 opacity-100' : 'rotate-90 scale-0 opacity-0')} />
    </button>
  );
}
