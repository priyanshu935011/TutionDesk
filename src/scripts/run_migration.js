import dotenv from "dotenv";

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY; // service_role key

// Extract project reference from URL
const projectRef = supabaseUrl.replace("https://", "").replace(".supabase.co", "");

console.log("Project Ref:", projectRef);

// Use the Supabase SQL API (v2) - requires Management API key, not service_role key
// But we can try the database REST API endpoint which is available in newer Supabase setups

async function runSQL(sql, description) {
  // Try the Supabase pg REST approach
  const url = `${supabaseUrl}/pg/query`;
  
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify({ query: sql }),
    });
    
    const responseText = await res.text();
    
    if (!res.ok) {
      console.error(`❌ [FAIL] ${description}: HTTP ${res.status} - ${responseText}`);
      return false;
    }
    
    console.log(`✅ [PASS] ${description}`);
    return true;
  } catch (err) {
    console.error(`❌ [FAIL] ${description}:`, err.message);
    return false;
  }
}

const migrations = [
  {
    description: "Add flexible_due_date to institutes",
    sql: `ALTER TABLE institutes ADD COLUMN IF NOT EXISTS flexible_due_date BOOLEAN DEFAULT false`,
  },
  {
    description: "Add lead_api_key to institutes",
    sql: `ALTER TABLE institutes ADD COLUMN IF NOT EXISTS lead_api_key TEXT DEFAULT ''`,
  },
  {
    description: "Add subscription_history to institutes",
    sql: `ALTER TABLE institutes ADD COLUMN IF NOT EXISTS subscription_history JSONB DEFAULT '[]'::jsonb`,
  },
];

async function runMigrations() {
  console.log("===========================================");
  console.log("Testing SQL endpoint availability...");
  console.log("===========================================\n");

  for (const { description, sql } of migrations) {
    await runSQL(sql, description);
  }
}

runMigrations().catch(console.error);
