-- ==============================================================================
-- Migration: Autonomous AI Agents System & Agent Staged Test Series
-- Description:
--   Creates staging table for agent-generated test series (agent_test_series),
--   state configuration and telemetry table for autonomous agents (agent_state_configs),
--   indices for status/hierarchy filtering, and reloads PostgREST schema cache.
-- ==============================================================================

-- 1. Create Staging Table for Agent Test Series
CREATE TABLE IF NOT EXISTS public.agent_test_series (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  category TEXT NOT NULL DEFAULT 'General',
  subject TEXT NOT NULL DEFAULT 'General',
  topic TEXT NOT NULL DEFAULT 'General',
  difficulty TEXT NOT NULL DEFAULT 'Medium', -- 'Easy', 'Medium', 'Hard'
  duration_minutes INT DEFAULT 60,
  total_marks INT DEFAULT 100,
  passing_marks INT DEFAULT 40,
  instructions TEXT DEFAULT '',
  questions JSONB DEFAULT '[]'::jsonb,
  source_info JSONB DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending_review', -- 'pending_review', 'approved', 'rejected'
  promoted_test_id UUID REFERENCES public.test_series(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  reviewed_by TEXT,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indices for fast staging lookups and duplicate checks
CREATE INDEX IF NOT EXISTS idx_agent_test_series_status 
  ON public.agent_test_series(status);

CREATE INDEX IF NOT EXISTS idx_agent_test_series_cat_subj_topic 
  ON public.agent_test_series(category, subject, topic, difficulty);

CREATE INDEX IF NOT EXISTS idx_agent_test_series_created 
  ON public.agent_test_series(created_at DESC);

-- 2. Create Agent State & Rate Limit Telemetry Table
CREATE TABLE IF NOT EXISTS public.agent_state_configs (
  agent_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  is_running BOOLEAN DEFAULT FALSE,
  config JSONB DEFAULT '{
    "intervalSeconds": 45,
    "rateLimitPerHour": 15,
    "maxConsecutiveErrors": 3,
    "preferredModel": "gemini-3.5-flash",
    "categories": [
      "Class 10",
      "Class 11",
      "Class 12",
      "JEE Main & Advanced",
      "NEET",
      "CUET",
      "Bank & SSC",
      "Foundation",
      "Olympiad"
    ],
    "questionsCount": 15
  }'::jsonb,
  state JSONB DEFAULT '{
    "currentCategory": "",
    "currentSubject": "",
    "currentTopic": "",
    "currentDifficulty": "Medium",
    "totalGenerated": 0,
    "totalApproved": 0,
    "lastGeneratedTitle": ""
  }'::jsonb,
  logs JSONB DEFAULT '[]'::jsonb,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  runs_this_hour INT DEFAULT 0,
  hour_window_start TIMESTAMPTZ DEFAULT NOW(),
  consecutive_errors INT DEFAULT 0,
  circuit_breaker_tripped BOOLEAN DEFAULT FALSE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Seed Default State for Test Series Synthesizer Agent if not exists
INSERT INTO public.agent_state_configs (
  agent_id,
  name,
  is_running,
  config,
  state,
  logs
) VALUES (
  'test_series_agent',
  'Autonomous Test Series Synthesizer',
  false,
  '{
    "intervalSeconds": 45,
    "rateLimitPerHour": 15,
    "maxConsecutiveErrors": 3,
    "preferredModel": "gemini-3.5-flash",
    "categories": [
      "Class 10",
      "Class 11",
      "Class 12",
      "JEE Main & Advanced",
      "NEET",
      "CUET",
      "Bank & SSC",
      "Foundation",
      "Olympiad"
    ],
    "questionsCount": 15
  }'::jsonb,
  '{
    "currentCategory": "JEE Main & Advanced",
    "currentSubject": "Physics",
    "currentTopic": "Electrostatics",
    "currentDifficulty": "Medium",
    "totalGenerated": 0,
    "totalApproved": 0,
    "lastGeneratedTitle": ""
  }'::jsonb,
  '[]'::jsonb
) ON CONFLICT (agent_id) DO NOTHING;

-- 4. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
