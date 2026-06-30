import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseServer';
import { generateSlug } from '@/lib/slug';
import { validateDemoTitle } from '@/lib/validation';

export async function GET() {
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from('demos')
      .select('*, screens(image_path, order_index)')
      .order('created_at', { ascending: false });
    if (error) throw error;
    // Attach first screen image path to each demo
    const demos = (data ?? []).map(({ screens, ...demo }) => {
      const sorted = (screens as { image_path: string; order_index: number }[] ?? [])
        .sort((a, b) => a.order_index - b.order_index);
      return { ...demo, firstImagePath: sorted[0]?.image_path ?? null };
    });
    return NextResponse.json(demos);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : typeof e === 'object' ? JSON.stringify(e) : String(e);
    console.error('[api/demos]', msg);
    return NextResponse.json({ error: { code: 'SERVER_ERROR', message: msg } }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const title = validateDemoTitle(body.title || '');
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from('demos')
      .insert({ title, public_slug: generateSlug() })
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json(data, { status: 201 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : typeof e === 'object' ? JSON.stringify(e) : String(e);
    console.error('[api/demos]', msg);
    return NextResponse.json({ error: { code: 'SERVER_ERROR', message: msg } }, { status: 500 });
  }
}
