import { describe, expect, it } from 'vitest';
import { switchTabHref, TAB_SCOPED_PARAMS } from '@/lib/admin/adminTabs';

describe('switchTabHref', () => {
  it.each(TAB_SCOPED_PARAMS)('drops %s when switching tab', (param) => {
    expect(switchTabHref(`tab=tournaments&${param}=3`, 'reports')).toBe('/admin?tab=reports');
  });

  it('drops every tab-scoped parameter at once and keeps the rest', () => {
    const scoped = TAB_SCOPED_PARAMS.map((p) => p + '=2').join('&');
    const search = 'tab=tournaments&' + scoped + '&band=check&check=teams';
    expect(switchTabHref(search, 'parser')).toBe('/admin?tab=parser&band=check&check=teams');
  });

  it('treats the Imports, Parser and Review set view and page parameters as tab-scoped', () => {
    for (const p of ['imports', 'importsPage', 'parser', 'warningsPage', 'review', 'reviewPage']) {
      expect(TAB_SCOPED_PARAMS).toContain(p);
    }
  });

  it('leaves the plain address for the Inbox', () => {
    expect(switchTabHref('tab=imports&page=2', 'inbox')).toBe('/admin');
    expect(switchTabHref('tab=imports&band=good', 'inbox')).toBe('/admin?band=good');
  });
});
