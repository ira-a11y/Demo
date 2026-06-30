import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseServer';

interface Params { params: Promise<{ demoId: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { demoId } = await params;
    const { orderedScreenIds } = await req.json();
    if (!Array.isArray(orderedScreenIds)) {
      return NextResponse.json({ error: { code: 'INVALID_INPUT', message: 'orderedScreenIds must be array' } }, { status: 400 });
    }
    const sb = getSupabaseAdmin();
    await Promise.all(
      orderedScreenIds.map((id: string, i: number) =>
        sb.from('screens').update({ order_index: i }).eq('id', id).eq('demo_id', demoId)
      )
    );
    const { data } = await sb.from('screens').select('*').eq('demo_id', demoId).order('order_index');
    return NextResponse.json(data);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: { code: 'SERVER_ERROR', message: msg } }, { status: 500 });
  }
}
