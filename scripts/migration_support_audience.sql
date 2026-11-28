-- ============================================================
-- ClassTech Support System: Audience & Target Role Expansion
-- Compatible with Supabase PostgreSQL SQL Editor
-- ============================================================

-- 1. Add audience column to support_faqs
ALTER TABLE IF EXISTS public.support_faqs
  ADD COLUMN IF NOT EXISTS audience VARCHAR(50) DEFAULT 'teacher';

CREATE INDEX IF NOT EXISTS idx_support_faqs_audience 
  ON public.support_faqs(audience);

-- 2. Add audience column to support_tutorials
ALTER TABLE IF EXISTS public.support_tutorials
  ADD COLUMN IF NOT EXISTS audience VARCHAR(50) DEFAULT 'teacher';

CREATE INDEX IF NOT EXISTS idx_support_tutorials_audience 
  ON public.support_tutorials(audience);

-- 3. Add target_role and audience columns to support_tickets
ALTER TABLE IF EXISTS public.support_tickets
  ADD COLUMN IF NOT EXISTS target_role VARCHAR(50) DEFAULT 'teacher',
  ADD COLUMN IF NOT EXISTS audience VARCHAR(50) DEFAULT 'teacher';

CREATE INDEX IF NOT EXISTS idx_support_tickets_target_role 
  ON public.support_tickets(target_role);

CREATE INDEX IF NOT EXISTS idx_support_tickets_audience 
  ON public.support_tickets(audience);

-- Set safe defaults for existing rows if null
UPDATE public.support_faqs SET audience = 'teacher' WHERE audience IS NULL;
UPDATE public.support_tutorials SET audience = 'teacher' WHERE audience IS NULL;
UPDATE public.support_tickets SET audience = 'teacher' WHERE audience IS NULL;
UPDATE public.support_tickets SET target_role = 'teacher' WHERE target_role IS NULL;
