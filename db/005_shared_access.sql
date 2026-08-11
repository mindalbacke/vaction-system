-- 사이트 운영은 공동 모드로 유지하되 개인 휴가 PIN은 보존합니다.
UPDATE employees
SET is_admin = false, updated_at = now()
WHERE is_admin = true;

DELETE FROM auth_sessions;
DELETE FROM login_attempts;
