import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const { data, error } = await supabase.from("quizzes").select("*").limit(1);
  if (error) {
    console.error("Error reading quizzes:", error);
  } else {
    console.log("Quizzes columns:", data.length > 0 ? Object.keys(data[0]) : "No rows found");
  }
}

run();
