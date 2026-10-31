import { describe, expect, it } from 'vitest';
import { csvCell, csvLine } from '@/lib/utils/csv';

// The shared CSV formatter: quoting only where needed, and a typed cell that
// a spreadsheet would run as a formula is kept as text (OWASP CSV injection).

describe('csvCell', () => {
  it('quotes only a cell with a comma, quote or line break', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a, b')).toBe('"a, b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  it('prefixes a quote to a cell a spreadsheet would read as a formula', () => {
    expect(csvCell('=HYPERLINK("http://x","y")')).toBe(`"'=HYPERLINK(""http://x"",""y"")"`);
    expect(csvCell('+1+1')).toBe("'+1+1");
    expect(csvCell('-2+3')).toBe("'-2+3");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('\tcmd')).toBe("'\tcmd");
    expect(csvCell('\rcmd')).toBe(`"'\rcmd"`);
  });

  it('leaves a number alone, and text that only contains those characters later', () => {
    expect(csvCell(-3)).toBe('-3');
    expect(csvCell(5n)).toBe('5');
    expect(csvCell('+4.4')).toBe('+4.4');
    expect(csvCell('-12')).toBe('-12');
    expect(csvCell('a=b')).toBe('a=b');
    expect(csvLine(['x', '=1', 2])).toBe("x,'=1,2");
  });
});
