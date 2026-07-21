import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Error: Missing SUPABASE_URL or SUPABASE_KEY in environment variables.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Maps for MongoDB ObjectID -> Supabase UUID
const idMap = new Map();
const adminToInstituteMap = new Map();
const studentToBatchMap = new Map();

function getUuid(oid) {
  if (!oid) return null;
  if (typeof oid === "object" && oid.$oid) {
    oid = oid.$oid;
  }
  if (typeof oid !== "string") return null;
  if (oid.length === 36 && oid.includes("-")) return oid;
  if (idMap.has(oid)) {
    return idMap.get(oid);
  }
  const newUuid = randomUUID();
  idMap.set(oid, newUuid);
  return newUuid;
}

// Custom parser for SQL INSERT values containing escaped single quotes and JSON strings
function parseValues(valStr) {
  const vals = [];
  let inQuote = false;
  let current = "";
  
  const cleanStr = valStr.trim().replace(/^\(/, "").replace(/\);?$/, "");
  
  for (let i = 0; i < cleanStr.length; i++) {
    const char = cleanStr[i];
    if (inQuote) {
      if (char === "'") {
        if (cleanStr[i + 1] === "'") {
          current += "'";
          i++; // Skip the second quote
        } else {
          inQuote = false;
          vals.push(current);
          current = "";
        }
      } else {
        current += char;
      }
    } else {
      if (char === "'") {
        inQuote = true;
      } else if (char === ",") {
        if (current.trim() !== "") {
          vals.push(current.trim());
          current = "";
        }
      } else if (char.trim() !== "") {
        current += char;
      }
    }
  }
  if (current.trim() !== "") {
    vals.push(current.trim());
  }
  return vals;
}

async function migrate() {
  console.log("Checking Supabase connection and tables...");
  
  const { error: checkError } = await supabase.from("institutes").select("id").limit(1);
  if (checkError && (checkError.code === "42P01" || checkError.message?.includes("does not exist"))) {
    console.error("\n========================================================");
    console.error("ERROR: The database tables have not been created yet in Supabase.");
    console.error("Please copy the contents of the 'schema.sql' file (in the project root directory)");
    console.error("and execute it in the Supabase SQL Editor first, then run this script again.");
    console.error("========================================================\n");
    process.exit(1);
  }

  console.log("Starting DB migration from seed file...");
  
  const seedPath = path.join(process.cwd(), "coaching_crm_seed.sql");
  if (!fs.existsSync(seedPath)) {
    console.error(`Error: Seed file not found at ${seedPath}`);
    return;
  }

  const fileContent = fs.readFileSync(seedPath, "utf8");
  const lines = fileContent.split(/\r?\n/);

  const rawData = {
    institutes: [],
    users: [],
    batches: [],
    students: [],
    notes: [],
    systemmetrics: [],
    testresults: []
  };

  console.log("Parsing seed SQL file...");
  for (const line of lines) {
    if (!line.startsWith("INSERT INTO")) continue;

    const tableMatch = line.match(/INSERT INTO "([^"]+)"/);
    if (!tableMatch) continue;
    const rawTableName = tableMatch[1];
    
    // Normalize table names to group
    let groupTable = rawTableName;
    if (rawTableName === "systemmetrics") groupTable = "systemmetrics";
    else if (rawTableName === "testresults") groupTable = "testresults";

    const colsMatch = line.match(/\(([^)]+)\) VALUES/);
    if (!colsMatch) continue;
    const cols = colsMatch[1].split(",").map(c => c.trim().replace(/"/g, ""));

    const valuesPart = line.substring(line.indexOf("VALUES") + 7);
    const parsedVals = parseValues(valuesPart);

    const rawDoc = {};
    cols.forEach((col, idx) => {
      let val = parsedVals[idx];
      if (val === "NULL" || val === undefined) {
        rawDoc[col] = null;
      } else if (val === "FALSE") {
        rawDoc[col] = false;
      } else if (val === "TRUE") {
        rawDoc[col] = true;
      } else {
        // Handle strings
        if (val.startsWith("'") && val.endsWith("'")) {
          val = val.slice(1, -1);
        }
        val = val.replace(/\\'/g, "'").replace(/''/g, "'");
        
        try {
          if (val.startsWith("{") || val.startsWith("[")) {
            rawDoc[col] = JSON.parse(val);
          } else {
            rawDoc[col] = val;
          }
        } catch {
          rawDoc[col] = val;
        }
      }
    });

    if (rawData[groupTable]) {
      rawData[groupTable].push(rawDoc);
    }
  }

  console.log(`Parsed totals:`);
  Object.keys(rawData).forEach(k => {
    console.log(` - ${k}: ${rawData[k].length} items`);
  });

  // 0. Clear existing database records
  console.log("\nClearing existing database records for clean migration...");
  const tablesToClear = [
    "system_metrics",
    "test_marks",
    "notes",
    "attendance",
    "payments",
    "students",
    "batches",
    "users",
    "institutes"
  ];
  for (const table of tablesToClear) {
    try {
      await supabase.from(table).delete().neq("id", "00000000-0000-0000-0000-000000000000");
    } catch (e) {
      // Table may not exist yet, ignore
    }
  }

  // 1. Migrate Institutes
  console.log("\nMigrating Institutes...");
  const institutesToInsert = [];
  for (const inst of rawData.institutes) {
    const id = getUuid(inst._id);
    const adminUserOid = inst.adminUser?.$oid || inst.adminUser;
    if (adminUserOid) {
      adminToInstituteMap.set(adminUserOid, id);
    }
    
    institutesToInsert.push({
      id,
      name: inst.name,
      slug: inst.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
      logo_url: inst.logoUrl || null,
      theme_color: inst.themeColor || "#6366f1",
      branding_enabled: inst.brandingEnabled !== false,
      allowed_features: inst.allowedFeatures || ["attendance", "whatsapp"],
      website_config: inst.websiteConfig || {},
      admin_notes: inst.adminNotes || null,
      status: inst.status || "active",
      subscription_end: inst.subscriptionEnd?.$date || inst.subscriptionEnd || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      created_at: inst.createdAt?.$date || inst.createdAt || new Date().toISOString(),
      owner_name: inst.ownerName || "",
      admin_email: inst.adminEmail || "",
      admin_phone: inst.adminPhone || "",
      subscription_plan: inst.subscriptionPlan || "trial",
      subscription_amount: Number(inst.subscriptionAmount || 0),
      trial_days: Number(inst.trialDays || 14),
      subscription_start: inst.subscriptionStart?.$date || inst.subscriptionStart || new Date().toISOString(),
      admin_user: null, // Defer to update loop after users exist
      tuition_type: inst.tuitionType || "solo",
      quiz_feature_enabled: inst.quizFeatureEnabled !== false
    });
  }

  const validInstituteIds = new Set(institutesToInsert.map(i => i.id));
  const defaultInstituteId = institutesToInsert[0]?.id;

  if (institutesToInsert.length > 0) {
    const { error } = await supabase.from("institutes").insert(institutesToInsert);
    if (error) console.error("Error migrating institutes:", error);
    else console.log(`Successfully migrated ${institutesToInsert.length} institutes.`);
  }

  // 2. Migrate Users
  console.log("\nMigrating Users...");
  const usersToInsert = [];
  for (const u of rawData.users) {
    const id = getUuid(u._id);
    const instOid = u.institute?.$oid || u.institute;
    let instUuid = instOid ? getUuid(instOid) : adminToInstituteMap.get(u._id?.$oid || u._id);
    
    if (!validInstituteIds.has(instUuid)) {
      instUuid = defaultInstituteId;
    }

    usersToInsert.push({
      id,
      institute_id: instUuid,
      name: u.name,
      email: u.email,
      password_hash: u.password,
      role: u.role || "teacher",
      created_at: u.createdAt?.$date || u.createdAt || new Date().toISOString()
    });
  }

  if (usersToInsert.length > 0) {
    const { error } = await supabase.from("users").insert(usersToInsert);
    if (error) console.error("Error migrating users:", error);
    else {
      console.log(`Successfully migrated ${usersToInsert.length} users.`);
      
      // Update admin_user references in institutes now that users exist
      console.log("Updating admin_user references in institutes...");
      for (const inst of rawData.institutes) {
        const id = getUuid(inst._id);
        const adminUserOid = inst.adminUser?.$oid || inst.adminUser;
        if (adminUserOid) {
          const adminUserUuid = getUuid(adminUserOid);
          const { error: updateError } = await supabase
            .from("institutes")
            .update({ admin_user: adminUserUuid })
            .eq("id", id);
          if (updateError) {
            console.error(`Error updating admin_user for institute ${id}:`, updateError);
          }
        }
      }
      console.log("Successfully updated admin_user references in institutes.");
    }
  }

  // 3. Migrate Batches
  console.log("\nMigrating Batches...");
  const batchesToInsert = [];
  for (const b of rawData.batches) {
    const id = getUuid(b._id);
    const creatorOid = b.user?.$oid || b.user;
    let instUuid = adminToInstituteMap.get(creatorOid);

    if (!validInstituteIds.has(instUuid)) {
      instUuid = defaultInstituteId;
    }

    batchesToInsert.push({
      id,
      institute_id: instUuid,
      name: b.name,
      schedule_days: b.scheduleDays || [],
      start_time: b.startTime || null,
      end_time: b.endTime || null,
      teacher_id: getUuid(b.teacher),
      created_at: b.createdAt?.$date || b.createdAt || new Date().toISOString()
    });
  }

  const validBatchIds = new Set(batchesToInsert.map(b => b.id));

  if (batchesToInsert.length > 0) {
    const { error } = await supabase.from("batches").insert(batchesToInsert);
    if (error) console.error("Error migrating batches:", error);
    else console.log(`Successfully migrated ${batchesToInsert.length} batches.`);
  }

  // 4. Migrate Students, Payments, and Attendance
  console.log("\nMigrating Students, Payments, and Attendance records...");
  const studentsToInsert = [];
  const paymentsToInsert = [];
  const attendanceToInsert = [];

  for (const s of rawData.students) {
    const id = getUuid(s._id);
    const creatorOid = s.user?.$oid || s.user;
    let instUuid = adminToInstituteMap.get(creatorOid);
    let batchUuid = getUuid(s.batch);

    if (!validInstituteIds.has(instUuid)) {
      instUuid = defaultInstituteId;
    }

    if (batchUuid && !validBatchIds.has(batchUuid)) {
      batchUuid = null;
    }

    if (batchUuid) {
      studentToBatchMap.set(id, batchUuid);
    }

    studentsToInsert.push({
      id,
      institute_id: instUuid,
      batch_id: batchUuid,
      name: s.name,
      phone: s.phone,
      parent_name: s.parentName || "",
      parent_phone: s.parentPhone || "",
      email: s.email || "",
      address: s.address || "",
      enrollment_number: s.enrollmentNumber,
      joined_on: s.joinedOn?.$date ? s.joinedOn.$date.substring(0, 10) : new Date().toISOString().substring(0, 10),
      due_date: s.dueDate?.$date ? s.dueDate.$date.substring(0, 10) : null,
      total_fees: s.totalFees || 0,
      fee_plan_type: s.feePlanType || "monthly",
      password_hash: s.password,
      last_active_at: s.lastActiveAt?.$date || s.lastActiveAt || null,
      current_session_id: s.currentSessionId || null,
      created_at: s.createdAt?.$date || s.createdAt || new Date().toISOString()
    });

    // Parse payments
    if (Array.isArray(s.paymentHistory)) {
      for (const p of s.paymentHistory) {
        paymentsToInsert.push({
          id: getUuid(p._id) || randomUUID(),
          student_id: id,
          amount: p.amount,
          payment_date: p.paymentDate?.$date || p.paymentDate || new Date().toISOString(),
          payment_type: p.paymentType || "monthly",
          note: p.note || ""
        });
      }
    }

    // Parse attendance
    if (Array.isArray(s.attendanceRecords)) {
      for (const a of s.attendanceRecords) {
        attendanceToInsert.push({
          id: getUuid(a._id) || randomUUID(),
          student_id: id,
          date: a.date?.$date ? a.date.$date.substring(0, 10) : new Date().toISOString().substring(0, 10),
          status: a.status || "present"
        });
      }
    }
  }

  if (studentsToInsert.length > 0) {
    const { error } = await supabase.from("students").insert(studentsToInsert);
    if (error) console.error("Error migrating students:", error);
    else console.log(`Successfully migrated ${studentsToInsert.length} students.`);
  }

  if (paymentsToInsert.length > 0) {
    const { error } = await supabase.from("payments").insert(paymentsToInsert);
    if (error) console.error("Error migrating payments:", error);
    else console.log(`Successfully migrated ${paymentsToInsert.length} payment records.`);
  }

  if (attendanceToInsert.length > 0) {
    const { error } = await supabase.from("attendance").insert(attendanceToInsert);
    if (error) console.error("Error migrating attendance:", error);
    else console.log(`Successfully migrated ${attendanceToInsert.length} attendance records.`);
  }

  // 5. Migrate Notes
  console.log("\nMigrating Notes...");
  const notesToInsert = [];
  for (const n of rawData.notes) {
    let instUuid = getUuid(n.institute);
    if (!validInstituteIds.has(instUuid)) {
      instUuid = defaultInstituteId;
    }

    let batchUuid = getUuid(n.batch);
    if (batchUuid && !validBatchIds.has(batchUuid)) {
      batchUuid = null;
    }

    notesToInsert.push({
      id: getUuid(n._id),
      institute_id: instUuid,
      title: n.title,
      file_url: n.pdfUrl,
      target_type: batchUuid ? "batch" : "student",
      batch_id: batchUuid,
      student_ids: [],
      created_at: n.createdAt?.$date || n.createdAt || new Date().toISOString()
    });
  }

  if (notesToInsert.length > 0) {
    const { error } = await supabase.from("notes").insert(notesToInsert);
    if (error) console.error("Error migrating notes:", error);
    else console.log(`Successfully migrated ${notesToInsert.length} notes.`);
  }

  // 6. Migrate TestResults
  console.log("\nMigrating Test Marks (TestResults)...");
  const testMarksToInsert = [];
  for (const tr of rawData.testresults) {
    const studentUuid = getUuid(tr.student);
    let batchUuid = studentToBatchMap.get(studentUuid);
    let instUuid = getUuid(tr.institute);
    if (!validInstituteIds.has(instUuid)) {
      instUuid = defaultInstituteId;
    }

    if (batchUuid && !validBatchIds.has(batchUuid)) {
      batchUuid = null;
    }

    testMarksToInsert.push({
      id: getUuid(tr._id),
      institute_id: instUuid,
      batch_id: batchUuid || null,
      test_name: tr.title,
      max_marks: tr.totalMarks || 100,
      test_date: tr.examDate?.$date ? tr.examDate.$date.substring(0, 10) : new Date().toISOString().substring(0, 10),
      marks: { [studentUuid]: tr.score },
      created_at: tr.createdAt?.$date || tr.createdAt || new Date().toISOString()
    });
  }

  if (testMarksToInsert.length > 0) {
    const { error } = await supabase.from("test_marks").insert(testMarksToInsert);
    if (error) console.error("Error migrating test marks:", error);
    else console.log(`Successfully migrated ${testMarksToInsert.length} test mark records.`);
  }

  // 7. Migrate System Metrics
  console.log("\nMigrating System Metrics...");
  const metricsToInsert = [];
  for (const m of rawData.systemmetrics) {
    metricsToInsert.push({
      id: getUuid(m._id),
      metrics: { key: m.key, value: m.value },
      created_at: m.createdAt?.$date || m.createdAt || new Date().toISOString()
    });
  }

  if (metricsToInsert.length > 0) {
    try {
      const { error } = await supabase.from("system_metrics").insert(metricsToInsert);
      if (error) {
        if (error.code === "PGRST205" || error.message?.includes("not find")) {
          console.warn("Warning: Table system_metrics not created yet in Supabase database. Please execute schema.sql in Supabase SQL editor to create it.");
        } else {
          console.error("Error migrating system metrics:", error);
        }
      } else {
        console.log(`Successfully migrated ${metricsToInsert.length} system metrics.`);
      }
    } catch (e) {
      console.warn("Warning: Failed to insert system metrics. Make sure table is created.");
    }
  }

  console.log("\nMigration execution complete!");
}

migrate().catch(console.error);
