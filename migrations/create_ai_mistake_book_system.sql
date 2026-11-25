-- ============================================================================
-- CLASSTECH AI MISTAKE NOTEBOOK & SMART RETEST SYSTEM - SUPABASE SCHEMA MIGRATION
-- Run this script in the Supabase SQL Editor (Dashboard -> SQL Editor -> New Query)
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. Student Mistakes Table (The Core Mistake Bank)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.student_mistakes (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL,
  institute_id TEXT,
  
  -- Question Content
  question_id TEXT, -- nullable if snapped/manual
  question_text TEXT NOT NULL,
  question_image_url TEXT DEFAULT '',
  question_type TEXT DEFAULT 'single_choice', -- 'single_choice', 'multiple_choice', 'numerical', 'text'
  options JSONB DEFAULT '[]'::jsonb, -- [{'id': 'A', 'text': '...'}, ...]
  student_wrong_answer JSONB DEFAULT '[]'::jsonb, -- selected answers
  correct_answer JSONB DEFAULT '[]'::jsonb, -- true answers
  explanation TEXT DEFAULT '',
  
  -- AI Diagnosis & Intelligence
  ai_root_cause TEXT DEFAULT '', -- Gemini explanation of why user fell for the trap
  ai_micro_concept TEXT DEFAULT '', -- 2-line memory/formula recap capsule
  
  -- Academic Categorization
  subject TEXT NOT NULL DEFAULT 'General',
  chapter TEXT DEFAULT '',
  topic TEXT DEFAULT '',
  difficulty TEXT DEFAULT 'medium', -- 'easy', 'medium', 'hard'
  
  -- Ingestion Source Channel
  source_channel TEXT DEFAULT 'test_series', -- 'test_series', 'flashcard', 'snap_camera', 'manual'
  source_reference_id TEXT DEFAULT '', -- test attempt ID, flashcard ID, etc.
  source_title TEXT DEFAULT '', -- e.g. "JEE Advanced Mock 4"
  
  -- Mistake Reason Classification
  mistake_reason_tag TEXT DEFAULT 'conceptual', -- 'conceptual', 'calculation', 'trap_misread', 'time_pressure', 'unclassified'
  
  -- Spaced Repetition & Mastery Lifecycle
  status TEXT DEFAULT 'unresolved', -- 'unresolved', 'in_progress', 'mastered'
  mastery_score INT DEFAULT 0, -- 0 to 100
  consecutive_correct INT DEFAULT 0, -- target: 3 consecutive correct spaced attempts
  total_retests INT DEFAULT 0,
  next_review_at TIMESTAMPTZ DEFAULT NOW(),
  last_reviewed_at TIMESTAMPTZ,
  
  -- Student Customization
  student_notes TEXT DEFAULT '',
  is_starred BOOLEAN DEFAULT false,
  is_archived BOOLEAN DEFAULT false,
  metadata JSONB DEFAULT '{}'::jsonb,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_sm_user ON public.student_mistakes(user_id);
CREATE INDEX IF NOT EXISTS idx_sm_inst ON public.student_mistakes(institute_id);
CREATE INDEX IF NOT EXISTS idx_sm_subject ON public.student_mistakes(subject);
CREATE INDEX IF NOT EXISTS idx_sm_status ON public.student_mistakes(status);
CREATE INDEX IF NOT EXISTS idx_sm_reason ON public.student_mistakes(mistake_reason_tag);
CREATE INDEX IF NOT EXISTS idx_sm_next_review ON public.student_mistakes(next_review_at);
CREATE INDEX IF NOT EXISTS idx_sm_created ON public.student_mistakes(created_at DESC);

-- Row Level Security (RLS)
ALTER TABLE public.student_mistakes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all access to student_mistakes" ON public.student_mistakes;
CREATE POLICY "Allow all access to student_mistakes" ON public.student_mistakes FOR ALL USING (true);

-- ----------------------------------------------------------------------------
-- 2. Mistake Retest Attempt Logs (Audit & Spaced Repetition History)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mistake_retest_logs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  mistake_id TEXT NOT NULL REFERENCES public.student_mistakes(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  selected_answer JSONB DEFAULT '[]'::jsonb,
  is_correct BOOLEAN NOT NULL,
  time_taken_seconds INT DEFAULT 0,
  was_twin_question BOOLEAN DEFAULT false,
  twin_question_data JSONB DEFAULT '{}'::jsonb,
  feedback_notes TEXT DEFAULT '',
  attempted_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_retest_mistake ON public.mistake_retest_logs(mistake_id);
CREATE INDEX IF NOT EXISTS idx_retest_user ON public.mistake_retest_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_retest_created ON public.mistake_retest_logs(attempted_at DESC);

ALTER TABLE public.mistake_retest_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all access to mistake_retest_logs" ON public.mistake_retest_logs;
CREATE POLICY "Allow all access to mistake_retest_logs" ON public.mistake_retest_logs FOR ALL USING (true);

-- ----------------------------------------------------------------------------
-- 3. Automatic updated_at Trigger
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_mistake_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_mistake_updated_at ON public.student_mistakes;
CREATE TRIGGER trigger_mistake_updated_at
BEFORE UPDATE ON public.student_mistakes
FOR EACH ROW
EXECUTE FUNCTION public.handle_mistake_updated_at();

-- ----------------------------------------------------------------------------
-- 4. Ensure unlimited_mistake_retests exists on student_packages
-- ----------------------------------------------------------------------------
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'student_packages' 
    AND column_name = 'unlimited_mistake_retests'
  ) THEN
    ALTER TABLE public.student_packages ADD COLUMN unlimited_mistake_retests BOOLEAN NOT NULL DEFAULT false;
  END IF;
END $$;
