import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  try {
    const instituteId = "47d3edee-b327-48ed-8f1c-1ac35f08c976";

    const { data: students } = await supabase
      .from("students")
      .select("*")
      .eq("institute_id", instituteId);

    console.log(`Dumping details for all 31 students of Tiwari & son's Academy:`);
    for (const s of students) {
      const { data: payments } = await supabase
        .from("payments")
        .select("*")
        .eq("student_id", s.id);

      const totalPaid = payments.reduce((sum, p) => sum + Number(p.amount), 0);
      const pending = Number(s.total_fees || 0) - totalPaid;

      console.log(`Student: ${s.name}`);
      console.log(`- Fee Plan: ${s.fee_plan_type}`);
      console.log(`- Joined On: ${s.joined_on}`);
      console.log(`- Due Date: ${s.due_date}`);
      console.log(`- Total Fees: ${s.total_fees}`);
      console.log(`- Total Paid: ${totalPaid}`);
      console.log(`- Pending: ${pending}`);
      console.log(`- Payments:`);
      payments.forEach(p => {
        console.log(`  * ID: ${p.id} | Amount: ${p.amount} | Date: ${p.payment_date} | Type: ${p.payment_type}`);
      });
      console.log("------------------------------------------------");
    }

  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}

run();
