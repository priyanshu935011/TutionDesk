import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import dotenv from "dotenv";

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || "https://placeholder.supabase.co";
const supabaseKey = process.env.SUPABASE_KEY || "placeholder_key";

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
  realtime: { transport: ws },
});
export const supabaseBucket = process.env.SUPABASE_BUCKET || "notes";
