-- ============================================================================
-- CLASSTECH: Student Flashcard Limits & Two-Tier Packages Migration
-- Run this in Supabase SQL Editor -> New Query
-- ============================================================================

-- 1. Ensure flashcard quota columns exist on students table
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

-- 3. Add AI Flashcards Limit and compatibility columns to existing student_packages table
ALTER TABLE public.student_packages
  ADD COLUMN IF NOT EXISTS ai_flashcards_limit INT DEFAULT 25,
  ADD COLUMN IF NOT EXISTS name TEXT,
  ADD COLUMN IF NOT EXISTS slug TEXT,
  ADD COLUMN IF NOT EXISTS badge TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS discounted_price NUMERIC(10, 2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS quotas JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS features JSONB DEFAULT '{}'::jsonb;

-- 4. Update the Two Active Tiers (Free & ClassTech Premium)
-- Tier 1: ClassTech Free (tier = 'free')
UPDATE public.student_packages
SET 
  title = 'ClassTech Free',
  name = 'ClassTech Free',
  slug = 'classtech-free',
  badge_text = 'FREE',
  badge = 'Free Tier',
  price = 0,
  ai_flashcards_limit = 25,
  is_active = true,
  quotas = jsonb_build_object('aiFlashcardsLimit', 25, 'aiDoubtsDailyLimit', 5),
  features = jsonb_build_object('aiTutor', true, 'aiRevision', true)
WHERE tier = 'free';

-- Tier 2: ClassTech Premium (tier = 'premium')
UPDATE public.student_packages
SET 
  title = 'ClassTech Premium',
  name = 'ClassTech Premium',
  slug = 'classtech-premium',
  badge_text = 'ALL ACCESS',
  badge = 'All Access',
  price = 299,
  ai_flashcards_limit = 500,
  is_active = true,
  quotas = jsonb_build_object('aiFlashcardsLimit', 500, 'aiDoubtsDailyLimit', 200),
  features = jsonb_build_object('aiTutor', true, 'aiRevision', true)
WHERE tier = 'premium';

-- 5. Deactivate any obsolete/extra tiers (like 'pro') so ONLY Free and ClassTech Premium are active
UPDATE public.student_packages
SET is_active = false
WHERE tier NOT IN ('free', 'premium');

-- 6. Insert tiers if they didn't exist previously (safeguard)
INSERT INTO public.student_packages (title, tier, price, badge_text, ai_flashcards_limit, is_active)
SELECT 'ClassTech Free', 'free', 0, 'FREE', 25, true
WHERE NOT EXISTS (SELECT 1 FROM public.student_packages WHERE tier = 'free');

INSERT INTO public.student_packages (title, tier, price, badge_text, ai_flashcards_limit, is_active)
SELECT 'ClassTech Premium', 'premium', 299, 'ALL ACCESS', 500, true
WHERE NOT EXISTS (SELECT 1 FROM public.student_packages WHERE tier = 'premium');

-- 7. Stored Procedure: Increment student flashcards created count
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

-- 8. Stored Procedure: Upgrade student to premium tier & add quota
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
