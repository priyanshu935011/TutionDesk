import { createClient } from "@supabase/supabase-js";
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_KEY || "";
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log('CONNECTING TO SUPABASE...');
  
  // Try fetching one row from test_marks
  const { data: testMarks, error: err } = await supabase.from('test_marks').select('*').limit(1);
  if (err) {
    console.error('test_marks SELECT ERROR:', err);
  } else {
    console.log('test_marks row sample:', testMarks);
  }
}

main().catch(console.error);
