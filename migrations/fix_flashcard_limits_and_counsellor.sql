-- ============================================================================
-- Fix Flashcard Limits & Counsellor Integration Migration
-- Run this in Supabase SQL Editor -> New Query
-- ============================================================================

-- 1. Ensure user_id, flashcards_limit, flashcards_created, plan_tier columns exist on students table
ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS user_id TEXT,
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

-- 3. Stored Procedure: Increment student flashcards created count
-- Safely supports lookup by UUID id, user_id, phone, or enrollment_number
CREATE OR REPLACE FUNCTION public.increment_student_flashcard_usage(
  p_student_id TEXT,
  p_count INT DEFAULT 1
)
RETURNS VOID AS $$
BEGIN
  UPDATE public.students
  SET flashcards_created = COALESCE(flashcards_created, 0) + p_count
  WHERE id::text = p_student_id 
     OR (user_id IS NOT NULL AND user_id::text = p_student_id)
     OR phone = p_student_id 
     OR enrollment_number = p_student_id;
END;
$$ LANGUAGE plpgsql;

-- 4. Stored Procedure: Upgrade student to premium tier & add quota
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
  WHERE id::text = p_student_id 
     OR (user_id IS NOT NULL AND user_id::text = p_student_id)
     OR phone = p_student_id 
     OR enrollment_number = p_student_id;
END;
$$ LANGUAGE plpgsql;
