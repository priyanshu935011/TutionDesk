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
    
    if (!institutes || institutes.length === 0) {
      console.log("No institute found");
      return;
    }
    const instituteId = institutes[0].id;
    console.log("Institute ID:", instituteId);

    const { data: students } = await supabase
      .from("students")
      .select("*")
      .eq("institute_id", instituteId);

    console.log(`Checking ${students.length} students...`);

    for (const student of students) {
      // Fetch payments
      const { data: payments } = await supabase
        .from("payments")
        .select("*")
        .eq("student_id", student.id);

      // Fetch attendance in August 2026
      const { data: attendance } = await supabase
        .from("attendance")
        .select("*")
        .eq("student_id", student.id)
        .gte("date", "2026-08-01")
        .lte("date", "2026-08-31");

      const totalPaid = payments.reduce((sum, p) => sum + Number(p.amount), 0);
      const pending = Number(student.total_fees || 0) - totalPaid;

      const hasAugustPayment = payments.some(p => p.payment_date.startsWith("2026-08"));
      const hasAugustAttendance = attendance.length > 0;

      if (pending > 0 && (hasAugustPayment || hasAugustAttendance)) {
        console.log(`!!! MATCH !!!`);
        console.log(`Student: ${student.name} (ID: ${student.id}, ENR: ${student.enrollment_number})`);
        console.log(`- Total Fees: ${student.total_fees}`);
        console.log(`- Total Paid: ${totalPaid}`);
        console.log(`- Calculated Pending: ${pending}`);
        console.log(`- Due Date: ${student.due_date}`);
        console.log(`- Has August Payment: ${hasAugustPayment}`);
        console.log(`- Has August Attendance: ${hasAugustAttendance} (${attendance.length} records)`);
        console.log("- Payments:");
        payments.forEach(p => {
          console.log(`  * Date: ${p.payment_date}, Amount: ${p.amount}, Type: ${p.payment_type}, Note: ${p.note}`);
        });
        console.log("- Attendance records in August:");
        attendance.forEach(a => {
          console.log(`  * Date: ${a.date}, Status: ${a.status}`);
        });
        console.log("-----------------------------------------");
      }
    }
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}

run();
