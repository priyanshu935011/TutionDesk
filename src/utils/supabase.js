import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || "https://placeholder.supabase.co";
const supabaseKey = process.env.SUPABASE_KEY || "placeholder_key";

export const supabase = createClient(supabaseUrl, supabaseKey);
export const supabaseBucket = process.env.SUPABASE_BUCKET || "notes";
