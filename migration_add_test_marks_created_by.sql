-- ==============================================================================
-- Migration: Add created_by column to test_marks table
-- Description:
--   Adds the missing created_by column to the public.test_marks table with
--   a foreign key reference to public.users(id).
-- ==============================================================================

-- 1. Add created_by UUID column referencing public.users
ALTER TABLE public.test_marks 
ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.users(id) ON DELETE SET NULL;

-- 2. Create index on created_by for fast querying by teacher/admin
CREATE INDEX IF NOT EXISTS idx_test_marks_created_by 
ON public.test_marks (created_by);

-- 3. Notify PostgREST schema cache to reload
NOTIFY pgrst, 'reload schema';
