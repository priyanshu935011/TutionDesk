import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

console.log("Supabase URL:", supabaseUrl);

const supabase = createClient(supabaseUrl, supabaseKey);

async function check(table) {
  const { data, error } = await supabase.from(table).select("*").limit(1);
  console.log(`Table "${table}":`, {
    success: !error,
    error: error ? { code: error.code, message: error.message } : null,
    rowCount: data ? data.length : 0
  });
}

async function run() {
  await check("institutes");
  await check("users");
  await check("batches");
  await check("students");
  await check("payments");
  await check("attendance");
  await check("notes");
  await check("leads");
  await check("quizzes");
  await check("quiz_attempts");
  await check("notices");
}

run();
