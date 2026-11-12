-- ============================================================
-- DPDP Act 2023 Compliance & Data Retention Tables (Supabase / Postgres)
-- ============================================================

-- 1. Data Access & Processing Audit Logs (DPDP Rule 6: 1-year retention)
CREATE TABLE IF NOT EXISTS data_access_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id TEXT DEFAULT '',
    actor_role TEXT DEFAULT '',
    institute_id TEXT DEFAULT '',
    action TEXT NOT NULL,
    target_type TEXT DEFAULT '',
    target_id TEXT DEFAULT '',
    ip_masked TEXT DEFAULT '',
    details TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_data_access_logs_institute_id ON data_access_logs(institute_id);
CREATE INDEX IF NOT EXISTS idx_data_access_logs_created_at ON data_access_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_data_access_logs_action ON data_access_logs(action);


-- 2. DPDP Advance Deletion Notices (Rule 8: Mandatory 48-hour advance notice before erasure)
CREATE TABLE IF NOT EXISTS dpdp_retention_notices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target_type TEXT NOT NULL, -- student, lead, user
    target_id TEXT NOT NULL,
    institute_id TEXT DEFAULT '',
    reason TEXT DEFAULT 'purpose_fulfilled_inactivity',
    contact_masked TEXT DEFAULT '',
    notice_sent_at TIMESTAMPTZ DEFAULT NOW(),
    scheduled_erasure_at TIMESTAMPTZ NOT NULL,
    status TEXT DEFAULT 'notified', -- notified, cancelled, executed
    executed_at TIMESTAMPTZ DEFAULT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dpdp_retention_notices_status ON dpdp_retention_notices(status);
CREATE INDEX IF NOT EXISTS idx_dpdp_retention_notices_scheduled ON dpdp_retention_notices(scheduled_erasure_at);
CREATE INDEX IF NOT EXISTS idx_dpdp_retention_notices_target ON dpdp_retention_notices(target_type, target_id);


-- 3. Consent Records (DPDP Consent Architecture: itemized purpose-based consent)
CREATE TABLE IF NOT EXISTS consent_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    principal_type TEXT NOT NULL, -- user, student, parent, lead, contact
    principal_id TEXT DEFAULT '',
    identifier_hash TEXT DEFAULT '',
    institute_id TEXT DEFAULT '',
    purpose TEXT NOT NULL,
    granted BOOLEAN NOT NULL DEFAULT TRUE,
    notice_version TEXT DEFAULT '2026.11-v1',
    language TEXT DEFAULT 'en',
    method TEXT DEFAULT 'checkbox_web',
    parent_identifier TEXT DEFAULT '',
    granted_at TIMESTAMPTZ DEFAULT NOW(),
    withdrawn_at TIMESTAMPTZ DEFAULT NULL,
    ip_masked TEXT DEFAULT '',
    user_agent TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_consent_records_principal ON consent_records(principal_type, principal_id);
CREATE INDEX IF NOT EXISTS idx_consent_records_institute ON consent_records(institute_id);


-- 4. DPDP Grievance Redressal Tickets (Section 13: 30-day statutory SLA)
CREATE TABLE IF NOT EXISTS grievance_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_number TEXT UNIQUE NOT NULL,
    principal_type TEXT DEFAULT 'user',
    principal_id TEXT DEFAULT '',
    institute_id TEXT DEFAULT '',
    name TEXT DEFAULT '',
    email TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    category TEXT DEFAULT 'other',
    subject TEXT DEFAULT 'DPDP Data Rights Request',
    description TEXT NOT NULL,
    status TEXT DEFAULT 'open', -- open, in_progress, resolved, escalated
    resolution_notes TEXT DEFAULT '',
    assigned_officer TEXT DEFAULT 'Data Protection & Grievance Officer',
    sla_deadline TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days'),
    resolved_at TIMESTAMPTZ DEFAULT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_grievance_tickets_status ON grievance_tickets(status);
CREATE INDEX IF NOT EXISTS idx_grievance_tickets_institute ON grievance_tickets(institute_id);
