
-- =====================================
-- 1. USERS TABLE
-- =====================================

CREATE TABLE IF NOT EXISTS public.users (
    telegram_id BIGINT PRIMARY KEY,
    first_name TEXT,
    last_name TEXT,
    username TEXT,
    photo_url TEXT,
    balance_cents BIGINT NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
    referred_by BIGINT,
    referral_completed BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add missing columns safely
ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS telegram_id BIGINT,
    ADD COLUMN IF NOT EXISTS first_name TEXT,
    ADD COLUMN IF NOT EXISTS last_name TEXT,
    ADD COLUMN IF NOT EXISTS username TEXT,
    ADD COLUMN IF NOT EXISTS photo_url TEXT,
    ADD COLUMN IF NOT EXISTS balance_cents BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS referred_by BIGINT,
    ADD COLUMN IF NOT EXISTS referral_completed BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Ensure telegram_id is unique
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.users'::regclass
          AND contype IN ('p', 'u')
          AND conkey = ARRAY[
              (SELECT attnum
               FROM pg_attribute
               WHERE attrelid = 'public.users'::regclass
               AND attname = 'telegram_id')
          ]::smallint[]
    ) THEN
        ALTER TABLE public.users
        ADD CONSTRAINT users_telegram_id_unique UNIQUE (telegram_id);
    END IF;
END $$;

-- =====================================
-- 2. REFERRAL FOREIGN KEY
-- =====================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'users_referred_by_fkey'
          AND conrelid = 'public.users'::regclass
    ) THEN
        ALTER TABLE public.users
        ADD CONSTRAINT users_referred_by_fkey
        FOREIGN KEY (referred_by)
        REFERENCES public.users(telegram_id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS users_referred_by_idx
ON public.users(referred_by);

-- =====================================
-- 3. TASK PROGRESS
-- =====================================

CREATE TABLE IF NOT EXISTS public.task_progress (
    telegram_id BIGINT NOT NULL REFERENCES public.users(telegram_id),
    task_id INT NOT NULL,
    started_at TIMESTAMPTZ,
    verified_at TIMESTAMPTZ,
    claimed_at TIMESTAMPTZ,
    PRIMARY KEY (telegram_id, task_id)
);

-- =====================================
-- 4. DAILY CLAIMS
-- =====================================

CREATE TABLE IF NOT EXISTS public.daily_claims (
    telegram_id BIGINT NOT NULL REFERENCES public.users(telegram_id),
    claim_date DATE NOT NULL,
    PRIMARY KEY (telegram_id, claim_date)
);

-- =====================================
-- 5. WITHDRAWALS
-- =====================================

CREATE TABLE IF NOT EXISTS public.withdrawals (
    id BIGSERIAL PRIMARY KEY,
    telegram_id BIGINT NOT NULL REFERENCES public.users(telegram_id),
    address TEXT NOT NULL,
    amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
    fee_cents BIGINT NOT NULL DEFAULT 0 CHECK (fee_cents >= 0),
    status TEXT NOT NULL DEFAULT 'Pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =====================================
-- 6. ENABLE RLS
-- =====================================

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.withdrawals ENABLE ROW LEVEL SECURITY;

-- =====================================
-- 7. SUCCESS
-- =====================================

SELECT
    'Database setup completed successfully!' AS result;
