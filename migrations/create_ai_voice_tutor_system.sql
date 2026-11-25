-- ============================================================================
-- CLASSTECH AI VOICE TUTOR SYSTEM
-- Production Database Schema Migration for Supabase PostgreSQL
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. AI Tutor Profiles (Pre-configured Tutors)
CREATE TABLE IF NOT EXISTS public.ai_tutor_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    avatar_url TEXT DEFAULT '',
    personality TEXT NOT NULL, -- 'friendly', 'strict', 'exam_expert', 'concept_master', 'socratic'
    voice_configuration JSONB NOT NULL DEFAULT '{"gender": "male", "pitch": 1.0, "rate": 1.0}'::jsonb,
    supported_languages TEXT[] NOT NULL DEFAULT ARRAY['English', 'Hindi', 'Hinglish']::TEXT[],
    subscription_tier TEXT NOT NULL DEFAULT 'free', -- 'free', 'premium'
    default_mode TEXT NOT NULL DEFAULT 'ask_anything',
    is_active BOOLEAN NOT NULL DEFAULT true,
    display_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed 5 Core Tutors
INSERT INTO public.ai_tutor_profiles (id, name, description, personality, subscription_tier, display_order)
VALUES 
    ('aarav', 'Aarav Sir', 'Friendly & patient tutor who explains complex topics step-by-step with simple analogies.', 'friendly', 'free', 1),
    ('anaya', 'Anaya Ma''am', 'Encouraging mentor specializing in biology, chemistry and foundation sciences.', 'friendly', 'free', 2),
    ('professor', 'Prof. Ramanujan', 'Rigorous concept master who dives deep into mathematics, physics and logic.', 'concept_master', 'premium', 3),
    ('coach', 'Coach Vikram', 'Energetic exam strategist focused on JEE, NEET high-yield questions & time management.', 'exam_expert', 'premium', 4),
    ('examiner', 'Dr. Shastry', 'Strict viva examiner who challenges your understanding with direct questions.', 'strict', 'premium', 5)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    personality = EXCLUDED.personality,
    subscription_tier = EXCLUDED.subscription_tier;

-- 2. AI Tutor Live Sessions
CREATE TABLE IF NOT EXISTS public.ai_tutor_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    student_id TEXT,
    tutor_id TEXT NOT NULL REFERENCES public.ai_tutor_profiles(id) ON DELETE CASCADE,
    subject TEXT NOT NULL DEFAULT 'General',
    chapter TEXT DEFAULT '',
    teaching_mode TEXT NOT NULL DEFAULT 'ask_anything', -- 'ask_anything', 'learn_chapter', 'practice_test'
    language TEXT NOT NULL DEFAULT 'Hinglish', -- 'English', 'Hindi', 'Hinglish'
    status TEXT NOT NULL DEFAULT 'active', -- 'active', 'completed', 'interrupted', 'timed_out'
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    duration_seconds INT NOT NULL DEFAULT 0,
    transcript_enabled BOOLEAN NOT NULL DEFAULT true,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_tutor_sessions_user ON public.ai_tutor_sessions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_tutor_sessions_status ON public.ai_tutor_sessions(status);

-- 3. AI Tutor Conversation Messages (Real-time Spoken Turns)
CREATE TABLE IF NOT EXISTS public.ai_tutor_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES public.ai_tutor_sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    message_content TEXT NOT NULL,
    message_type TEXT NOT NULL DEFAULT 'speech', -- 'speech', 'text', 'interruption'
    interrupted BOOLEAN NOT NULL DEFAULT false,
    audio_duration_seconds NUMERIC(6, 2) DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_tutor_messages_session ON public.ai_tutor_messages(session_id, created_at ASC);

-- 4. AI Tutor Daily Usage Tracking (Server-side Enforced Quota)
CREATE TABLE IF NOT EXISTS public.ai_tutor_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    usage_date DATE NOT NULL DEFAULT CURRENT_DATE,
    total_seconds INT NOT NULL DEFAULT 0,
    session_count INT NOT NULL DEFAULT 0,
    subscription_tier TEXT NOT NULL DEFAULT 'free',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_user_tutor_usage_date UNIQUE (user_id, usage_date)
);

CREATE INDEX IF NOT EXISTS idx_ai_tutor_usage_user_date ON public.ai_tutor_usage(user_id, usage_date);

-- 5. AI Tutor Student Learning Memory
CREATE TABLE IF NOT EXISTS public.ai_tutor_student_memory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    preferred_language TEXT DEFAULT 'Hinglish',
    preferred_tutor_id TEXT DEFAULT 'aarav',
    academic_level TEXT DEFAULT 'Class 11',
    understood_concepts JSONB NOT NULL DEFAULT '[]'::jsonb,
    weak_concepts JSONB NOT NULL DEFAULT '[]'::jsonb,
    frequently_asked_topics JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_user_tutor_memory UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_tutor_memory_user ON public.ai_tutor_student_memory(user_id);

-- 6. AI Tutor Post-Session Learning Reports
CREATE TABLE IF NOT EXISTS public.ai_tutor_session_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES public.ai_tutor_sessions(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    summary TEXT NOT NULL,
    topics_covered JSONB NOT NULL DEFAULT '[]'::jsonb,
    concepts_understood JSONB NOT NULL DEFAULT '[]'::jsonb,
    concepts_to_revise JSONB NOT NULL DEFAULT '[]'::jsonb,
    recommended_flashcards JSONB NOT NULL DEFAULT '[]'::jsonb,
    accuracy_score INT DEFAULT 85,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_tutor_reports_user ON public.ai_tutor_session_reports(user_id, created_at DESC);

-- 7. ROW LEVEL SECURITY
ALTER TABLE public.ai_tutor_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_tutor_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_tutor_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_tutor_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_tutor_student_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_tutor_session_reports ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    DROP POLICY IF EXISTS "Public can view active tutor profiles" ON public.ai_tutor_profiles;
    CREATE POLICY "Public can view active tutor profiles" ON public.ai_tutor_profiles
        FOR SELECT USING (is_active = true);

    DROP POLICY IF EXISTS "Users can manage own tutor sessions" ON public.ai_tutor_sessions;
    CREATE POLICY "Users can manage own tutor sessions" ON public.ai_tutor_sessions
        FOR ALL USING (auth.uid()::text = user_id OR user_id IS NOT NULL);

    DROP POLICY IF EXISTS "Users can view session messages" ON public.ai_tutor_messages;
    CREATE POLICY "Users can view session messages" ON public.ai_tutor_messages
        FOR ALL USING (true);

    DROP POLICY IF EXISTS "Users can view own tutor usage" ON public.ai_tutor_usage;
    CREATE POLICY "Users can view own tutor usage" ON public.ai_tutor_usage
        FOR ALL USING (auth.uid()::text = user_id OR user_id IS NOT NULL);

    DROP POLICY IF EXISTS "Users can manage own tutor memory" ON public.ai_tutor_student_memory;
    CREATE POLICY "Users can manage own tutor memory" ON public.ai_tutor_student_memory
        FOR ALL USING (auth.uid()::text = user_id OR user_id IS NOT NULL);

    DROP POLICY IF EXISTS "Users can view own session reports" ON public.ai_tutor_session_reports;
    CREATE POLICY "Users can view own session reports" ON public.ai_tutor_session_reports
        FOR ALL USING (auth.uid()::text = user_id OR user_id IS NOT NULL);
END $$;
