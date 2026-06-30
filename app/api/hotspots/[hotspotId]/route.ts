import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseServer';
import { validateHotspotRect, validateAction, validateTooltipText } from '@/lib/validation';

interface Params { params: Promise<{ hotspotId: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const { hotspotId } = await params;
    const body = await req.json().catch(() => ({}));
    const sb = getSupabaseAdmin();
    const updates: Record<string, unknown> = {};

    if (body.x !== undefined || body.y !== undefined || body.w !== undefined || body.h !== undefined) {
      // Need existing values to validate
      const { data: existing } = await sb.from('hotspots').select('x,y,w,h').eq('id', hotspotId).single();
      const rect = {
        x: body.x ?? existing?.x,
        y: body.y ?? existing?.y,
        w: body.w ?? existing?.w,
        h: body.h ?? existing?.h,
      };
      if (!validateHotspotRect(rect)) {
        return NextResponse.json({ error: { code: 'INVALID_RECT', message: 'Invalid hotspot coordinates' } }, { status: 422 });
      }
      if (body.x !== undefined) updates.x = body.x;
      if (body.y !== undefined) updates.y = body.y;
      if (body.w !== undefined) updates.w = body.w;
      if (body.h !== undefined) updates.h = body.h;
    }

    if (body.action !== undefined) {
      if (!validateAction(body.action)) {
        return NextResponse.json({ error: { code: 'INVALID_ACTION', message: 'action must be navigate or tooltip' } }, { status: 422 });
      }
      updates.action = body.action;
    }

    if (body.targetScreen !== undefined) updates.target_screen = body.targetScreen;
    if (body.layoverImagePath !== undefined) updates.layover_image_path = body.layoverImagePath;
    if (body.layoverFullScreen !== undefined) updates.layover_full_screen = Boolean(body.layoverFullScreen);
    if (body.radius_tl !== undefined) updates.radius_tl = Number(body.radius_tl);
    if (body.radius_tr !== undefined) updates.radius_tr = Number(body.radius_tr);
    if (body.radius_br !== undefined) updates.radius_br = Number(body.radius_br);
    if (body.radius_bl !== undefined) updates.radius_bl = Number(body.radius_bl);
    if (body.tooltipText !== undefined) {
      if (!validateTooltipText(body.tooltipText)) {
        return NextResponse.json({ error: { code: 'TOOLTIP_TOO_LONG', message: 'Tooltip text max 280 chars' } }, { status: 422 });
      }
      updates.tooltip_text = body.tooltipText;
    }

    const { data, error } = await sb.from('hotspots').update(updates).eq('id', hotspotId).select().single();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Hotspot not found' } }, { status: 404 });
    return NextResponse.json(data);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: { code: 'SERVER_ERROR', message: msg } }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const { hotspotId } = await params;
    const sb = getSupabaseAdmin();
    const { error } = await sb.from('hotspots').delete().eq('id', hotspotId);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: { code: 'SERVER_ERROR', message: msg } }, { status: 500 });
  }
}
