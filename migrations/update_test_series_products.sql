-- SQL migration for creating distinct test series for Product 02 and Product 04,
-- mapping past attempts to the purchased test series, and updating products and orders.

-- 1. Create Test Series 02 if not exists
INSERT INTO test_series (
  id, title, category, subject, topic, folder_path, is_published, is_global, duration_minutes, total_marks, passing_marks, difficulty, instructions, questions
) VALUES (
  'a02ac1de-0002-4000-8000-000000000002',
  'Class 10 Mathematics - Real Numbers Test 02',
  'Class 10',
  'Mathematics',
  'Real Numbers',
  '',
  true,
  true,
  60,
  25,
  10,
  'Medium',
  'Read all questions carefully. Choose the best option for multiple-choice questions. Time limit is 60 minutes.',
  '[{"id":"q_1","type":"single_choice","marks":1,"question":"The prime factorisation of 360 is:","options":[{"id":"opt_1","text":"2 × 3 × 5","imageUrl":""},{"id":"opt_2","text":"2² × 3² × 5","imageUrl":""},{"id":"opt_3","text":"2³ × 3² × 5","imageUrl":""},{"id":"opt_4","text":"2² × 3³ × 5","imageUrl":""}],"correctAnswers":["opt_3"],"explanation":"360 = 2³ × 3² × 5.","negativeMarks":0,"questionImageUrl":""}]'::jsonb
) ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  updated_at = NOW();

-- 2. Create Test Series 04 if not exists
INSERT INTO test_series (
  id, title, category, subject, topic, folder_path, is_published, is_global, duration_minutes, total_marks, passing_marks, difficulty, instructions, questions
) VALUES (
  'a02ac1de-0004-4000-8000-000000000004',
  'Class 10 Mathematics - Real Numbers Test 04',
  'Class 10',
  'Mathematics',
  'Real Numbers',
  '',
  true,
  true,
  60,
  25,
  10,
  'Medium',
  'Read all questions carefully. Choose the best option for multiple-choice questions. Time limit is 60 minutes.',
  '[{"id":"q_1","type":"single_choice","marks":1,"question":"(2 + √3)(2 - √3) is:","options":[{"id":"opt_1","text":"Rational","imageUrl":""},{"id":"opt_2","text":"Irrational","imageUrl":""},{"id":"opt_3","text":"Integer","imageUrl":""},{"id":"opt_4","text":"Imaginary","imageUrl":""}],"correctAnswers":["opt_1"],"explanation":"(2+√3)(2-√3) = 4 - 3 = 1 (rational).","negativeMarks":0,"questionImageUrl":""}]'::jsonb
) ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  updated_at = NOW();

-- 3. Update Product 02 and 04 test_series_ids mapping
UPDATE products 
SET test_series_ids = ARRAY['a02ac1de-0002-4000-8000-000000000002']::text[]
WHERE id = 'd02ac1de-f969-4c0e-bc20-e8951c7eacbe';

UPDATE products 
SET test_series_ids = ARRAY['a02ac1de-0004-4000-8000-000000000004']::text[]
WHERE id = '13270d86-d211-460b-b00a-797b70c0b5a5';

-- 4. Map the student's attempt to Test 02 so score, Retake, and AI analysis are active
UPDATE test_series_attempts
SET test_series_id = 'a02ac1de-0002-4000-8000-000000000002'
WHERE id = '2fe245bc-2f0d-4d24-870e-712278cc3387';
