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

    console.log(`Dumping ${students.length} students:`);

    for (const student of students) {
      const { data: payments } = await supabase
        .from("payments")
        .select("*")
        .eq("student_id", student.id);

      const totalPaid = payments.reduce((sum, p) => sum + Number(p.amount), 0);
      const pending = Number(student.total_fees || 0) - totalPaid;

      const hasAugustPayment = payments.some(p => p.payment_date.startsWith("2026-08"));

      console.log(`Student: ${student.name} | Total Fees: ${student.total_fees} | Total Paid: ${totalPaid} | Pending: ${pending} | Has August Payment: ${hasAugustPayment}`);
    }
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}

run();
