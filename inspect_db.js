import { createClient } from "@supabase/supabase-js";
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_KEY || "";
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log('CONNECTING TO SUPABASE...');
  
  // Fetch users
  const { data: users, error: userErr } = await supabase.from('users').select('id, email, role, name').limit(10);
  if (userErr) console.error('USER FETCH ERROR:', userErr);
  else console.log('USERS:', users);

  // Fetch batches
  const { data: batches, error: batchErr } = await supabase.from('batches').select('id, name, class_name').limit(10);
  if (batchErr) console.error('BATCH FETCH ERROR:', batchErr);
  else console.log('BATCHES:', batches);

  // Fetch students
  const { data: students, error: studentErr } = await supabase.from('students').select('id, name, enrollment_number').limit(10);
  if (studentErr) console.error('STUDENTS FETCH ERROR:', studentErr);
  else console.log('STUDENTS:', students);
}

main().catch(console.error);
