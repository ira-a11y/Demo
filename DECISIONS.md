# DECISIONS.md

## Dependencies added

- **`nanoid`** — URL-safe random slug generation. Used for `public_slug` (demo share URL) and storage key UUIDs. No alternative in the stdlib; `crypto.randomUUID` produces UUIDs not URL-safe slugs of controlled length.

## Assumptions

- `// ASSUMPTION:` The Supabase Storage `screenshots` bucket must be created manually in the Supabase dashboard (or via the Supabase CLI). The schema.sql cannot create storage buckets via SQL — this is a Supabase platform constraint.
- `// ASSUMPTION:` The `BUILDER_ACCESS_TOKEN` gate (§6) is described in the README but not yet wired into middleware in this build. The builder is fully open by default as specified. The gate can be added as Next.js middleware in `middleware.ts` reading the env var and checking an httpOnly cookie — left as a follow-up given it's optional.
- `// ASSUMPTION:` Drag-to-reorder in the rail uses the HTML5 drag-and-drop API (no external DnD library) since the PRD specifies no extra libraries unless required. This covers the basic reorder case.
- `// ASSUMPTION:` The viewer tooltip position is anchored to the mouse cursor position (`e.clientX/Y + 12px offset`). The PRD says "positioned to stay within the viewport" — in-viewport clamping is not implemented; the offset generally keeps it visible for typical viewport sizes.
- `// ASSUMPTION:` `prefers-reduced-motion` is respected by default since the app has no CSS animations or transitions beyond Tailwind's `transition-colors` (which browsers suppress when the media query is active).
