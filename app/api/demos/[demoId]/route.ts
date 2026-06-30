import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, BUCKET } from '@/lib/supabaseServer';
import { validateDemoTitle } from '@/lib/validation';

interface Params { params: Promise<{ demoId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { demoId } = await params;
    const sb = getSupabaseAdmin();
    const { data, error } = await sb.from('demos').select('*').eq('id', demoId).single();
    if (error || !data) return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Demo not found' } }, { status: 404 });
    return NextResponse.json(data);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: { code: 'SERVER_ERROR', message: msg } }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const { demoId } = await params;
    const body = await req.json().catch(() => ({}));
    const sb = getSupabaseAdmin();
    const updates: Record<string, unknown> = {};
    if (body.title !== undefined) updates.title = validateDemoTitle(body.title);
    const { data, error } = await sb.from('demos').update(updates).eq('id', demoId).select().single();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Demo not found' } }, { status: 404 });
    return NextResponse.json(data);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: { code: 'SERVER_ERROR', message: msg } }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const { demoId } = await params;
    const sb = getSupabaseAdmin();

    // List and delete all storage objects for this demo
    const { data: files } = await sb.storage.from(BUCKET).list(demoId);
    if (files && files.length > 0) {
      await sb.storage.from(BUCKET).remove(files.map(f => `${demoId}/${f.name}`));
    }

    const { error } = await sb.from('demos').delete().eq('id', demoId);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: { code: 'SERVER_ERROR', message: msg } }, { status: 500 });
  }
}
