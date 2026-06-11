import { beforeEach, describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';

vi.mock('@/lib/auth', () => import('../setup/api-test-utils').then((m) => m.authMockModule));
// buildCvData is mocked at the module boundary instead of mocking prisma:
// the builder issues a deep query cascade that's already covered by its own
// tests, and this route only cares about the shape it returns.
vi.mock('@/lib/cv/buildCvData', () => ({ buildCvData: vi.fn() }));

import { GET } from '@/app/api/cv/export/route';
import { buildCvData } from '@/lib/cv/buildCvData';
import { authMock, fakeSession, expectUnauthorized } from '../setup/api-test-utils';
import { makeCvData, makeSpeakerRow, makeJudgeRow } from '../setup/cv-fixtures';

const buildCvDataMock = vi.mocked(buildCvData);

function get(query = ''): Promise<Response> {
  return GET(new Request(`http://test/api/cv/export${query}`));
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue(fakeSession('user-1'));
  buildCvDataMock.mockResolvedValue(
    makeCvData({
      speakerRows: [
        makeSpeakerRow({ tournamentName: 'Mumbai Open', year: 2025, speakerAvgScore: '77.5' }),
      ],
      judgeRows: [makeJudgeRow({ tournamentName: 'Delhi IV', judgeTypeTag: 'core' })],
    }),
  );
});

describe('GET /api/cv/export', () => {
  it('returns 401 when unauthenticated', async () => {
    await expectUnauthorized(() => get());
  });

  it('rejects an unsupported format', async () => {
    const res = await get('?format=pdf');
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('bad_request');
  });

  it('rejects unknown field ids and names them', async () => {
    const res = await get('?fields=tournament,nope');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; unknownFields: string[] };
    expect(body.error).toBe('bad_request');
    expect(body.unknownFields).toEqual(['nope']);
  });

  it('bare GET keeps the legacy CSV shape', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toContain('.csv');
    const lines = (await res.text()).trimEnd().split('\n');
    expect(lines[0].startsWith('section,tournament,year,format,teams,my_name,')).toBe(true);
    expect(lines[0].endsWith('last_outround_chaired,last_outround_judged')).toBe(true);
    expect(lines).toHaveLength(3); // header + 1 speaker + 1 judge
  });

  it('narrows CSV columns to the selected fields', async () => {
    const res = await get('?fields=tournament,speaker_average');
    expect(res.status).toBe(200);
    const lines = (await res.text()).trimEnd().split('\n');
    expect(lines[0]).toBe('section,tournament,speaker_average');
    expect(lines[1]).toBe('speaker,Mumbai Open,77.5');
    expect(lines[2]).toBe('judge,Delhi IV,');
  });

  it('produces a readable XLSX workbook with one sheet per role', async () => {
    const res = await get('?format=xlsx');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(res.headers.get('content-disposition')).toContain('.xlsx');

    const workbook = new ExcelJS.Workbook();
    // exceljs ships its own (older) Buffer typing that predates Node 20's
    // generic Buffer<ArrayBuffer>; the runtime value is fine, only the
    // nominal types disagree.
    const bytes = Buffer.from(await res.arrayBuffer());
    await workbook.xlsx.load(bytes as unknown as Parameters<ExcelJS.Xlsx['load']>[0]);
    expect(workbook.worksheets.map((w) => w.name)).toEqual(['Speaking', 'Judging']);
    const speaking = workbook.getWorksheet('Speaking')!;
    expect(speaking.getCell('A1').value).toBe('Tournament');
    expect(speaking.getCell('A2').value).toBe('Mumbai Open');
    const judging = workbook.getWorksheet('Judging')!;
    expect(judging.getCell('A2').value).toBe('Delhi IV');
  });
});
