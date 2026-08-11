ALTER TABLE relay_schedules ADD COLUMN IF NOT EXISTS cancelled boolean NOT NULL DEFAULT false;
ALTER TABLE daily_news_schedules ADD COLUMN IF NOT EXISTS cancelled boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON audit_logs(target_table, target_id);
CREATE INDEX IF NOT EXISTS idx_substitute_requests_status ON substitute_requests(status, start_datetime);
