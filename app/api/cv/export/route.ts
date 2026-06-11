import { NextResponse } from 'next/server';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import { auth } from '@/lib/auth';
import { buildCvData } from '@/lib/cv/buildCvData';
import {
  buildExportCsv,
  buildExportSheets,
  resolveExportFields,
} from '@/lib/cv/exportFields';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/cv/export?format=csv|xlsx&fields=tournament,year,...
//
// Query params instead of a POST body because the export is triggered as a
// plain navigation (anchor click from the picker) so the browser handles
// the Content-Disposition download natively — no blob/objectURL dance.
// A bare GET (no params) stays byte-identical to the pre-picker CSV
// export; see lib/cv/exportFields.ts for the column registry.
const querySchema = z.object({
  format: z.enum(['csv', 'xlsx']).default('csv'),
  fields: z
    .string()
    .transform((s) =>
      s
        .split(',')
        .map((f) => f.trim())
        .filter((f) => f.length > 0),
    )
    .optional(),
});

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    format: url.searchParams.get('format') ?? undefined,
    fields: url.searchParams.get('fields') ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  const { fields, unknown } = resolveExportFields(parsed.data.fields ?? null);
  if (unknown.length > 0 || fields.length === 0) {
    return NextResponse.json(
      { error: 'bad_request', unknownFields: unknown },
      { status: 400 },
    );
  }

  const data = await buildCvData(session.user.id);
  const stamp = new Date().toISOString().slice(0, 10);

  if (parsed.data.format === 'xlsx') {
    const workbook = new ExcelJS.Workbook();
    for (const sheet of buildExportSheets(data, fields)) {
      const ws = workbook.addWorksheet(sheet.name);
      const headerRow = ws.addRow(sheet.header);
      headerRow.font = { bold: true };
      for (const row of sheet.rows) {
        ws.addRow(row.map((v) => v ?? ''));
      }
      // Size each column to its longest cell so the sheet opens readable;
      // cap it so a long teammates list doesn't produce a screen-wide column.
      ws.columns.forEach((col, i) => {
        let width = sheet.header[i]?.length ?? 10;
        for (const row of sheet.rows) {
          const len = String(row[i] ?? '').length;
          if (len > width) width = len;
        }
        col.width = Math.min(width + 2, 40);
      });
    }
    const buffer = await workbook.xlsx.writeBuffer();
    return new NextResponse(Buffer.from(buffer as ArrayBuffer), {
      status: 200,
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="debate-cv-${stamp}.xlsx"`,
        'Cache-Control': 'no-store',
      },
    });
  }

  return new NextResponse(buildExportCsv(data, fields), {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="debate-cv-${stamp}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
