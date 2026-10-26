import * as React from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// the component is compiled with the classic JSX runtime under Vitest
(globalThis as unknown as { React: typeof React }).React = React;

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ show: vi.fn() }) }));

const { UploadCsvButton } = await import('@/components/DashboardActions');

describe('UploadCsvButton', () => {
  const html = renderToStaticMarkup(createElement(UploadCsvButton));

  it('shows a button labelled Upload CSV', () => {
    expect(html).toContain('Upload CSV');
  });

  it('has a hidden file input that takes csv or text and is named for screen readers', () => {
    expect(html).toContain('type="file"');
    expect(html).toContain('accept=".csv,text/csv,text/plain"');
    expect(html).toContain('aria-label="Upload a CSV of private tournament URLs"');
    expect(html).toContain('sr-only');
  });
});
