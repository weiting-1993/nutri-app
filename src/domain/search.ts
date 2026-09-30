/** Lowercase, strip accents and punctuation, collapse whitespace. */
export function normalizeText(s: string): string {
  return s
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Light plural stripping so "eggs" matches "egg" and "tomatoes" matches "tomato". */
export function stem(token: string): string {
  if (token.length <= 3) return token;
  if (token.endsWith('ies')) return token.slice(0, -3);
  if (token.endsWith('oes')) return token.slice(0, -2);
  if (token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

/** Stemming is lossy for German ("Reis" -> "rei"), so callers use it only as a fallback. */
export function searchTokens(query: string, { stemmed = false, maxTokens = 6 } = {}): string[] {
  const tokens = normalizeText(query)
    .split(' ')
    .filter(Boolean)
    .map((t) => (stemmed ? stem(t) : t));
  return Array.from(new Set(tokens)).slice(0, maxTokens);
}

/** Escape LIKE wildcards; pair with `ESCAPE '\'`. */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export function wordCount(name: string): number {
  return normalizeText(name).split(' ').filter(Boolean).length;
}

/** Primary name for ranking, plus the name without spaces so "Haferflocken" matches "Hafer Flocken". */
export function nameIndex(name: string): string {
  const n = normalizeText(name);
  const compact = n.replace(/ /g, '');
  return compact === n ? n : `${n} ${compact}`;
}

export function searchIndex(name: string, altName = '', extra = ''): string {
  return [nameIndex(name), normalizeText(altName), normalizeText(extra)].filter(Boolean).join(' ');
}

const SEARCH_TABLES = { foods: true, custom_foods: true } as const;

/**
 * Parameterized search over a table with `name_norm`, `alt_norm`, `search` and `words` columns.
 * mode 'all' requires every token; 'any' requires at least one (fallback when 'all' finds nothing).
 * Per token on the primary name: whole word or plural 4, end of a compound word ("brötchen" in
 * "weizenbrötchen") 3, word prefix 1; whole word in the alternative name 2.
 * Ties go to names with fewer words (more generic foods), then shorter names.
 * `columns` and `table` must be compile-time constants, never user input.
 */
export function buildSearchQuery(
  tokens: string[],
  columns: string,
  table: keyof typeof SEARCH_TABLES,
  limit: number,
  mode: 'all' | 'any' = 'all',
): { sql: string; params: (string | number)[] } | null {
  if (!SEARCH_TABLES[table] || !/^[a-z0-9_, ]+$/i.test(columns)) throw new Error('invalid search target');
  if (tokens.length === 0) return null;
  const like = "LIKE ? ESCAPE '\\'";
  const name = "(' ' || name_norm || ' ')";
  const alt = "(' ' || alt_norm || ' ')";
  const score: string[] = [];
  const lead: string[] = [];
  const scoreParams: string[] = [];
  const leadParams: string[] = [];
  for (const t of tokens) {
    const e = escapeLike(t);
    // A token counts as a good match if it is a whole word, plural or compound head in the name,
    // or a whole word in the alternative name; a mere word prefix counts a little.
    score.push(
      `(CASE WHEN ${name} ${like} OR ${name} ${like} OR ${name} ${like} OR ${name} ${like}
          OR ${alt} ${like} OR ${alt} ${like} THEN 4 WHEN ${name} ${like} THEN 1 ELSE 0 END)`,
    );
    scoreParams.push(`% ${e} %`, `% ${e}s %`, `% ${e}es %`, `%${e} %`, `% ${e} %`, `% ${e}s %`, `% ${e}%`);
    // The food is named after the token (first word or first compound ends with it).
    // The trailing "% tok" case is the space-less form of a multi-word name ("hafer flocken haferflocken").
    lead.push(`(CASE WHEN name_norm ${like} OR name_norm ${like} OR name_norm ${like} THEN 1 ELSE 0 END)`);
    leadParams.push(`${e} %`, `${e}`, `% ${e}`);
  }
  const where = tokens.map(() => `search ${like}`).join(mode === 'all' ? ' AND ' : ' OR ');
  const sql = `SELECT ${columns}, (${score.join(' + ')}) AS score, (${lead.join(' + ')}) AS lead FROM ${table} WHERE ${where}
    ORDER BY score DESC, lead DESC, words, length(name) LIMIT ?`;
  const params = [
    ...scoreParams,
    ...leadParams,
    ...tokens.map((t) => `%${escapeLike(t)}%`),
    Math.max(1, Math.min(200, Math.floor(limit))),
  ];
  return { sql, params };
}
