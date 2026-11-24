-- ============================================================================
-- CLASSTECH AI FLASHCARDS & SMART REVISION SYSTEM - SUPABASE SCHEMA MIGRATION
-- Run this script in the Supabase SQL Editor (Dashboard -> SQL Editor -> New Query)
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. Flashcard Decks Table
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.flashcard_decks (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL,
  institute_id TEXT,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  subject TEXT NOT NULL DEFAULT 'General',
  chapter TEXT DEFAULT '',
  topic TEXT DEFAULT '',
  source_type TEXT DEFAULT 'ai_generated', -- 'upload_pdf', 'upload_file', 'paste_text', 'from_notes', 'chapter', 'manual'
  source_file_name TEXT DEFAULT '',
  source_file_url TEXT DEFAULT '',
  difficulty TEXT DEFAULT 'mixed', -- 'easy', 'medium', 'hard', 'mixed'
  card_types TEXT[] DEFAULT ARRAY['qa']::TEXT[],
  total_cards INT DEFAULT 0,
  mastered_cards INT DEFAULT 0,
  due_cards INT DEFAULT 0,
  last_studied_at TIMESTAMPTZ,
  is_public BOOLEAN DEFAULT false,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fc_decks_user ON public.flashcard_decks(user_id);
CREATE INDEX IF NOT EXISTS idx_fc_decks_inst ON public.flashcard_decks(institute_id);
CREATE INDEX IF NOT EXISTS idx_fc_decks_subject ON public.flashcard_decks(subject);
CREATE INDEX IF NOT EXISTS idx_fc_decks_created ON public.flashcard_decks(created_at DESC);

ALTER TABLE public.flashcard_decks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all access to flashcard_decks" ON public.flashcard_decks;
CREATE POLICY "Allow all access to flashcard_decks" ON public.flashcard_decks FOR ALL USING (true);

-- ----------------------------------------------------------------------------
-- 2. Flashcards Table (Individual Cards in a Deck)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.flashcards (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  deck_id TEXT NOT NULL REFERENCES public.flashcard_decks(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  explanation TEXT DEFAULT '',
  card_type TEXT DEFAULT 'qa', -- 'conceptual', 'definition', 'factual', 'formula', 'true_false', 'fill_blank', 'qa'
  difficulty TEXT DEFAULT 'medium', -- 'easy', 'medium', 'hard'
  topic TEXT DEFAULT '',
  source_page INT,
  source_excerpt TEXT DEFAULT '',
  position INT DEFAULT 0,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_flashcards_deck ON public.flashcards(deck_id);
CREATE INDEX IF NOT EXISTS idx_flashcards_pos ON public.flashcards(deck_id, position ASC);

ALTER TABLE public.flashcards ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all access to flashcards" ON public.flashcards;
CREATE POLICY "Allow all access to flashcards" ON public.flashcards FOR ALL USING (true);

-- ----------------------------------------------------------------------------
-- 3. Flashcard Progress Table (Spaced Repetition SM-2 per User per Card)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.flashcard_progress (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL,
  flashcard_id TEXT NOT NULL REFERENCES public.flashcards(id) ON DELETE CASCADE,
  deck_id TEXT NOT NULL REFERENCES public.flashcard_decks(id) ON DELETE CASCADE,
  state TEXT DEFAULT 'new', -- 'new', 'learning', 'reviewing', 'mastered', 'relearning'
  repetitions INT DEFAULT 0,
  interval_days NUMERIC(10, 2) DEFAULT 0,
  ease_factor NUMERIC(6, 3) DEFAULT 2.500,
  last_rating INT DEFAULT 0,
  next_review_at TIMESTAMPTZ DEFAULT NOW(),
  last_reviewed_at TIMESTAMPTZ,
  total_reviews INT DEFAULT 0,
  correct_reviews INT DEFAULT 0,
  consecutive_correct INT DEFAULT 0,
  is_bookmarked BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_user_flashcard UNIQUE (user_id, flashcard_id)
);

CREATE INDEX IF NOT EXISTS idx_fc_prog_user_deck ON public.flashcard_progress(user_id, deck_id);
CREATE INDEX IF NOT EXISTS idx_fc_prog_due ON public.flashcard_progress(user_id, next_review_at ASC);
CREATE INDEX IF NOT EXISTS idx_fc_prog_state ON public.flashcard_progress(user_id, state);
CREATE INDEX IF NOT EXISTS idx_fc_prog_bm ON public.flashcard_progress(user_id, is_bookmarked);

ALTER TABLE public.flashcard_progress ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all access to flashcard_progress" ON public.flashcard_progress;
CREATE POLICY "Allow all access to flashcard_progress" ON public.flashcard_progress FOR ALL USING (true);

-- ----------------------------------------------------------------------------
-- 4. Flashcard Review Events (Log of every recall rating)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.flashcard_reviews (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL,
  flashcard_id TEXT NOT NULL REFERENCES public.flashcards(id) ON DELETE CASCADE,
  deck_id TEXT NOT NULL REFERENCES public.flashcard_decks(id) ON DELETE CASCADE,
  session_id TEXT,
  rating INT NOT NULL, -- 1: Again, 2: Hard, 3: Good, 4: Easy
  rating_label TEXT DEFAULT 'Good',
  ease_factor NUMERIC(6, 3) DEFAULT 2.500,
  interval_days NUMERIC(10, 2) DEFAULT 1.0,
  time_taken_seconds INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fc_rev_user_deck ON public.flashcard_reviews(user_id, deck_id);
CREATE INDEX IF NOT EXISTS idx_fc_rev_created ON public.flashcard_reviews(created_at DESC);

ALTER TABLE public.flashcard_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all access to flashcard_reviews" ON public.flashcard_reviews;
CREATE POLICY "Allow all access to flashcard_reviews" ON public.flashcard_reviews FOR ALL USING (true);

-- ----------------------------------------------------------------------------
-- 5. Flashcard Study Sessions Table
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.flashcard_sessions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL,
  deck_id TEXT REFERENCES public.flashcard_decks(id) ON DELETE SET NULL,
  cards_reviewed INT DEFAULT 0,
  cards_again INT DEFAULT 0,
  cards_hard INT DEFAULT 0,
  cards_good INT DEFAULT 0,
  cards_easy INT DEFAULT 0,
  duration_seconds INT DEFAULT 0,
  accuracy_percent NUMERIC(5, 2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fc_sessions_user ON public.flashcard_sessions(user_id, created_at DESC);

ALTER TABLE public.flashcard_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all access to flashcard_sessions" ON public.flashcard_sessions;
CREATE POLICY "Allow all access to flashcard_sessions" ON public.flashcard_sessions FOR ALL USING (true);
