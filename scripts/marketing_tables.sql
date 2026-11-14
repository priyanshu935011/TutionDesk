-- ============================================================
-- ClassTech Marketing & Posters System (Supabase / PostgreSQL)
-- Table: marketing_templates
-- ============================================================

CREATE TABLE IF NOT EXISTS marketing_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    category VARCHAR(100) NOT NULL DEFAULT 'poster', -- poster, pamphlet, admission_form, daily_quotes, festival, result, offer
    aspect_ratio VARCHAR(20) NOT NULL DEFAULT '1:1',  -- 1:1, 9:16, 4:5, 16:9
    image_url TEXT NOT NULL DEFAULT '',
    story_image_url TEXT DEFAULT '',
    thumbnail_url TEXT DEFAULT '',
    branding_config JSONB DEFAULT '{}'::jsonb,
    branding_positions JSONB DEFAULT '{"square": {"logo": {"x": 6, "y": 6, "width": 16, "height": 16, "isVisible": false}, "instituteName": {"x": 25, "y": 7, "fontSize": 18, "color": "#0F172A", "isVisible": false}, "phone": {"x": 6, "y": 88, "fontSize": 14, "color": "#D97706", "isVisible": false}, "address": {"x": 6, "y": 93, "fontSize": 12, "color": "#334155", "isVisible": false}}, "story": {"logo": {"x": 6, "y": 5, "width": 18, "height": 12, "isVisible": false}, "instituteName": {"x": 26, "y": 6, "fontSize": 20, "color": "#0F172A", "isVisible": false}, "phone": {"x": 6, "y": 90, "fontSize": 15, "color": "#D97706", "isVisible": false}, "address": {"x": 6, "y": 94, "fontSize": 12, "color": "#334155", "isVisible": false}}}'::jsonb,
    canvas_data JSONB DEFAULT '{"bgType": "solid", "bgFill": "#FFFFFF", "elements": []}'::jsonb,
    is_active BOOLEAN DEFAULT TRUE,
    priority INT DEFAULT 0,
    start_date TIMESTAMPTZ,
    end_date TIMESTAMPTZ,
    default_share_caption TEXT DEFAULT 'Warm wishes from {instituteName}! Contact us at {phone}.',
    stats JSONB DEFAULT '{"views": 0, "shares": 0, "downloads": 0}'::jsonb,
    target_tiers JSONB DEFAULT '[]'::jsonb,
    created_by VARCHAR(255) DEFAULT 'super_admin',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_marketing_templates_category ON marketing_templates(category);
CREATE INDEX IF NOT EXISTS idx_marketing_templates_is_active ON marketing_templates(is_active);
CREATE INDEX IF NOT EXISTS idx_marketing_templates_priority ON marketing_templates(priority DESC);
CREATE INDEX IF NOT EXISTS idx_marketing_templates_created_at ON marketing_templates(created_at DESC);

-- Optional Row Level Security (RLS) Configuration:
-- ALTER TABLE marketing_templates ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "Public read for active templates" ON marketing_templates FOR SELECT USING (true);
-- CREATE POLICY "Service role full access" ON marketing_templates FOR ALL USING (true);
