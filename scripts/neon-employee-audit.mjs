import { neon } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL이 설정되지 않았습니다.");

const sql = neon(process.env.DATABASE_URL);
const rows = await sql.query(
  `SELECT target_id::text, action_type,
    before_data->>'name' AS before_name,
    before_data->>'role' AS before_role,
    before_data->>'active' AS before_active,
    after_data->>'name' AS after_name,
    after_data->>'role' AS after_role,
    after_data->>'active' AS after_active,
    created_at::text
  FROM audit_logs
  WHERE target_table = 'employees'
  ORDER BY created_at DESC
  LIMIT 100`,
  [],
);

console.log(JSON.stringify(rows));
