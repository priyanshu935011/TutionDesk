import "dotenv/config";

import Batch from "./src/models/Batch.js";
import User from "./src/models/User.js";
import Student from "./src/models/Student.js";

async function run() {
  try {
    console.log("Fetching batches from DB...");
    const batches = await Batch.find({});
    console.log("--- BATCHES ---");
    batches.forEach(b => {
      console.log({
        _id: b._id,
        name: b.name,
        user: b.user,
        status: b.status,
        scheduleDays: b.scheduleDays,
        startTime: b.startTime,
        endTime: b.endTime
      });
    });

    console.log("\nFetching users from DB...");
    const users = await User.find({});
    console.log("--- USERS ---");
    users.forEach(u => {
      console.log({
        _id: u._id,
        email: u.email,
        role: u.role,
        institute: u.institute
      });
    });

    console.log("\nFetching students from DB...");
    const students = await Student.find({});
    console.log("--- STUDENTS ---");
    students.forEach(s => {
      console.log({
        _id: s._id,
        name: s.name,
        batch: s.batch,
        user: s.user
      });
    });

  } catch (err) {
    console.error("Run error:", err);
  } finally {
    process.exit(0);
  }
}

run();
