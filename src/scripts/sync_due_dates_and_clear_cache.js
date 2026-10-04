import "dotenv/config";
import redisClient from "../config/redis.js";
import { clearCachePattern } from "../utils/cache.js";
import Student from "../models/Student.js";
import fs from "fs";
import path from "path";

async function run() {
  try {
    console.log("Connecting to Redis...");
    if (redisClient && !redisClient.isOpen) {
      await redisClient.connect().catch(e => console.log("Redis connect error:", e.message));
    }

    console.log("Clearing all dashboard and student cache patterns in Redis...");
    await clearCachePattern("teacher:dashboard:*").catch(() => {});
    await clearCachePattern("teacher:students:*").catch(() => {});
    await clearCachePattern("student:dashboard:*").catch(() => {});
    await clearCachePattern("student:sync:*").catch(() => {});

    console.log("Resyncing student_metadata.json with Supabase DB...");
    const fallbackDir = process.env.FALLBACK_DIR || path.join(process.cwd(), "scratch", "data");
    const studentMetadataFile = path.join(fallbackDir, "student_metadata.json");

    let metadata = {};
    if (fs.existsSync(studentMetadataFile)) {
      try {
        metadata = JSON.parse(fs.readFileSync(studentMetadataFile, "utf8"));
      } catch (e) {}
    }

    // Query students to trigger hydrateStudentData with new due_date logic
    const students = await Student.find({ isArchived: { $ne: true } });
    console.log(`Loaded ${students.length} students from Supabase DB.`);

    let updatedCount = 0;
    for (const s of students) {
      const sId = String(s._id || s.id);
      const dbDueDate = s.due_date || s.dueDate;
      if (dbDueDate && metadata[sId]) {
        metadata[sId].dueDate = dbDueDate;
        updatedCount++;
      }
    }

    fs.writeFileSync(studentMetadataFile, JSON.stringify(metadata, null, 2));
    console.log(`Successfully updated ${updatedCount} metadata entries with DB due_dates.`);
    console.log("All sync tasks completed successfully.");
  } catch (err) {
    console.error("Error running sync script:", err);
  } finally {
    process.exit(0);
  }
}

run();
