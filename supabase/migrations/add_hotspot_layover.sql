ALTER TABLE hotspots
  ADD COLUMN IF NOT EXISTS layover_image_path text,
  ADD COLUMN IF NOT EXISTS layover_full_screen boolean NOT NULL DEFAULT true;
