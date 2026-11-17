-- ==============================================================================
-- Migration: Multi-Teacher Support for Batches & Staff Data Integrity
-- Description:
--   1. Enables multiple teachers to be assigned to the same batch (co-teachers).
--   2. Maintains 100% backward compatibility for existing app versions (teacher_id remains primary teacher).
--   3. Synchronizes assigned batches (JSONB on users table) and teacher_ids (UUID[] on batches table).
-- ==============================================================================

-- 1. Add teacher_ids UUID[] column to batches table if not existing
ALTER TABLE public.batches 
ADD COLUMN IF NOT EXISTS teacher_ids UUID[] DEFAULT '{}';

-- 2. Backfill existing teacher_id into teacher_ids array
UPDATE public.batches
SET teacher_ids = ARRAY[teacher_id]
WHERE teacher_id IS NOT NULL 
  AND (teacher_ids IS NULL OR cardinality(teacher_ids) = 0);

-- 3. Add staff columns to users table if not existing
ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS assigned_batches JSONB DEFAULT '[]'::jsonb;

ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS salary NUMERIC DEFAULT 0;

ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS staff_role TEXT DEFAULT 'Teacher';

ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS allowed_features TEXT[] DEFAULT '{}';

-- 4. Create GIN indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_batches_teacher_ids 
ON public.batches USING GIN (teacher_ids);

CREATE INDEX IF NOT EXISTS idx_users_assigned_batches 
ON public.users USING GIN (assigned_batches);

-- 5. Sync batches.teacher_ids from users.assigned_batches (JSONB) and existing batch teachers
UPDATE public.batches b
SET teacher_ids = ARRAY(
    SELECT DISTINCT u_id FROM (
        SELECT unnest(COALESCE(b.teacher_ids, '{}'::uuid[])) AS u_id
        UNION
        SELECT b.teacher_id AS u_id WHERE b.teacher_id IS NOT NULL
        UNION
        SELECT u.id AS u_id 
        FROM public.users u 
        WHERE u.assigned_batches IS NOT NULL 
          AND jsonb_typeof(u.assigned_batches) = 'array'
          AND u.assigned_batches ? b.id::text
    ) sub WHERE u_id IS NOT NULL
);

-- 6. Sync users.assigned_batches (JSONB) from batches.teacher_id and batches.teacher_ids
UPDATE public.users u
SET assigned_batches = (
    SELECT COALESCE(jsonb_agg(DISTINCT sub.b_id), '[]'::jsonb)
    FROM (
        SELECT b.id::text AS b_id FROM public.batches b WHERE b.teacher_id = u.id
        UNION
        SELECT b.id::text AS b_id FROM public.batches b WHERE b.teacher_ids IS NOT NULL AND u.id = ANY(b.teacher_ids)
        UNION
        SELECT jsonb_array_elements_text(u.assigned_batches) AS b_id 
        WHERE u.assigned_batches IS NOT NULL AND jsonb_typeof(u.assigned_batches) = 'array'
    ) sub
    WHERE sub.b_id IS NOT NULL
)
WHERE u.role IN ('teacher', 'receptionist');
