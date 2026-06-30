import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseServer';
import { validateHotspotRect } from '@/lib/validation';

interface Params { params: Promise<{ screenId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { screenId } = await params;
    const sb = getSupabaseAdmin();
    const { data, error } = await sb.from('hotspots').select('*').eq('screen_id', screenId);
    if (error) throw error;
    return NextResponse.json(data ?? []);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: { code: 'SERVER_ERROR', message: msg } }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { screenId } = await params;
    const body = await req.json();
    const { x, y, w, h } = body;
    if (!validateHotspotRect({ x, y, w, h })) {
      return NextResponse.json({ error: { code: 'INVALID_RECT', message: 'Invalid hotspot coordinates' } }, { status: 422 });
    }
    const action = body.action === 'tooltip' ? 'tooltip' : body.action === 'layover' ? 'layover' : 'navigate';
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from('hotspots')
      .insert({
        screen_id: screenId, x, y, w, h,
        action,
        target_screen: body.target_screen ?? null,
        tooltip_text: body.tooltip_text ?? null,
        radius_tl: body.radius_tl ?? 0,
        radius_tr: body.radius_tr ?? 0,
        radius_br: body.radius_br ?? 0,
        radius_bl: body.radius_bl ?? 0,
        layover_image_path: body.layover_image_path ?? null,
        layover_full_screen: body.layover_full_screen ?? true,
      })
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json(data, { status: 201 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: { code: 'SERVER_ERROR', message: msg } }, { status: 500 });
  }
}
