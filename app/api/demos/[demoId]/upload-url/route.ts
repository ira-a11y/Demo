import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, BUCKET } from '@/lib/supabaseServer';
import { customAlphabet } from 'nanoid';

const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 16);

interface Params { params: Promise<{ demoId: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { demoId } = await params;
    const { ext } = await req.json();
    const allowed = ['png', 'jpg', 'jpeg', 'webp'];
    if (!allowed.includes(ext?.toLowerCase())) {
      return NextResponse.json({ error: { code: 'INVALID_TYPE', message: 'Unsupported file type' } }, { status: 422 });
    }
    const path = `${demoId}/${nanoid()}.${ext}`;
    const sb = getSupabaseAdmin();
    const { data, error } = await sb.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error) throw error;
    return NextResponse.json({ path, signedUrl: data.signedUrl });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: { code: 'SERVER_ERROR', message: msg } }, { status: 500 });
  }
}
