-- ──────────────────────────────────────────────────────────
-- Oodle database schema
-- Run this in the Supabase SQL editor (Dashboard → SQL Editor)
-- ──────────────────────────────────────────────────────────

-- ── pets ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pets (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text        NOT NULL DEFAULT 'My Pet',
  pixel_data  text        NOT NULL,
  coords      jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── likes ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS likes (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  pet_id      uuid        NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pet_id, user_id)
);

-- ── Row Level Security ────────────────────────────────────
ALTER TABLE pets  ENABLE ROW LEVEL SECURITY;
ALTER TABLE likes ENABLE ROW LEVEL SECURITY;

-- pets: anyone logged in (including anonymous) can read all pets
CREATE POLICY "pets_select_all"
  ON pets FOR SELECT
  TO authenticated
  USING (true);

-- pets: users can only insert their own rows
CREATE POLICY "pets_insert_own"
  ON pets FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- pets: users can only update their own rows
CREATE POLICY "pets_update_own"
  ON pets FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

-- pets: users can only delete their own rows
CREATE POLICY "pets_delete_own"
  ON pets FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- likes: anyone logged in can read all likes
CREATE POLICY "likes_select_all"
  ON likes FOR SELECT
  TO authenticated
  USING (true);

-- likes: users can like any pet (duplicate prevented by UNIQUE constraint)
CREATE POLICY "likes_insert_own"
  ON likes FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- ── Realtime ─────────────────────────────────────────────
-- Allows PlazaScene to receive live pet-join events.
-- Run this line after enabling Realtime in the dashboard.
ALTER PUBLICATION supabase_realtime ADD TABLE pets;
