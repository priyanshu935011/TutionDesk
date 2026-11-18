-- =====================================================
-- ClassTech Multi-Branch Architecture Migration
-- Safe & Idempotent: Can be run multiple times safely
-- =====================================================

-- 1. Organizations Table
CREATE TABLE IF NOT EXISTS public.organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid()
);

-- Ensure all columns exist on organizations even if table already existed
ALTER TABLE public.organizations
    ADD COLUMN IF NOT EXISTS name TEXT DEFAULT '',
    ADD COLUMN IF NOT EXISTS owner_user UUID,
    ADD COLUMN IF NOT EXISTS owner_name TEXT DEFAULT '',
    ADD COLUMN IF NOT EXISTS admin_email TEXT DEFAULT '',
    ADD COLUMN IF NOT EXISTS admin_phone TEXT DEFAULT '',
    ADD COLUMN IF NOT EXISTS plan_type TEXT DEFAULT 'multi_branch_pro',
    ADD COLUMN IF NOT EXISTS max_branches INTEGER DEFAULT 10,
    ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active',
    ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;

-- Create indexes for organizations (only after columns are guaranteed to exist)
CREATE INDEX IF NOT EXISTS idx_organizations_owner_user ON public.organizations(owner_user);
CREATE INDEX IF NOT EXISTS idx_organizations_status ON public.organizations(status);

-- 2. Multi-Branch Columns on Institutes Table
ALTER TABLE public.institutes
    ADD COLUMN IF NOT EXISTS organization_id UUID,
    ADD COLUMN IF NOT EXISTS organization UUID,
    ADD COLUMN IF NOT EXISTS is_headquarters BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS branch_code TEXT DEFAULT '',
    ADD COLUMN IF NOT EXISTS city TEXT DEFAULT '',
    ADD COLUMN IF NOT EXISTS address TEXT DEFAULT '',
    ADD COLUMN IF NOT EXISTS parent_institute UUID;

-- Create indexes for institutes
CREATE INDEX IF NOT EXISTS idx_institutes_organization_id ON public.institutes(organization_id);
CREATE INDEX IF NOT EXISTS idx_institutes_parent_institute ON public.institutes(parent_institute);
CREATE INDEX IF NOT EXISTS idx_institutes_is_headquarters ON public.institutes(is_headquarters);

-- 3. User Branch Memberships Table
CREATE TABLE IF NOT EXISTS public.user_branch_memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid()
);

-- Ensure all columns exist on user_branch_memberships even if table already existed
ALTER TABLE public.user_branch_memberships
    ADD COLUMN IF NOT EXISTS user_id UUID,
    ADD COLUMN IF NOT EXISTS institute_id UUID,
    ADD COLUMN IF NOT EXISTS organization_id UUID,
    ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'staff',
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;

-- Create indexes for user_branch_memberships
CREATE INDEX IF NOT EXISTS idx_ubm_user ON public.user_branch_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_ubm_institute ON public.user_branch_memberships(institute_id);
CREATE INDEX IF NOT EXISTS idx_ubm_organization ON public.user_branch_memberships(organization_id);
