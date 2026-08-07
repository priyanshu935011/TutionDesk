import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { clearCachePattern } from "../utils/cache.js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  try {
    const instituteId = "47d3edee-b327-48ed-8f1c-1ac35f08c976";

    // Find students
    const { data: students } = await supabase
      .from("students")
      .select("id, name")
      .eq("institute_id", instituteId);

    const studentIds = students.map(s => s.id);

    console.log(`Found ${students.length} students for Tiwari & son's Academy.`);

    // Query all payments in August 2026 for these students
    const { data: payments } = await supabase
      .from("payments")
      .select("*")
      .in("student_id", studentIds)
      .gte("payment_date", "2026-08-01T00:00:00")
      .lte("payment_date", "2026-08-31T23:59:59");

    console.log(`Found ${payments.length} August payments to remove.`);

    if (payments.length > 0) {
      const paymentIds = payments.map(p => p.id);
      
      const { error: deleteError } = await supabase
        .from("payments")
        .delete()
        .in("id", paymentIds);
        
      if (deleteError) throw deleteError;
      console.log(`Successfully deleted ${payments.length} payments.`);
    }

    // Clear cache
    const pattern = `teacher:students:${instituteId}:*`;
    await clearCachePattern(pattern);
    await clearCachePattern("teacher:dashboard:*");
    console.log("Cache cleared.");

  } catch (err) {
    console.error("Error:", err);
  } finally {
    process.exit(0);
  }
}

run();
