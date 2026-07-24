const JOB_DATE_RE =
  /\s+((?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{4}\s*[-–—]\s*(?:Present|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{4}))\s*$/i;

export function splitTitleAndDate(text: string): { title: string; date: string } | null {
  const m = text.match(JOB_DATE_RE);
  if (!m || m.index == null) return null;
  const title = text.slice(0, m.index).trim();
  const date = m[1]!.trim();
  if (title.length < 3 || date.length < 8) return null;
  return { title, date };
}

export function looksLikeContactLine(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/@/.test(t) && /\|/.test(t)) return true;
  if (/\+?\d[\d\s-]{8,}\d/.test(t) && /@/.test(t)) return true;
  if (/linkedin\.com/i.test(t)) return true;
  return false;
}

/** "Extra-Curricular Activities: Hosted … • Represented …" */
export function splitLabelWithInlineBullets(text: string): { label: string; items: string[] } | null {
  const m = text.trim().match(/^([A-Z][^:\n]{1,40}:)\s*(.+)$/);
  if (!m) return null;
  const label = m[1]!.trim();
  const rest = m[2]!.trim();
  if (!/Extra-Curricular|Activities|Personal Achievements|Achievements|Technical Skills|Skills|Competencies/i.test(label)) return null;
  if (!/[•·]/.test(rest) && !/\.\s+[A-Z]/.test(rest)) {
    // Single prose blob after label — still split label / body as one item
    if (rest.length < 20) return null;
    return { label, items: [rest] };
  }
  const items = rest
    .split(/\s*[•·]\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  // Also split on ". Capital" if no bullets
  if (items.length <= 1 && /\.\s+[A-Z]/.test(rest)) {
    const parts = rest.split(/(?<=\.)\s+(?=[A-Z])/).map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 2) return { label, items: parts };
  }
  if (items.length < 1) return null;
  return { label, items };
}

export function isEducationHeaderRow(text: string): boolean {
  const t = text.trim();
  // Soft-wrap may cut "Remarks" onto the next line — Institution/ is enough.
  return (
    /\bCourse\b/i.test(t) &&
    /\bYear\b/i.test(t) &&
    /\b(Institution|Board|Remarks)\b/i.test(t)
  );
}

export function isSectionTitleLine(text: string): boolean {
  const t = text.trim();
  if (t.length < 8 || t.length > 48) return false;
  if (!/[A-Z]{3,}/.test(t)) return false;
  // Mostly uppercase words (allow & / -)
  const letters = t.replace(/[^A-Za-z]/g, '');
  if (letters.length < 6) return false;
  const upper = letters.replace(/[^A-Z]/g, '').length;
  return upper / letters.length >= 0.85;
}

export function looksLikeEducationDataRow(text: string): boolean {
  const t = text.trim();
  if (t.length < 12 || t.length > 220) return false;
  if (/PROFESSIONAL|COMPETENC|EDUCATION/i.test(t) && t === t.toUpperCase()) return false;
  return /^(CA\b|B\.?Com|Class\s+[XIV\d]|Bachelor|Master|MBA|Diploma)/i.test(t);
}

export function parseEducationRow(text: string): [string, string, string, string] {
  const t = text.trim();
  const yearRe =
    /((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4}|\d{4}\s*[-–]\s*\d{4}|March\s+\d{4})/i;
  const ym = t.match(yearRe);
  if (!ym || ym.index == null) return [t, '', '', ''];
  const course = t.slice(0, ym.index).trim();
  const year = ym[1]!;
  const rest = t.slice(ym.index + year.length).trim();
  if (!course || !rest) return [course || t, year, rest, ''];

  // "Delhi University Distinction…"
  const uni = rest.match(/^(.+?\bUniversity)\s+(.+)$/i);
  if (uni) return [course, year, uni[1]!.trim(), uni[2]!.trim()];

  // ICAI / CBSE / ICSE + remarks
  const board = rest.match(/^(ICAI|CBSE|ICSE)\s+(.+)$/i);
  if (board) return [course, year, board[1]!, board[2]!.trim()];

  // Remarks often start with these verbs/nouns
  const remark = rest.match(/^(.*?)\s+((?:Scored|Group|Cleared|Distinction|Awarded|Passed|Rank)\b.*)$/i);
  if (remark && remark[1]!.trim().length > 0) {
    return [course, year, remark[1]!.trim(), remark[2]!.trim()];
  }

  const parts = rest.split(/\s+/);
  if (parts.length <= 2) return [course, year, rest, ''];
  return [course, year, parts[0]!, parts.slice(1).join(' ')];
}
