import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  try {
    const { data: institutes } = await supabase
      .from("institutes")
      .select("*")
      .ilike("name", "%Tiwari%");
    
    const instituteId = institutes[0].id;
    console.log("Institute ID:", instituteId);

    const { data: students } = await supabase
      .from("students")
      .select("*")
      .eq("institute_id", instituteId);

    for (const student of students) {
      // Fetch attendance in August 2026
      const { data: attendance } = await supabase
        .from("attendance")
        .select("*")
        .eq("student_id", student.id)
        .gte("date", "2026-08-01")
        .lte("date", "2026-08-31");

      const { data: payments } = await supabase
        .from("payments")
        .select("*")
        .eq("student_id", student.id);

      const totalPaid = payments.reduce((sum, p) => sum + Number(p.amount), 0);
      const pending = Number(student.total_fees || 0) - totalPaid;

      if (attendance.length > 0) {
        console.log(`Student: ${student.name} | Total Fees: ${student.total_fees} | Total Paid: ${totalPaid} | Pending: ${pending} | Attendance Records in August: ${attendance.length}`);
      }
    }
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}

run();
