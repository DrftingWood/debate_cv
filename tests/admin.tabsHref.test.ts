import { describe, expect, it } from 'vitest';
import { ADMIN_TABS, switchTabHref, TAB_SCOPED_PARAMS } from '@/lib/admin/adminTabs';

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

  it('puts Captured straight after Tournaments and moves to it keeping the chips', () => {
    expect(ADMIN_TABS.map((t) => t.value).slice(0, 3)).toEqual([
      'inbox',
      'tournaments',
      'captured',
    ]);
    expect(ADMIN_TABS[2]!.label).toBe('Captured');
    expect(switchTabHref('tab=tournaments&page=3&check=core_missing', 'captured')).toBe(
      '/admin?tab=captured&check=core_missing',
    );
  });

  it('leaves the plain address for the Inbox', () => {
    expect(switchTabHref('tab=imports&page=2', 'inbox')).toBe('/admin');
    expect(switchTabHref('tab=imports&band=good', 'inbox')).toBe('/admin?band=good');
  });
});
