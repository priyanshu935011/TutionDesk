import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { clearCachePattern } from "../utils/cache.js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  try {
    const instituteId = "47d3edee-b327-48ed-8f1c-1ac35f08c976"; // Tiwari & son's Academy

    // 1. Get all students of this institute
    const { data: students, error: studError } = await supabase
      .from("students")
      .select("*")
      .eq("institute_id", instituteId);
      
    if (studError) throw studError;

    console.log(`Checking ${students.length} students...`);

    let fixedCount = 0;

    for (const student of students) {
      // Check attendance in August 2026
      const { data: attendance, error: attError } = await supabase
        .from("attendance")
        .select("*")
        .eq("student_id", student.id)
        .gte("date", "2026-08-01")
        .lte("date", "2026-08-31");
        
      if (attError) throw attError;

      if (attendance.length === 0) {
        continue; // No August attendance, skip
      }

      // Fetch existing payments
      const { data: payments, error: payError } = await supabase
        .from("payments")
        .select("*")
        .eq("student_id", student.id);
        
      if (payError) throw payError;

      const totalPaid = payments.reduce((sum, p) => sum + Number(p.amount), 0);
      const pending = Number(student.total_fees || 0) - totalPaid;

      if (pending > 0) {
        console.log(`Fixing student: ${student.name} | ENR: ${student.enrollment_number} | Pending: ${pending}`);
        
        // Record payment in Supabase payments table
        const paymentPayload = {
          student_id: student.id,
          amount: pending,
          payment_date: "2026-08-06T00:00:00.000Z",
          payment_type: student.fee_plan_type || "monthly",
          note: "Quick Monthly Payment"
        };
        
        const { error: insertError } = await supabase
          .from("payments")
          .insert(paymentPayload);
          
        if (insertError) throw insertError;
        
        fixedCount++;
      }
    }

    console.log(`Successfully recorded payments for ${fixedCount} students.`);

    // Clear cache
    const pattern = `teacher:students:${instituteId}:*`;
    console.log(`Evicting cache pattern: ${pattern}`);
    await clearCachePattern(pattern);
    await clearCachePattern("teacher:dashboard:*");
    console.log("Cache cleared.");

  } catch (err) {
    console.error("Error during execution:", err);
  } finally {
    process.exit(0);
  }
}

run();
