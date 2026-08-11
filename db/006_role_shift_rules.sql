-- 역할별 근무 규칙을 단순화합니다.
UPDATE shift_types
SET start_time = '13:00', end_time = '21:00', crosses_midnight = false,
    morning_leave_start = '13:00', morning_leave_end = '17:00',
    afternoon_leave_start = '17:00', afternoon_leave_end = '21:00',
    active = true, updated_at = now()
WHERE name = 'R';

UPDATE shift_types
SET afternoon_leave_start = NULL, afternoon_leave_end = NULL, updated_at = now()
WHERE name = 'U';

UPDATE shift_types SET active = false, updated_at = now() WHERE name = 'R1';
