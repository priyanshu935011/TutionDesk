-- ==============================================================================
-- Migration: Add 'subjects' JSONB column to test_series_categories table
-- Description:
--   Adds the missing 'subjects' column as JSONB to store subjects and topics,
--   creates a GIN index for fast lookups, and reloads PostgREST schema cache.
-- ==============================================================================

-- 1. Ensure table exists or create it
CREATE TABLE IF NOT EXISTS public.test_series_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  icon TEXT DEFAULT '📝',
  subjects JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Add 'subjects' column if the table already exists
ALTER TABLE public.test_series_categories
ADD COLUMN IF NOT EXISTS subjects JSONB DEFAULT '[]'::jsonb;

-- 3. Create a GIN index on 'subjects' for fast querying
CREATE INDEX IF NOT EXISTS idx_test_series_categories_subjects
ON public.test_series_categories USING gin (subjects);

-- 4. Notify PostgREST schema cache to reload immediately
NOTIFY pgrst, 'reload schema';
