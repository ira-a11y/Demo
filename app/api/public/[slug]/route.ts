import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, getPublicUrl } from '@/lib/supabaseServer';

interface Params { params: Promise<{ slug: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { slug } = await params;
    const sb = getSupabaseAdmin();

    const { data: demo } = await sb
      .from('demos')
      .select('id, title, public_slug')
      .eq('public_slug', slug)
      .single();

    if (!demo) {
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Demo not found' } }, { status: 404 });
    }

    const { data: screens } = await sb
      .from('screens')
      .select('id, name, image_path, order_index, width, height')
      .eq('demo_id', demo.id)
      .order('order_index');

    if (!screens || screens.length === 0) {
      return NextResponse.json({
        demo: { title: demo.title, slug: demo.public_slug },
        screens: [],
      });
    }

    const screenIds = screens.map(s => s.id);
    const { data: hotspots } = await sb
      .from('hotspots')
      .select('id, screen_id, x, y, w, h, action, target_screen, tooltip_text, radius_tl, radius_tr, radius_br, radius_bl, layover_image_path, layover_full_screen')
      .in('screen_id', screenIds);

    const bundle = {
      demo: { title: demo.title, slug: demo.public_slug },
      screens: screens.map(s => ({
        id: s.id,
        name: s.name,
        imageUrl: getPublicUrl(s.image_path),
        orderIndex: s.order_index,
        width: s.width,
        height: s.height,
        hotspots: (hotspots || [])
          .filter(h => h.screen_id === s.id)
          .map(h => ({
            id: h.id,
            x: h.x,
            y: h.y,
            w: h.w,
            h: h.h,
            action: h.action,
            targetScreen: h.target_screen,
            tooltipText: h.tooltip_text,
            radiusTl: h.radius_tl ?? 0,
            radiusTr: h.radius_tr ?? 0,
            radiusBr: h.radius_br ?? 0,
            radiusBl: h.radius_bl ?? 0,
            layoverImageUrl: h.layover_image_path ? getPublicUrl(h.layover_image_path) : null,
            layoverFullScreen: h.layover_full_screen ?? true,
          })),
      })),
    };

    return NextResponse.json(bundle);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: { code: 'SERVER_ERROR', message: msg } }, { status: 500 });
  }
}
