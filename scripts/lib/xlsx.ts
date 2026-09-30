import { execFileSync } from 'node:child_process';

/**
 * Minimal reader for the first worksheet of a trusted .xlsx file (shared strings + inline numbers).
 * Build-time only; avoids pulling a spreadsheet dependency into the project.
 */
export function readFirstSheet(xlsxPath: string): string[][] {
  const unzip = (entry: string) =>
    execFileSync('unzip', ['-p', xlsxPath, entry], { maxBuffer: 512 * 1024 * 1024 }).toString('utf8');

  const decode = (s: string) =>
    s
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
      .replace(/&amp;/g, '&');

  const shared: string[] = [];
  const sst = unzip('xl/sharedStrings.xml');
  for (const si of sst.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    const parts = [...si[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1]));
    shared.push(parts.join(''));
  }

  const colIndex = (ref: string) => {
    const letters = /^[A-Z]+/.exec(ref)![0];
    let n = 0;
    for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  };

  const rows: string[][] = [];
  const sheet = unzip('xl/worksheets/sheet1.xml');
  for (const row of sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const c of row[1].matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const [, ref, attrs, inner] = c;
      if (!inner) continue;
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      const t = /t="(\w+)"/.exec(attrs)?.[1];
      let value = '';
      if (t === 's' && v !== undefined) value = shared[Number(v)] ?? '';
      else if (t === 'inlineStr') value = decode(/<t[^>]*>([\s\S]*?)<\/t>/.exec(inner)?.[1] ?? '');
      else if (v !== undefined) value = decode(v);
      cells[colIndex(ref)] = value;
    }
    rows.push(Array.from(cells, (x) => x ?? ''));
  }
  return rows;
}
