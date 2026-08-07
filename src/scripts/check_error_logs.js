import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  try {
    const { data: logs, error } = await supabase
      .from("error_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
      
    if (error) throw error;
    
    console.log(`Found ${logs.length} error logs:`);
    logs.forEach(l => {
      console.log(`[${l.created_at}] Message: ${l.message}`);
      if (l.context) console.log("Context:", JSON.stringify(l.context));
    });

  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}

run();
