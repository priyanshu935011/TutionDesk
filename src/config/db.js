import { createClient } from "@supabase/supabase-js";

const connectDB = async () => {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error("Missing SUPABASE_URL or SUPABASE_KEY in environment.");
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    console.log("Supabase Client initialized successfully.");
  } catch (error) {
    console.error("Supabase initialization failed:", error.message);
    process.exit(1);
  }
};

export default connectDB;
