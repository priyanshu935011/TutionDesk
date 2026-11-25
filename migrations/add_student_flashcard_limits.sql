-- ============================================================================
-- CLASSTECH: Student Flashcard Limits & Tier Packages Migration
-- Run this in Supabase SQL Editor -> New Query
-- ============================================================================

-- 1. Ensure columns exist on students table
ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS flashcards_limit INT DEFAULT 25,
  ADD COLUMN IF NOT EXISTS flashcards_created INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS plan_tier TEXT DEFAULT 'free';

-- 2. Populate defaults for existing students
UPDATE public.students
SET flashcards_limit = 25
WHERE flashcards_limit IS NULL;

UPDATE public.students
SET flashcards_created = 0
WHERE flashcards_created IS NULL;

UPDATE public.students
SET plan_tier = 'free'
WHERE plan_tier IS NULL;

-- 3. Ensure student_packages table exists with proper schema
CREATE TABLE IF NOT EXISTS public.student_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  badge TEXT DEFAULT 'Popular',
  description TEXT DEFAULT '',
  price NUMERIC DEFAULT 0,
  discounted_price NUMERIC DEFAULT 0,
  billing_cycle TEXT DEFAULT 'monthly',
  quotas JSONB DEFAULT '{}'::jsonb,
  features JSONB DEFAULT '{}'::jsonb,
  priority INT DEFAULT 1,
  is_active BOOLEAN DEFAULT true,
  created_by TEXT DEFAULT 'super_admin',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default tiers (ClassTech Free & ClassTech Premium)
INSERT INTO public.student_packages (name, slug, badge, description, price, discounted_price, billing_cycle, quotas, features, priority, is_active)
VALUES 
  (
    'ClassTech Free',
    'classtech-free',
    'Free Tier',
    'Essential self-study starter pack with AI flashcards & active recall.',
    0,
    0,
    'free',
    '{"aiFlashcardsLimit": 25, "aiDoubtsDailyLimit": 5, "mistakeBookMaxEntries": 30, "focusModeMaxDailyMinutes": 60, "testSeriesAccess": "preview", "digitalNotesAccess": "preview", "maxFreeMockTests": 3}'::jsonb,
    '{"aiTutor": true, "aiMistakeBook": true, "aiRevision": true, "aiCareerGuidance": true, "gamifiedFocusMode": true, "interactivePyqBank": true, "virtualStudyRooms": true, "parentSnapshot": true, "adFree": false}'::jsonb,
    1,
    true
  ),
  (
    'ClassTech Premium',
    'classtech-premium',
    'All Access',
    'Full premium pass: unlimited 24/7 AI tutor, full test series, notes & 500 AI flashcards.',
    499,
    299,
    'yearly',
    '{"aiFlashcardsLimit": 500, "aiDoubtsDailyLimit": 200, "mistakeBookMaxEntries": 2000, "focusModeMaxDailyMinutes": -1, "testSeriesAccess": "all", "digitalNotesAccess": "all", "maxFreeMockTests": 100}'::jsonb,
    '{"aiTutor": true, "aiMistakeBook": true, "aiRevision": true, "aiCareerGuidance": true, "gamifiedFocusMode": true, "interactivePyqBank": true, "virtualStudyRooms": true, "parentSnapshot": true, "adFree": true}'::jsonb,
    2,
    true
  )
ON CONFLICT (slug) DO UPDATE 
SET 
  quotas = EXCLUDED.quotas,
  name = EXCLUDED.name,
  is_active = EXCLUDED.is_active;

-- Deactivate any legacy obsolete packages
UPDATE public.student_packages
SET is_active = false
WHERE slug NOT IN ('classtech-free', 'classtech-premium');

-- 4. Stored Procedure: Increment student flashcards created count
CREATE OR REPLACE FUNCTION public.increment_student_flashcard_usage(
  p_student_id TEXT,
  p_count INT DEFAULT 1
)
RETURNS VOID AS $$
BEGIN
  UPDATE public.students
  SET flashcards_created = COALESCE(flashcards_created, 0) + p_count
  WHERE id::text = p_student_id OR user_id::text = p_student_id;
END;
$$ LANGUAGE plpgsql;

-- 5. Stored Procedure: Upgrade student to premium tier & add quota
CREATE OR REPLACE FUNCTION public.add_student_premium_flashcards(
  p_student_id TEXT,
  p_increment INT DEFAULT 500
)
RETURNS VOID AS $$
BEGIN
  UPDATE public.students
  SET 
    flashcards_limit = COALESCE(flashcards_limit, 25) + p_increment,
    plan_tier = 'premium'
  WHERE id::text = p_student_id OR user_id::text = p_student_id;
END;
$$ LANGUAGE plpgsql;
