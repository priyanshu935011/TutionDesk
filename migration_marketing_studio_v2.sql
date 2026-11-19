-- ============================================================================
-- CLASSTECH MARKETING STUDIO V2.0 DATABASE MIGRATION
-- Multi-Tenant, Version-Controlled, Template-Driven Design Architecture
-- ============================================================================

-- 1. Marketing Categories (Database-driven categories replacing hardcoded enums)
CREATE TABLE IF NOT EXISTS marketing_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) NOT NULL UNIQUE,
    description TEXT DEFAULT '',
    icon VARCHAR(100) DEFAULT 'fi-rr-apps',
    thumbnail_url TEXT DEFAULT '',
    display_order INT DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_marketing_categories_slug ON marketing_categories(slug);
CREATE INDEX IF NOT EXISTS idx_marketing_categories_order ON marketing_categories(display_order ASC);
CREATE INDEX IF NOT EXISTS idx_marketing_categories_active ON marketing_categories(is_active);

-- Seed Default Categories
INSERT INTO marketing_categories (name, slug, description, icon, display_order, is_active)
VALUES
    ('Admissions Open', 'admissions', 'New academic session admission flyers and banners', 'fi-rr-graduation-cap', 1, TRUE),
    ('New Batches', 'new_batches', 'Upcoming target and foundation batch announcements', 'fi-rr-rocket-lunch', 2, TRUE),
    ('Results & Toppers', 'results', 'Rankers, high scores and felicitation posters', 'fi-rr-trophy', 3, TRUE),
    ('Festivals & Wishes', 'festivals', 'Festival greetings, national holidays and cultural events', 'fi-rr-party-horn', 4, TRUE),
    ('Faculty & Mentors', 'faculty', 'Teacher introductions and guest lecture flyers', 'fi-rr-user', 5, TRUE),
    ('Daily Quotes', 'quotes', 'Motivational thoughts and educational quotes', 'fi-rr-comment-quote', 6, TRUE),
    ('Offers & Discounts', 'offers', 'Early-bird discounts and scholarship announcements', 'fi-rr-sparkles', 7, TRUE),
    ('Announcements', 'announcements', 'Holiday notices, exam dates and workshop flyers', 'fi-rr-megaphone', 8, TRUE),
    ('Social Media & Status', 'social_media', 'Bite-sized graphics formatted for WhatsApp and Instagram stories', 'fi-rr-share', 9, TRUE)
ON CONFLICT (slug) DO NOTHING;

-- 2. Marketing Templates V2 (Master Template Metadata)
CREATE TABLE IF NOT EXISTS marketing_templates_v2 (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id UUID REFERENCES marketing_categories(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL UNIQUE,
    description TEXT DEFAULT '',
    aspect_ratio VARCHAR(20) NOT NULL DEFAULT '1:1', -- 1:1, 4:5, 9:16, 16:9
    canvas_width INT NOT NULL DEFAULT 1080,
    canvas_height INT NOT NULL DEFAULT 1080,
    thumbnail_url TEXT DEFAULT '',
    preview_url TEXT DEFAULT '',
    schema_version VARCHAR(20) NOT NULL DEFAULT '2.0',
    current_version_number INT NOT NULL DEFAULT 1,
    status VARCHAR(50) NOT NULL DEFAULT 'published', -- draft, published, archived
    is_featured BOOLEAN DEFAULT FALSE,
    priority INT DEFAULT 0,
    tags JSONB DEFAULT '[]'::jsonb,
    target_tiers JSONB DEFAULT '["all"]'::jsonb,
    default_share_caption TEXT DEFAULT 'Warm wishes from {institute.name}! For inquiries, contact: {institute.phone}.',
    created_by VARCHAR(255) DEFAULT 'super_admin',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mkt_templates_v2_category ON marketing_templates_v2(category_id);
CREATE INDEX IF NOT EXISTS idx_mkt_templates_v2_status ON marketing_templates_v2(status);
CREATE INDEX IF NOT EXISTS idx_mkt_templates_v2_priority ON marketing_templates_v2(priority DESC);
CREATE INDEX IF NOT EXISTS idx_mkt_templates_v2_aspect ON marketing_templates_v2(aspect_ratio);
CREATE INDEX IF NOT EXISTS idx_mkt_templates_v2_created_at ON marketing_templates_v2(created_at DESC);

-- 3. Marketing Template Versions (Immutable Version Snapshots)
CREATE TABLE IF NOT EXISTS marketing_template_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID NOT NULL REFERENCES marketing_templates_v2(id) ON DELETE CASCADE,
    version_number INT NOT NULL,
    template_json JSONB NOT NULL,
    preview_url TEXT DEFAULT '',
    publication_status VARCHAR(50) NOT NULL DEFAULT 'published', -- draft, published, archived
    change_summary TEXT DEFAULT '',
    published_by VARCHAR(255) DEFAULT 'super_admin',
    published_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_template_version UNIQUE (template_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_mkt_tpl_versions_template ON marketing_template_versions(template_id);
CREATE INDEX IF NOT EXISTS idx_mkt_tpl_versions_number ON marketing_template_versions(template_id, version_number DESC);

-- 4. Centralized Marketing Asset Library (Super Admin & Institute Shared Assets)
CREATE TABLE IF NOT EXISTS marketing_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_type VARCHAR(50) NOT NULL DEFAULT 'super_admin', -- super_admin, institute
    owner_id UUID, -- NULL for super_admin, institute_id for institute
    asset_name VARCHAR(255) NOT NULL,
    asset_type VARCHAR(50) NOT NULL DEFAULT 'background', -- background, illustration, icon, decoration, logo, photo
    storage_path TEXT NOT NULL,
    public_url TEXT NOT NULL,
    mime_type VARCHAR(100) DEFAULT 'image/png',
    file_size BIGINT DEFAULT 0,
    width INT,
    height INT,
    tags JSONB DEFAULT '[]'::jsonb,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_by VARCHAR(255) DEFAULT 'system',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mkt_assets_owner ON marketing_assets(owner_type, owner_id);
CREATE INDEX IF NOT EXISTS idx_mkt_assets_type ON marketing_assets(asset_type);
CREATE INDEX IF NOT EXISTS idx_mkt_assets_created ON marketing_assets(created_at DESC);

-- 5. Institute Marketing Designs (Persistent Cloud Storage for Institute Creatives)
CREATE TABLE IF NOT EXISTS institute_marketing_designs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institute_id UUID NOT NULL,
    template_id UUID NOT NULL REFERENCES marketing_templates_v2(id) ON DELETE RESTRICT,
    template_version_id UUID REFERENCES marketing_template_versions(id) ON DELETE RESTRICT,
    design_name VARCHAR(255) NOT NULL DEFAULT 'My Custom Design',
    design_json JSONB NOT NULL,
    branding_snapshot JSONB DEFAULT '{}'::jsonb,
    thumbnail_url TEXT DEFAULT '',
    preview_url TEXT DEFAULT '',
    status VARCHAR(50) NOT NULL DEFAULT 'draft', -- draft, saved, exported, archived
    revision_number INT NOT NULL DEFAULT 1,
    last_exported_at TIMESTAMPTZ,
    created_by UUID,
    updated_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inst_mkt_designs_inst ON institute_marketing_designs(institute_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_inst_mkt_designs_tpl ON institute_marketing_designs(template_id);
CREATE INDEX IF NOT EXISTS idx_inst_mkt_designs_status ON institute_marketing_designs(status);

-- 6. Marketing High-DPI Exports (Job Queue & Rendered Files)
CREATE TABLE IF NOT EXISTS marketing_exports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institute_id UUID NOT NULL,
    design_id UUID REFERENCES institute_marketing_designs(id) ON DELETE CASCADE,
    format VARCHAR(20) NOT NULL DEFAULT 'png', -- png, jpg, pdf
    resolution_dpi INT NOT NULL DEFAULT 300,
    canvas_preset VARCHAR(50) DEFAULT '1080x1080',
    storage_path TEXT DEFAULT '',
    public_url TEXT DEFAULT '',
    file_size BIGINT DEFAULT 0,
    status VARCHAR(50) NOT NULL DEFAULT 'processing', -- processing, ready, failed
    error_message TEXT DEFAULT '',
    requested_by UUID,
    expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 days'),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mkt_exports_inst ON marketing_exports(institute_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mkt_exports_design ON marketing_exports(design_id);
CREATE INDEX IF NOT EXISTS idx_mkt_exports_status ON marketing_exports(status);

-- 7. Marketing Template Usage Analytics
CREATE TABLE IF NOT EXISTS marketing_template_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institute_id UUID NOT NULL,
    template_id UUID NOT NULL REFERENCES marketing_templates_v2(id) ON DELETE CASCADE,
    template_version_id UUID REFERENCES marketing_template_versions(id) ON DELETE SET NULL,
    design_id UUID REFERENCES institute_marketing_designs(id) ON DELETE SET NULL,
    action VARCHAR(50) NOT NULL, -- view, select, edit, save_draft, export, share
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mkt_usage_tpl ON marketing_template_usage(template_id, action);
CREATE INDEX IF NOT EXISTS idx_mkt_usage_inst ON marketing_template_usage(institute_id, action);
CREATE INDEX IF NOT EXISTS idx_mkt_usage_created ON marketing_template_usage(created_at DESC);

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

ALTER TABLE marketing_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_templates_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_template_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE institute_marketing_designs ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_template_usage ENABLE ROW LEVEL SECURITY;

-- Categories & Templates: Publicly viewable if published / active
CREATE POLICY "Public read active categories" ON marketing_categories
    FOR SELECT USING (is_active = TRUE);

CREATE POLICY "Super admin full access categories" ON marketing_categories
    FOR ALL USING (auth.role() = 'service_role' OR auth.jwt() ->> 'role' = 'super_admin');

CREATE POLICY "Public read published templates" ON marketing_templates_v2
    FOR SELECT USING (status = 'published');

CREATE POLICY "Super admin full access templates" ON marketing_templates_v2
    FOR ALL USING (auth.role() = 'service_role' OR auth.jwt() ->> 'role' = 'super_admin');

CREATE POLICY "Public read template versions" ON marketing_template_versions
    FOR SELECT USING (publication_status = 'published');

CREATE POLICY "Super admin full access template versions" ON marketing_template_versions
    FOR ALL USING (auth.role() = 'service_role' OR auth.jwt() ->> 'role' = 'super_admin');

-- Institute Designs: Strict Tenant Isolation
CREATE POLICY "Institutes read own designs" ON institute_marketing_designs
    FOR SELECT USING (
        institute_id::text = auth.jwt() ->> 'institute_id' OR
        auth.role() = 'service_role' OR
        auth.jwt() ->> 'role' = 'super_admin'
    );

CREATE POLICY "Institutes insert own designs" ON institute_marketing_designs
    FOR INSERT WITH CHECK (
        institute_id::text = auth.jwt() ->> 'institute_id' OR
        auth.role() = 'service_role' OR
        auth.jwt() ->> 'role' = 'super_admin'
    );

CREATE POLICY "Institutes update own designs" ON institute_marketing_designs
    FOR UPDATE USING (
        institute_id::text = auth.jwt() ->> 'institute_id' OR
        auth.role() = 'service_role' OR
        auth.jwt() ->> 'role' = 'super_admin'
    );

CREATE POLICY "Institutes delete own designs" ON institute_marketing_designs
    FOR DELETE USING (
        institute_id::text = auth.jwt() ->> 'institute_id' OR
        auth.role() = 'service_role' OR
        auth.jwt() ->> 'role' = 'super_admin'
    );

-- Marketing Assets Isolation
CREATE POLICY "Read super admin assets and own institute assets" ON marketing_assets
    FOR SELECT USING (
        owner_type = 'super_admin' OR
        (owner_type = 'institute' AND owner_id::text = auth.jwt() ->> 'institute_id') OR
        auth.role() = 'service_role' OR
        auth.jwt() ->> 'role' = 'super_admin'
    );

CREATE POLICY "Institutes manage own assets" ON marketing_assets
    FOR ALL USING (
        (owner_type = 'institute' AND owner_id::text = auth.jwt() ->> 'institute_id') OR
        auth.role() = 'service_role' OR
        auth.jwt() ->> 'role' = 'super_admin'
    );

-- Exports Isolation
CREATE POLICY "Institutes view and manage own exports" ON marketing_exports
    FOR ALL USING (
        institute_id::text = auth.jwt() ->> 'institute_id' OR
        auth.role() = 'service_role' OR
        auth.jwt() ->> 'role' = 'super_admin'
    );

-- Template Usage
CREATE POLICY "Institutes log and read own usage" ON marketing_template_usage
    FOR ALL USING (
        institute_id::text = auth.jwt() ->> 'institute_id' OR
        auth.role() = 'service_role' OR
        auth.jwt() ->> 'role' = 'super_admin'
    );
