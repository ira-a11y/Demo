import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, BUCKET } from '@/lib/supabaseServer';

interface Params { params: Promise<{ screenId: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const { screenId } = await params;
    const body = await req.json().catch(() => ({}));
    const sb = getSupabaseAdmin();
    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) {
      const n = body.name.trim().slice(0, 80);
      if (n) updates.name = n;
    }
    if (body.orderIndex !== undefined) updates.order_index = body.orderIndex;
    if (body.imagePath !== undefined) updates.image_path = body.imagePath;
    if (body.width !== undefined) updates.width = body.width;
    if (body.height !== undefined) updates.height = body.height;
    const { data, error } = await sb.from('screens').update(updates).eq('id', screenId).select().single();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Screen not found' } }, { status: 404 });
    return NextResponse.json(data);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: { code: 'SERVER_ERROR', message: msg } }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const { screenId } = await params;
    const sb = getSupabaseAdmin();

    // Get image_path first
    const { data: screen } = await sb.from('screens').select('image_path').eq('id', screenId).single();
    if (screen?.image_path) {
      await sb.storage.from(BUCKET).remove([screen.image_path]);
    }

    const { error } = await sb.from('screens').delete().eq('id', screenId);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: { code: 'SERVER_ERROR', message: msg } }, { status: 500 });
  }
}
