import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getSupabaseAdmin, getPublicUrl } from '@/lib/supabaseServer';

interface Params { params: Promise<{ screenId: string }> }

export interface DetectedRegion {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
}

interface RawRegion extends DetectedRegion { scanIdx: number }
interface MergedRegion extends DetectedRegion { confidence: number }

const TOOL_NAME = 'report_regions';
const TOOL_DEF: Anthropic.Tool = {
  name: TOOL_NAME,
  description: 'Report every detected interactive region in the UI screenshot',
  input_schema: {
    type: 'object' as const,
    properties: {
      regions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            x: { type: 'number', description: 'Left edge as fraction of image width (0–1)' },
            y: { type: 'number', description: 'Top edge as fraction of image height (0–1)' },
            w: { type: 'number', description: 'Width as fraction of image width (0–1)' },
            h: { type: 'number', description: 'Height as fraction of image height (0–1)' },
            label: { type: 'string', description: 'Short descriptive name, e.g. "Login button"' },
          },
          required: ['x', 'y', 'w', 'h', 'label'],
        },
      },
    },
    required: ['regions'],
  },
};

const SHARED_RULES = `
ONLY detect these element types:
  1. BUTTONS — any element that looks like a button: pill buttons, rounded-rect buttons, CTA buttons, submit buttons, ghost/outline buttons, toggle buttons, segmented controls
  2. NAVIGATION ITEMS — nav bar links, sidebar menu items, tab bar items, breadcrumb links, top-menu entries, hamburger menus, bottom nav items
  3. DASHBOARD AREAS — clickable cards, panels, tiles, summary widgets, feature blocks that act as a whole clickable unit. If the screen shows a list, treat the ENTIRE list as one clickable region, not individual rows.

DO NOT detect:
  - Plain text, headings, paragraphs, body copy, labels, captions
  - Decorative icons or illustrations that are not part of a button
  - Input fields, text areas, search boxes
  - Images, avatars, logos (unless they are clearly a nav/button element)
  - Dividers, separators, backgrounds
`;

const PROMPTS = [
  // Scan 1 — comprehensive
  `You are a precise UI hotspot detector for interactive demos. Your job is to find buttons, navigation items, and clickable dashboard areas.

${SHARED_RULES}
Return each element's bounding box as exact fractions of the full image width and height (x=left, y=top, w=width, h=height, all 0–1). Hug each element tightly — do not include surrounding whitespace. Give each a short functional label (e.g. "Sign in button", "Dashboard nav item", "Analytics card").`,

  // Scan 2 — pixel-perfect boundaries
  `You are a pixel-perfect UI measurement tool for interactive demo creation.

${SHARED_RULES}
For every qualifying element, measure its bounding box with maximum precision:
- x, y = exact top-left corner as fraction of image dimensions
- w, h = exact element dimensions as fraction of image dimensions
- Stay inside the visible border of each element — do not include drop shadows or spacing
- Label each with its function (e.g. "Upgrade button", "Settings nav item", "User profile card")`,

  // Scan 3 — verify completeness
  `You are a UI review tool checking that all buttons, nav items, and clickable areas in this screenshot are catalogued for an interactive demo.

${SHARED_RULES}
Go through the UI systematically: top navigation, sidebar, main content area, footer. For each qualifying element output its bounding box as fractions (x, y, w, h) and a short label. Miss nothing in these categories — but strictly ignore everything else.`,
];

function iou(a: RawRegion, b: RawRegion): number {
  const ix1 = Math.max(a.x, b.x), iy1 = Math.max(a.y, b.y);
  const ix2 = Math.min(a.x + a.w, b.x + b.w), iy2 = Math.min(a.y + a.h, b.y + b.h);
  if (ix2 <= ix1 || iy2 <= iy1) return 0;
  const inter = (ix2 - ix1) * (iy2 - iy1);
  return inter / (a.w * a.h + b.w * b.h - inter);
}

function mergeRegions(scans: DetectedRegion[][]): MergedRegion[] {
  // Tag each region with its scan index
  const all: RawRegion[] = scans.flatMap((s, i) => s.map(r => ({ ...r, scanIdx: i })));
  const visited = new Set<number>();
  const merged: MergedRegion[] = [];

  for (let i = 0; i < all.length; i++) {
    if (visited.has(i)) continue;
    visited.add(i);
    const cluster: RawRegion[] = [all[i]];
    const usedScans = new Set([all[i].scanIdx]);

    // Greedily pull in matching regions from other scans
    for (let j = i + 1; j < all.length; j++) {
      if (visited.has(j)) continue;
      if (usedScans.has(all[j].scanIdx)) continue; // one per scan per cluster
      // Check against every member of the current cluster
      const best = cluster.reduce((max, c) => Math.max(max, iou(c, all[j])), 0);
      if (best >= 0.35) {
        cluster.push(all[j]);
        usedScans.add(all[j].scanIdx);
        visited.add(j);
      }
    }

    // Average coordinates across cluster members
    const n = cluster.length;
    const x = cluster.reduce((s, r) => s + r.x, 0) / n;
    const y = cluster.reduce((s, r) => s + r.y, 0) / n;
    const w = cluster.reduce((s, r) => s + r.w, 0) / n;
    const h = cluster.reduce((s, r) => s + r.h, 0) / n;
    // Pick label from highest-confidence scan (scan 1 first, then 0, then 2)
    const preferred = cluster.find(r => r.scanIdx === 1) ?? cluster[0];

    merged.push({ x, y, w, h, label: preferred.label, confidence: n });
  }

  // Sort: higher confidence first, then top-to-bottom, left-to-right
  return merged.sort((a, b) => b.confidence - a.confidence || a.y - b.y || a.x - b.x);
}

async function runScan(client: Anthropic, imageUrl: string, promptText: string, scanIdx: number): Promise<RawRegion[]> {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    tools: [TOOL_DEF],
    tool_choice: { type: 'tool', name: TOOL_NAME },
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'url', url: imageUrl } },
        { type: 'text', text: promptText },
      ],
    }],
  });

  const toolUse = response.content.find(b => b.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') return [];
  const raw = ((toolUse.input as { regions?: DetectedRegion[] }).regions) ?? [];

  return raw
    .map(r => ({
      x: Math.max(0, Math.min(0.99, Number(r.x) || 0)),
      y: Math.max(0, Math.min(0.99, Number(r.y) || 0)),
      w: Math.max(0.005, Math.min(1, Number(r.w) || 0)),
      h: Math.max(0.005, Math.min(1, Number(r.h) || 0)),
      label: String(r.label ?? '').slice(0, 80) || 'Element',
      scanIdx,
    }))
    .filter(r => r.w >= 0.005 && r.h >= 0.005 && r.x + r.w <= 1.01 && r.y + r.h <= 1.01);
}

export async function POST(_req: NextRequest, { params }: Params) {
  try {
    const { screenId } = await params;
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: { code: 'NO_API_KEY', message: 'ANTHROPIC_API_KEY is not set' } }, { status: 500 });
    }

    const sb = getSupabaseAdmin();
    const { data: screen, error } = await sb
      .from('screens')
      .select('image_path, width, height')
      .eq('id', screenId)
      .single();

    if (error || !screen) {
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Screen not found' } }, { status: 404 });
    }

    const imageUrl = getPublicUrl(screen.image_path);
    const client = new Anthropic({ apiKey });

    // Run 3 independent scans in parallel
    const [s0, s1, s2] = await Promise.all(
      PROMPTS.map((prompt, i) => runScan(client, imageUrl, prompt, i))
    );

    const merged = mergeRegions([s0, s1, s2]);

    if (merged.length === 0) {
      return NextResponse.json({ error: { code: 'NO_RESULT', message: 'No regions detected' } }, { status: 500 });
    }

    const regions: DetectedRegion[] = merged.map(({ confidence: _c, ...r }) => r);
    return NextResponse.json({ regions, scanCounts: [s0.length, s1.length, s2.length] });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    console.error('[auto-detect]', msg);
    return NextResponse.json({ error: { code: 'SERVER_ERROR', message: msg } }, { status: 500 });
  }
}
