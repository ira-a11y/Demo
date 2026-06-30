# ClickDemo

Turn static product screenshots into interactive, clickable demos you can share with a single link.

## Setup

### 1. Supabase project

1. Create a project at [supabase.com](https://supabase.com).
2. In the SQL editor, run `supabase/schema.sql` (idempotent — safe to re-run).
3. Go to **Storage → Buckets** and create a bucket named `screenshots` with **Public** access enabled.

### 2. Environment variables

Copy `.env.example` to `.env.local` and fill in:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
NEXT_PUBLIC_BASE_URL=http://localhost:3000
```

### 3. Run

```bash
npm install
npm run dev
# open http://localhost:3000
```

## Vercel deploy

1. Import the repo in Vercel.
2. Set the three env vars in Vercel project settings.
3. Set `NEXT_PUBLIC_BASE_URL` to your production URL.
4. No Supabase redirect/callback config needed (no auth).

## ⚠️ Security note

**The builder has no access control by default.** Anyone who reaches the deployed builder URL can create and edit demos. Deploy behind a host-level password or IP allowlist, or set `BUILDER_ACCESS_TOKEN=your-secret` in env vars to enable a shared-secret gate (`?token=your-secret` in the URL, stored in an httpOnly cookie). This is a convenience gate, not real auth.

## Coordinate system

Hotspot positions are stored as fractions (0–1) of the image's intrinsic dimensions. `x, y, w, h` map to `leftEdge/width, topEdge/height, hotspotWidth/imageWidth, hotspotHeight/imageHeight`. In the browser the image fills its container with `width:100%; height:auto` and hotspots use `left:x*100%` etc., so they scale perfectly with any viewport width. The same logic runs in builder and viewer via `lib/coords.ts` — zero drift by construction.

## Viewer accessibility note

Viewer hotspots are not keyboard-navigable in v1 (mouse only). Known limitation for a future version.

---

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
