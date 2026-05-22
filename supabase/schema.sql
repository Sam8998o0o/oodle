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

-- ══════════════════════════════════════════════════════════
-- Shout system + Like-balance economy
-- ══════════════════════════════════════════════════════════

-- ── shouts ────────────────────────────────────────────────
-- A pet can "shout" a short message that appears as a speech
-- bubble in PlazaScene for 20 seconds.
CREATE TABLE IF NOT EXISTS shouts (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  pet_id     uuid        NOT NULL REFERENCES pets(id)        ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES auth.users(id)  ON DELETE CASCADE,
  message    text        NOT NULL CHECK (length(message) BETWEEN 1 AND 30),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ── shout_likes ───────────────────────────────────────────
-- Other users can like a shout once. Each like credits the
-- shout's pet owner with 1 point in like_balance.
CREATE TABLE IF NOT EXISTS shout_likes (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  shout_id   uuid        NOT NULL REFERENCES shouts(id)      ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES auth.users(id)  ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shout_id, user_id)
);

-- ── like_balance ──────────────────────────────────────────
-- Running total of likes received. Redeemable for food items
-- via redeem_likes(). One row per user, upserted by like_shout().
CREATE TABLE IF NOT EXISTS like_balance (
  user_id    uuid    PRIMARY KEY REFERENCES auth.users(id)   ON DELETE CASCADE,
  balance    integer NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ── RLS ───────────────────────────────────────────────────
ALTER TABLE shouts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE shout_likes  ENABLE ROW LEVEL SECURITY;
ALTER TABLE like_balance ENABLE ROW LEVEL SECURITY;

-- shouts: anyone logged in can read; only owner can insert/delete
CREATE POLICY "shouts_select_all"
  ON shouts FOR SELECT TO authenticated USING (true);
CREATE POLICY "shouts_insert_own"
  ON shouts FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "shouts_delete_own"
  ON shouts FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- shout_likes: anyone logged in can read; only owner can insert
CREATE POLICY "shout_likes_select_all"
  ON shout_likes FOR SELECT TO authenticated USING (true);
CREATE POLICY "shout_likes_insert_own"
  ON shout_likes FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- like_balance: users can only read their own row
-- (writes happen exclusively through SECURITY DEFINER functions below)
CREATE POLICY "like_balance_select_own"
  ON like_balance FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- ── Function: like_shout ──────────────────────────────────
-- Atomically:
--   1. Records the like (idempotent via ON CONFLICT DO NOTHING)
--   2. If a new row was inserted, credits the pet owner +1 balance
CREATE OR REPLACE FUNCTION like_shout(p_shout_id uuid, p_liker_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rows      integer;
  v_pet_owner uuid;
BEGIN
  INSERT INTO shout_likes (shout_id, user_id)
  VALUES (p_shout_id, p_liker_id)
  ON CONFLICT (shout_id, user_id) DO NOTHING;

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows > 0 THEN
    -- Find the owner of the pet that made this shout
    SELECT p.user_id INTO v_pet_owner
    FROM   shouts s
    JOIN   pets   p ON p.id = s.pet_id
    WHERE  s.id = p_shout_id;

    IF v_pet_owner IS NOT NULL THEN
      INSERT INTO like_balance (user_id, balance, updated_at)
      VALUES (v_pet_owner, 1, now())
      ON CONFLICT (user_id) DO UPDATE
        SET balance    = like_balance.balance + 1,
            updated_at = now();
    END IF;
  END IF;
END;
$$;

-- ── Function: redeem_likes ────────────────────────────────
-- Deducts p_cost from a user's balance and returns true.
-- Returns false (without deducting) if balance is insufficient.
CREATE OR REPLACE FUNCTION redeem_likes(p_user_id uuid, p_cost integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_balance integer;
BEGIN
  SELECT balance INTO v_balance
  FROM   like_balance
  WHERE  user_id = p_user_id;

  IF v_balance IS NULL OR v_balance < p_cost THEN
    RETURN false;
  END IF;

  UPDATE like_balance
  SET    balance    = balance - p_cost,
         updated_at = now()
  WHERE  user_id = p_user_id;

  RETURN true;
END;
$$;

-- ── Realtime for shouts ───────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE shouts;

-- ══════════════════════════════════════════════════════════
-- Stripe subscription system
-- ══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS subscriptions (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status                 text        NOT NULL DEFAULT 'active',
  stripe_subscription_id text,
  stripe_customer_id     text,
  current_period_start   timestamptz NOT NULL DEFAULT now(),
  current_period_end     timestamptz NOT NULL DEFAULT now() + interval '30 days',
  created_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "subscriptions_select_own"
  ON subscriptions FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION check_subscription(p_user_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM subscriptions
    WHERE user_id = p_user_id
      AND status = 'active'
      AND current_period_end > now()
  );
END;
$$;

-- ══════════════════════════════════════════════════════════
-- Airplane ads
-- ══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ads (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  text        text        NOT NULL,
  sub_text    text        NOT NULL DEFAULT '',
  logo_url    text,
  url         text        NOT NULL,
  is_active   boolean     NOT NULL DEFAULT true,
  duration    integer     NOT NULL DEFAULT 25,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE ads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ads_select_all" ON ads FOR SELECT TO anon, authenticated USING (is_active = true);

CREATE OR REPLACE FUNCTION upsert_subscription(
  p_user_id            uuid,
  p_stripe_sub_id      text,
  p_stripe_customer_id text,
  p_status             text,
  p_period_start       timestamptz,
  p_period_end         timestamptz
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO subscriptions (
    user_id, stripe_subscription_id, stripe_customer_id,
    status, current_period_start, current_period_end
  ) VALUES (
    p_user_id, p_stripe_sub_id, p_stripe_customer_id,
    p_status, p_period_start, p_period_end
  )
  ON CONFLICT (user_id) DO UPDATE SET
    stripe_subscription_id = EXCLUDED.stripe_subscription_id,
    stripe_customer_id     = EXCLUDED.stripe_customer_id,
    status                 = EXCLUDED.status,
    current_period_start   = EXCLUDED.current_period_start,
    current_period_end     = EXCLUDED.current_period_end;
END;
$$;
