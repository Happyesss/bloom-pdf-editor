import type { TextScript, WritingDir } from './types.js';

export interface LanguageGuess {
  primary?: string;
  secondary: string[];
  script: TextScript;
  writingDirection: WritingDir;
  confidence: number;
}

/** Lightweight script / language heuristics from recovered text. */
export function detectLanguage(texts: string[]): LanguageGuess {
  const sample = texts.join(' ').slice(0, 4000);
  if (!sample.trim()) {
    return {
      secondary: [],
      script: 'unknown',
      writingDirection: 'ltr',
      confidence: 0.3,
    };
  }

  const cjk = (sample.match(/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/g) ?? []).join('').length;
  const arabic = (sample.match(/[\u0600-\u06ff]/g) ?? []).join('').length;
  const hindi = (sample.match(/[\u0900-\u097f]/g) ?? []).join('').length;
  const latin = (sample.match(/[A-Za-z]/g) ?? []).join('').length;
  const math = (sample.match(/[∑∫√∞≈≠±×÷]/g) ?? []).join('').length;

  let script: TextScript = 'latin';
  let primary = 'en';
  let writingDirection: WritingDir = 'ltr';
  const secondary: string[] = [];

  const scores = [
    { script: 'cjk' as const, n: cjk, lang: 'zh' },
    { script: 'arabic' as const, n: arabic, lang: 'ar' },
    { script: 'devanagari' as const, n: hindi, lang: 'hi' },
    { script: 'latin' as const, n: latin, lang: 'en' },
    { script: 'math' as const, n: math, lang: 'und' },
  ].sort((a, b) => b.n - a.n);

  if (scores[0] && scores[0].n > 0) {
    script = scores[0].script;
    primary = scores[0].lang;
    if (script === 'arabic') writingDirection = 'rtl';
  }

  for (const s of scores.slice(1, 3)) {
    if (s.n > 5 && s.lang !== primary) secondary.push(s.lang);
  }

  return {
    primary,
    secondary,
    script,
    writingDirection,
    confidence: Math.min(0.95, 0.4 + (scores[0]?.n ?? 0) / 100),
  };
}
