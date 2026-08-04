import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const { data, error } = await supabase.from("students").select("*").limit(1);
  if (error) {
    console.error("Error fetching student:", error);
  } else if (data && data.length > 0) {
    console.log("Student keys:", Object.keys(data[0]));
    console.log("Full student object:", data[0]);
  } else {
    console.log("No student found");
  }
}

run();
