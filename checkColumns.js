import { supabase } from "./src/utils/supabaseModel.js";

async function test() {
  try {
    const { data, error } = await supabase.from("test_marks").select("*").limit(1);
    if (error) {
      console.error("Error fetching test_marks:", error);
    } else {
      console.log("test_marks columns in DB:", Object.keys(data[0] || {}));
    }
  } catch (err) {
    console.error("Exception:", err);
  }
}
test();
