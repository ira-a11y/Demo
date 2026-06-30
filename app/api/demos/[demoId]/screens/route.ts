import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseServer';

interface Params { params: Promise<{ demoId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { demoId } = await params;
    const sb = getSupabaseAdmin();
    const { data, error } = await sb.from('screens').select('*').eq('demo_id', demoId).order('order_index');
    if (error) throw error;
    return NextResponse.json(data ?? []);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: { code: 'SERVER_ERROR', message: msg } }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { demoId } = await params;
    const body = await req.json();
    const { imagePath, width, height, name } = body;

    if (!imagePath) {
      return NextResponse.json({ error: { code: 'MISSING_FIELD', message: 'imagePath required' } }, { status: 400 });
    }
    if (!width || !height || width <= 0 || height <= 0) {
      return NextResponse.json({ error: { code: 'INVALID_DIMENSIONS', message: 'Valid width/height required' } }, { status: 422 });
    }

    const sb = getSupabaseAdmin();
    // Get current count for order_index
    const { count } = await sb.from('screens').select('*', { count: 'exact', head: true }).eq('demo_id', demoId);
    const order_index = count ?? 0;

    const screenName = name?.trim().slice(0, 80) || 'Untitled screen';

    const { data, error } = await sb
      .from('screens')
      .insert({ demo_id: demoId, image_path: imagePath, width, height, order_index, name: screenName })
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json(data, { status: 201 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: { code: 'SERVER_ERROR', message: msg } }, { status: 500 });
  }
}
