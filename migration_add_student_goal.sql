-- ============================================================================
-- Migration: Add goal and target_goal columns to students table
-- ============================================================================

-- 1. Add goal and target_goal columns to students table if not present
ALTER TABLE students 
ADD COLUMN IF NOT EXISTS goal TEXT DEFAULT 'NEET';

ALTER TABLE students 
ADD COLUMN IF NOT EXISTS target_goal TEXT DEFAULT 'NEET';

-- 2. Create index on goal for fast querying and filtering
CREATE INDEX IF NOT EXISTS idx_students_goal ON students(goal);
CREATE INDEX IF NOT EXISTS idx_students_target_goal ON students(target_goal);

-- 3. Also add goal and target_goal to users table for consistency if needed
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS goal TEXT DEFAULT 'NEET';

ALTER TABLE users 
ADD COLUMN IF NOT EXISTS target_goal TEXT DEFAULT 'NEET';

-- 4. Comment on columns for schema documentation
COMMENT ON COLUMN students.goal IS 'Selected academic goal or target exam (e.g. NEET, JEE, Class 10, Class 12, UG Entrance)';
COMMENT ON COLUMN students.target_goal IS 'Alternative column for target academic goal';
