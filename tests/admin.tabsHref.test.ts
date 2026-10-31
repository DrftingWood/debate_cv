import { describe, expect, it } from 'vitest';
import { switchTabHref, TAB_SCOPED_PARAMS } from '@/lib/admin/adminTabs';

describe('switchTabHref', () => {
  it.each(TAB_SCOPED_PARAMS)('drops %s when switching tab', (param) => {
    expect(switchTabHref(`tab=tournaments&${param}=3`, 'reports')).toBe('/admin?tab=reports');
  });

  it('drops all five at once and keeps the rest', () => {
    const search =
      'tab=tournaments&q=oxford&page=2&reportsPage=3&reportsStatus=open&warningsPage=4&band=check&check=teams';
    expect(switchTabHref(search, 'parser')).toBe('/admin?tab=parser&band=check&check=teams');
  });

  it('leaves the plain address for the Inbox', () => {
    expect(switchTabHref('tab=imports&page=2', 'inbox')).toBe('/admin');
    expect(switchTabHref('tab=imports&band=good', 'inbox')).toBe('/admin?band=good');
  });
});
