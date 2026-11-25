-- ============================================================================
-- CLASSTECH AI DOUBT SOLVER & AI HARVEST TRAINING SYSTEM - SUPABASE SCHEMA
-- Run this script in the Supabase SQL Editor (Dashboard -> SQL Editor -> New Query)
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. Student Doubts Table (Question History, Solutions & Followup Threads)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.student_doubts (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL,
  institute_id TEXT,
  
  -- Question Content
  question_text TEXT NOT NULL,
  question_image_url TEXT DEFAULT '',
  subject TEXT NOT NULL DEFAULT 'General',
  chapter TEXT DEFAULT '',
  topic TEXT DEFAULT '',
  difficulty TEXT DEFAULT 'medium',
  
  -- AI Solution Output
  status TEXT DEFAULT 'solved', -- 'pending', 'solved', 'failed'
  solution_data JSONB DEFAULT '{}'::jsonb, 
  -- Example structure:
  -- {
  --   "givenParameters": "m = 2 kg, v = 10 m/s",
  --   "governingFormula": "KE = 1/2 m v^2",
  --   "steps": [{"title": "Step 1", "content": "...", "latex": "..."}],
  --   "finalAnswer": "KE = 100 Joules",
  --   "memoryTip": "Always verify mass is in kg and velocity in m/s",
  --   "commonPitfall": "Squaring the entire product instead of only velocity"
  -- }
  
  -- Interactive Followup Chat Thread
  followup_messages JSONB DEFAULT '[]'::jsonb,
  -- [{ "sender": "user"|"ai", "message": "...", "timestamp": "..." }]
  
  -- Integration & Bookmarks
  is_starred BOOLEAN DEFAULT false,
  is_added_to_mistake_book BOOLEAN DEFAULT false,
  mistake_id TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for lightning fast history filtering
CREATE INDEX IF NOT EXISTS idx_sd_user ON public.student_doubts(user_id);
CREATE INDEX IF NOT EXISTS idx_sd_inst ON public.student_doubts(institute_id);
CREATE INDEX IF NOT EXISTS idx_sd_subject ON public.student_doubts(subject);
CREATE INDEX IF NOT EXISTS idx_sd_created ON public.student_doubts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sd_starred ON public.student_doubts(user_id, is_starred);

-- Row Level Security (RLS)
ALTER TABLE public.student_doubts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all access to student_doubts" ON public.student_doubts;
CREATE POLICY "Allow all access to student_doubts" ON public.student_doubts FOR ALL USING (true);

-- ----------------------------------------------------------------------------
-- 2. AI Harvest Logs Table (Training Dataset Pipeline)
-- Stores all AI interactions (Doubt Solver, Mistake Diagnostics, Flashcards, Tutors)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_harvest_logs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  institute_id TEXT,
  user_id TEXT,
  user_role TEXT DEFAULT 'student',
  task_type TEXT NOT NULL, -- 'DOUBT_SOLVER', 'DOUBT_FOLLOWUP', 'MISTAKE_ROOT_CAUSE', 'MISTAKE_TWIN_QUESTION', 'AI_TUTOR', 'FLASHCARD_GEN'
  prompt TEXT DEFAULT '',
  response TEXT DEFAULT '',
  generated_content JSONB DEFAULT '{}'::jsonb,
  metadata JSONB DEFAULT '{}'::jsonb,
  credits_deducted NUMERIC(10, 4) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_harvest_task ON public.ai_harvest_logs(task_type);
CREATE INDEX IF NOT EXISTS idx_harvest_user ON public.ai_harvest_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_harvest_created ON public.ai_harvest_logs(created_at DESC);

ALTER TABLE public.ai_harvest_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all access to ai_harvest_logs" ON public.ai_harvest_logs;
CREATE POLICY "Allow all access to ai_harvest_logs" ON public.ai_harvest_logs FOR ALL USING (true);

-- Alias view for ai_harvest
CREATE OR REPLACE VIEW public.ai_harvest AS SELECT * FROM public.ai_harvest_logs;

-- ----------------------------------------------------------------------------
-- 3. Automatic updated_at Trigger
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_doubt_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_doubt_updated_at ON public.student_doubts;
CREATE TRIGGER trigger_doubt_updated_at
BEFORE UPDATE ON public.student_doubts
FOR EACH ROW
EXECUTE FUNCTION public.handle_doubt_updated_at();
