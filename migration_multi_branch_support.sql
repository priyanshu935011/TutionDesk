-- =====================================================
-- ClassTech Multi-Branch Architecture Migration
-- Run this in Supabase SQL Editor if not already applied
-- =====================================================

-- 1. Organizations Table
CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    owner_user UUID REFERENCES users(id) ON DELETE SET NULL,
    owner_name VARCHAR(255) DEFAULT '',
    admin_email VARCHAR(255) DEFAULT '',
    admin_phone VARCHAR(50) DEFAULT '',
    plan_type VARCHAR(50) DEFAULT 'multi_branch_pro',
    max_branches INT DEFAULT 10,
    status VARCHAR(50) DEFAULT 'active',
    settings JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_organizations_owner_user ON organizations(owner_user);
CREATE INDEX IF NOT EXISTS idx_organizations_status ON organizations(status);

-- 2. Multi-Branch Columns on Institutes Table
ALTER TABLE institutes
ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS organization UUID REFERENCES organizations(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS is_headquarters BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS branch_code VARCHAR(100) DEFAULT '',
ADD COLUMN IF NOT EXISTS city VARCHAR(255) DEFAULT '',
ADD COLUMN IF NOT EXISTS address TEXT DEFAULT '',
ADD COLUMN IF NOT EXISTS parent_institute UUID REFERENCES institutes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_institutes_organization_id ON institutes(organization_id);
CREATE INDEX IF NOT EXISTS idx_institutes_parent_institute ON institutes(parent_institute);
CREATE INDEX IF NOT EXISTS idx_institutes_is_headquarters ON institutes(is_headquarters);

-- 3. User Branch Memberships Table
CREATE TABLE IF NOT EXISTS user_branch_memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    institute_id UUID NOT NULL REFERENCES institutes(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    role VARCHAR(50) DEFAULT 'staff',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ubm_user ON user_branch_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_ubm_institute ON user_branch_memberships(institute_id);
CREATE INDEX IF NOT EXISTS idx_ubm_organization ON user_branch_memberships(organization_id);
