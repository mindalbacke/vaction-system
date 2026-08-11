ALTER TABLE employees ADD COLUMN IF NOT EXISTS pin_hash text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;

-- 최초 배포용 임시 PIN입니다. 로그인 후 운영 PIN으로 반드시 변경하세요.
UPDATE employees SET pin_hash = crypt('0000', gen_salt('bf')) WHERE pin_hash IS NULL;
UPDATE employees SET is_admin = true WHERE employee_number = '21004';

CREATE TABLE IF NOT EXISTS auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_token ON auth_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry ON auth_sessions(expires_at);

CREATE TABLE IF NOT EXISTS login_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_number text NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  successful boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_recent ON login_attempts(employee_number, attempted_at DESC);
