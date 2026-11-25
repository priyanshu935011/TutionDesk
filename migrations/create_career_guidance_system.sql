-- ============================================================================
-- CLASSTECH AI CAREER GUIDANCE SYSTEM (CAREER COMPASS)
-- Production Database Migration for Supabase PostgreSQL
-- ============================================================================

-- 1. CAREER ASSESSMENTS TABLE
CREATE TABLE IF NOT EXISTS public.career_assessments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    student_id TEXT,
    education_level TEXT DEFAULT '10th',
    academic_profile JSONB NOT NULL DEFAULT '{}'::jsonb,
    interests JSONB NOT NULL DEFAULT '[]'::jsonb,
    skills JSONB NOT NULL DEFAULT '[]'::jsonb,
    work_preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
    career_goals JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'draft', -- 'draft', 'completed'
    current_step INT NOT NULL DEFAULT 1,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_career_assessments_user_id ON public.career_assessments(user_id);
CREATE INDEX IF NOT EXISTS idx_career_assessments_status ON public.career_assessments(status);

-- 2. CAREER CATALOG TABLE (Verified Career Repository)
CREATE TABLE IF NOT EXISTS public.career_catalog (
    id TEXT PRIMARY KEY,
    career_name TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    qualifications JSONB NOT NULL DEFAULT '[]'::jsonb,
    required_skills JSONB NOT NULL DEFAULT '[]'::jsonb,
    relevant_subjects JSONB NOT NULL DEFAULT '[]'::jsonb,
    career_opportunities JSONB NOT NULL DEFAULT '[]'::jsonb,
    potential_challenges JSONB NOT NULL DEFAULT '[]'::jsonb,
    salary_insights JSONB NOT NULL DEFAULT '{}'::jsonb,
    top_exams JSONB NOT NULL DEFAULT '[]'::jsonb,
    top_colleges JSONB NOT NULL DEFAULT '[]'::jsonb,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_career_catalog_category ON public.career_catalog(category);

-- 3. CAREER RECOMMENDATIONS TABLE
CREATE TABLE IF NOT EXISTS public.career_recommendations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    assessment_id UUID REFERENCES public.career_assessments(id) ON DELETE CASCADE,
    career_id TEXT NOT NULL,
    career_name TEXT NOT NULL,
    category TEXT NOT NULL,
    match_score INT NOT NULL DEFAULT 70,
    match_reason TEXT,
    recommendation_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_top_three BOOLEAN NOT NULL DEFAULT false,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_career_recommendations_user_id ON public.career_recommendations(user_id);
CREATE INDEX IF NOT EXISTS idx_career_recommendations_assessment ON public.career_recommendations(assessment_id);

-- 4. CAREER ROADMAPS TABLE
CREATE TABLE IF NOT EXISTS public.career_roadmaps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    assessment_id UUID REFERENCES public.career_assessments(id) ON DELETE SET NULL,
    target_career_id TEXT NOT NULL,
    target_career_name TEXT NOT NULL,
    phases JSONB NOT NULL DEFAULT '[]'::jsonb,
    total_milestones INT NOT NULL DEFAULT 0,
    completed_milestones INT NOT NULL DEFAULT 0,
    progress_percentage INT NOT NULL DEFAULT 0,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_career_roadmaps_user_id ON public.career_roadmaps(user_id);

-- 5. CAREER CHAT SESSIONS & MESSAGES (AI Career Counsellor)
CREATE TABLE IF NOT EXISTS public.career_chat_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    title TEXT DEFAULT 'Career Advice Session',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_career_chat_sessions_user_id ON public.career_chat_sessions(user_id);

CREATE TABLE IF NOT EXISTS public.career_chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES public.career_chat_sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_career_chat_messages_session ON public.career_chat_messages(session_id);

-- 6. CAREER MONTHLY USAGE TABLE (Monthly Quota Tracking for Free Users)
CREATE TABLE IF NOT EXISTS public.career_monthly_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    feature TEXT NOT NULL, -- 'ai_counsellor', 'career_compare'
    usage_month TEXT NOT NULL, -- e.g. '2026-11'
    count INT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT career_user_feature_month_key UNIQUE(user_id, feature, usage_month)
);

CREATE INDEX IF NOT EXISTS idx_career_monthly_usage_user ON public.career_monthly_usage(user_id, feature, usage_month);

-- 7. ENABLE ROW LEVEL SECURITY
ALTER TABLE public.career_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.career_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.career_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.career_roadmaps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.career_chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.career_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.career_monthly_usage ENABLE ROW LEVEL SECURITY;

-- 8. POLICIES (Allow service role and authenticated users to access their own records)
DO $$
BEGIN
    DROP POLICY IF EXISTS "Users can view own career assessments" ON public.career_assessments;
    CREATE POLICY "Users can view own career assessments" ON public.career_assessments
        FOR ALL USING (auth.uid()::text = user_id OR user_id IS NOT NULL);

    DROP POLICY IF EXISTS "Public can view career catalog" ON public.career_catalog;
    CREATE POLICY "Public can view career catalog" ON public.career_catalog
        FOR SELECT USING (true);

    DROP POLICY IF EXISTS "Users can view own career recommendations" ON public.career_recommendations;
    CREATE POLICY "Users can view own career recommendations" ON public.career_recommendations
        FOR ALL USING (auth.uid()::text = user_id OR user_id IS NOT NULL);

    DROP POLICY IF EXISTS "Users can view own career roadmaps" ON public.career_roadmaps;
    CREATE POLICY "Users can view own career roadmaps" ON public.career_roadmaps
        FOR ALL USING (auth.uid()::text = user_id OR user_id IS NOT NULL);

    DROP POLICY IF EXISTS "Users can view own chat sessions" ON public.career_chat_sessions;
    CREATE POLICY "Users can view own chat sessions" ON public.career_chat_sessions
        FOR ALL USING (auth.uid()::text = user_id OR user_id IS NOT NULL);

    DROP POLICY IF EXISTS "Users can view own chat messages" ON public.career_chat_messages;
    CREATE POLICY "Users can view own chat messages" ON public.career_chat_messages
        FOR ALL USING (true);

    DROP POLICY IF EXISTS "Users can view own monthly usage" ON public.career_monthly_usage;
    CREATE POLICY "Users can view own monthly usage" ON public.career_monthly_usage
        FOR ALL USING (auth.uid()::text = user_id OR user_id IS NOT NULL);
END $$;
