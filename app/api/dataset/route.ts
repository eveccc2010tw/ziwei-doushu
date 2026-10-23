import { NextRequest, NextResponse } from 'next/server';
import {
  formatDatasetKey,
  getDatasetReading,
  getDatasetStats,
  parseDatasetKey,
  type DatasetMode,
} from '@/lib/ziwei-dataset';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('stats') === '1') {
    return NextResponse.json({ ok: true, stats: getDatasetStats() });
  }

  let k = sp.get('k') || '';
  if (!k) {
    const y = Number(sp.get('y'));
    const m = Number(sp.get('m'));
    const d = Number(sp.get('d'));
    const h = Number(sp.get('h'));
    const g = sp.get('g');
    if (y && m && d && !Number.isNaN(h) && (g === 'male' || g === 'female')) {
      k = formatDatasetKey(y, m, d, h, g);
    }
  }

  const parts = parseDatasetKey(k);
  if (!parts) {
    return NextResponse.json(
      { ok: false, error: 'Invalid or out-of-range key (supported years: 1950-2026)' },
      { status: 400 }
    );
  }

  const rawMode = sp.get('mode');
  const mode: DatasetMode =
    rawMode === 'sqlite' || rawMode === 'zst-onfly' ? rawMode : 'auto';
  const bypassCache = sp.get('nocache') === '1';

  const record = await getDatasetReading(parts, mode, { bypassCache });
  if (!record) {
    return NextResponse.json(
      { ok: false, error: `Reading not found for ${parts.k}` },
      { status: 404 }
    );
  }

  return NextResponse.json({
    ok: true,
    record,
  });
}
