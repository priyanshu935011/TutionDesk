import "dotenv/config";
import Batch from "./src/models/Batch.js";
import User from "./src/models/User.js";

async function run() {
  try {
    const batches = await Batch.find({});
    const users = await User.find({});

    console.log("=== BATCHES IN DB ===");
    for (const b of batches) {
      console.log(`Batch: ${b.name} (${b._id}) | user: ${b.user} | status: ${b.status}`);
    }

    console.log("\n=== USERS IN DB ===");
    for (const u of users) {
      console.log(`User: ${u.email} (${u._id}) | role: ${u.role} | institute: ${u.institute}`);
    }

  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}

run();
