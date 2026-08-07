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

    const studentIds = students.map(s => s.id);

    const { data: payments } = await supabase
      .from("payments")
      .select("*")
      .in("student_id", studentIds);

    console.log(`Found ${payments.length} total payments for these students.`);
    payments.forEach(p => {
      const student = students.find(s => s.id === p.student_id);
      console.log(`Payment ID: ${p.id} | Student: ${student?.name} | Amount: ${p.amount} | Date: ${p.payment_date} | Type: ${p.payment_type} | Note: ${p.note}`);
    });

  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}

run();
