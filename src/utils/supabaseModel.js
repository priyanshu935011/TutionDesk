import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_KEY || "";

export const supabase = createClient(supabaseUrl, supabaseKey);

const MISSING_TABLES = new Set(["leads", "quizzes", "quiz_attempts", "notices", "lead_forms", "custom_pages", "custompages", "activity_logs", "activitylogs", "cashfreepayments", "cashfreepayment"]);
const FALLBACK_DIR = "c:/Users/priya/priyanshu/projects/tutions_crm/scratch/data";
const METADATA_FILE = path.join(FALLBACK_DIR, "institutes_metadata.json");
const STUDENT_METADATA_FILE = path.join(FALLBACK_DIR, "student_metadata.json");
const BATCHES_METADATA_FILE = path.join(FALLBACK_DIR, "batches_metadata.json");

function readBatchesMetadata() {
  try {
    if (!fs.existsSync(FALLBACK_DIR)) {
      fs.mkdirSync(FALLBACK_DIR, { recursive: true });
    }
    if (!fs.existsSync(BATCHES_METADATA_FILE)) {
      fs.writeFileSync(BATCHES_METADATA_FILE, JSON.stringify({}, null, 2));
    }
    return JSON.parse(fs.readFileSync(BATCHES_METADATA_FILE, "utf8"));
  } catch (e) {
    return {};
  }
}

function writeBatchesMetadata(metadata) {
  try {
    fs.writeFileSync(BATCHES_METADATA_FILE, JSON.stringify(metadata, null, 2));
  } catch (e) {}
}

function readStudentMetadata() {
  try {
    if (!fs.existsSync(FALLBACK_DIR)) {
      fs.mkdirSync(FALLBACK_DIR, { recursive: true });
    }
    if (!fs.existsSync(STUDENT_METADATA_FILE)) {
      fs.writeFileSync(STUDENT_METADATA_FILE, JSON.stringify({}, null, 2));
    }
    return JSON.parse(fs.readFileSync(STUDENT_METADATA_FILE, "utf8"));
  } catch (e) {
    return {};
  }
}

function writeStudentMetadata(metadata) {
  try {
    fs.writeFileSync(STUDENT_METADATA_FILE, JSON.stringify(metadata, null, 2));
  } catch (e) {}
}

function readInstitutesMetadata() {
  try {
    if (!fs.existsSync(FALLBACK_DIR)) {
      fs.mkdirSync(FALLBACK_DIR, { recursive: true });
    }
    if (!fs.existsSync(METADATA_FILE)) {
      fs.writeFileSync(METADATA_FILE, JSON.stringify({}, null, 2));
    }
    return JSON.parse(fs.readFileSync(METADATA_FILE, "utf8"));
  } catch (e) {
    return {};
  }
}

function writeInstitutesMetadata(metadata) {
  try {
    fs.writeFileSync(METADATA_FILE, JSON.stringify(metadata, null, 2));
  } catch (e) {}
}

function getFallbackFile(tableName) {
  if (!fs.existsSync(FALLBACK_DIR)) {
    fs.mkdirSync(FALLBACK_DIR, { recursive: true });
  }
  const filePath = path.join(FALLBACK_DIR, `${tableName}.json`);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify([], null, 2));
  }
  return filePath;
}

function readFallbackData(tableName) {
  try {
    const filePath = getFallbackFile(tableName);
    const content = fs.readFileSync(filePath, "utf8");
    return JSON.parse(content);
  } catch (err) {
    console.error(`Error reading fallback data for ${tableName}:`, err);
    return [];
  }
}

function writeFallbackData(tableName, data) {
  try {
    const filePath = getFallbackFile(tableName);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error(`Error writing fallback data for ${tableName}:`, err);
  }
}

function matchFilter(doc, filter) {
  if (!filter || Object.keys(filter).length === 0) return true;
  
  const cleanValue = (v) => {
    if (v === null || v === undefined) return v;
    if (typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
      if (v._id) return String(v._id);
      if (v.id) return String(v.id);
      return String(v);
    }
    return v;
  };

  for (const [key, rawVal] of Object.entries(filter)) {
    const val = cleanValue(rawVal);

    if (key === "$or" && Array.isArray(val)) {
      let matched = false;
      for (const subFilter of val) {
        if (matchFilter(doc, subFilter)) {
          matched = true;
          break;
        }
      }
      if (!matched) return false;
      continue;
    }

    let docVal = doc[key];
    if (docVal === undefined) {
      if (key === "user" || key === "institute") {
        docVal = doc.institute_id || doc.institute || doc.user;
      } else if (key === "batch") {
        docVal = doc.batch_id || doc.batch;
      } else if (key === "student") {
        docVal = doc.student_id || doc.student;
      } else if (key === "batches") {
        docVal = doc.batch_ids || doc.batches;
      } else if (key === "students") {
        docVal = doc.student_ids || doc.students;
      }
    }

    docVal = cleanValue(docVal);

    if (val === null) {
      if (docVal !== null && docVal !== undefined) return false;
    } else if (val instanceof Date) {
      if (!docVal || new Date(docVal).getTime() !== val.getTime()) return false;
    } else if (typeof val === "object" && val !== null && !Array.isArray(val)) {
      for (const [op, opVal] of Object.entries(val)) {
        const cleanOpVal = cleanValue(opVal);
        if (op === "$in" && Array.isArray(cleanOpVal)) {
          if (Array.isArray(docVal)) {
            const intersected = docVal.some(item => cleanOpVal.map(String).includes(String(cleanValue(item))));
            if (!intersected) return false;
          } else {
            if (!cleanOpVal.map(String).includes(String(docVal))) return false;
          }
        } else if (op === "$nin" && Array.isArray(cleanOpVal)) {
          if (Array.isArray(docVal)) {
            const intersected = docVal.some(item => cleanOpVal.map(String).includes(String(cleanValue(item))));
            if (intersected) return false;
          } else {
            if (cleanOpVal.map(String).includes(String(docVal))) return false;
          }
        } else if (op === "$gte") {
          if (!(docVal >= cleanOpVal)) return false;
        } else if (op === "$lte") {
          if (!(docVal <= cleanOpVal)) return false;
        } else if (op === "$gt") {
          if (!(docVal > cleanOpVal)) return false;
        } else if (op === "$lt") {
          if (!(docVal < cleanOpVal)) return false;
        } else if (op === "$ne") {
          if (String(docVal) === String(cleanOpVal)) return false;
        }
      }
    } else if (Array.isArray(val)) {
      if (Array.isArray(docVal)) {
        const intersected = docVal.some(item => val.map(String).includes(String(cleanValue(item))));
        if (!intersected) return false;
      } else {
        if (!val.map(String).includes(String(docVal))) return false;
      }
    } else {
      if (Array.isArray(docVal)) {
        if (!docVal.map(item => String(cleanValue(item))).includes(String(val))) return false;
      } else {
        if (String(docVal) !== String(val)) return false;
      }
    }
  }
  return true;
}

function applyUpdateJson(doc, update) {
  const payload = update.$set ? update.$set : update;
  for (const [key, val] of Object.entries(payload)) {
    if (key.startsWith("$")) continue;
    doc[key] = val;
    if (key === "institute_id") {
      doc.user = val;
      doc.institute = val;
    }
    if (key === "batch_id") doc.batch = val;
    if (key === "teacher_id") doc.teacher = val;
    if (key === "student_id") doc.student = val;
  }
  doc.updatedAt = new Date().toISOString();
  if (doc.updated_at) doc.updated_at = doc.updatedAt;
  return doc;
}

const camelToSnake = (str) => {
  if (str === "_id") return "id";
  if (str === "user") return "institute_id";
  if (str === "institute") return "institute_id";
  if (str === "batch") return "batch_id";
  if (str === "teacher") return "teacher_id";
  if (str === "student") return "student_id";
  if (str === "password") return "password_hash";
  if (str === "pdfUrl") return "file_url";
  if (str === "pdfPublicId") return "pdf_public_id";
  if (str === "students") return "student_ids";
  if (str === "batches") return "batch_ids";
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
};

const snakeToCamel = (str) => {
  if (str === "id") return "_id";
  if (str === "file_url") return "pdfUrl";
  if (str === "student_ids") return "students";
  if (str === "batch_ids") return "batches";
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
};

class SupabaseDocument {
  constructor(tableName, data, modelInstance) {
    this._tableName = tableName;
    this._model = modelInstance;

    // Map database 'id' to mongoose '_id'
    if (data.id && !data._id) {
      this._id = data.id;
    }

    // Automatically parse dates and expose camelCase aliases for all snake_case properties
    for (const key of Object.keys(data)) {
      let val = data[key];
      // Convert date/timestamp strings to Date objects
      if (
        typeof val === "string" &&
        (key.endsWith("_at") ||
          key.endsWith("_date") ||
          key === "joined_on" ||
          key === "due_date" ||
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(val))
      ) {
        val = new Date(val);
      }

      this[key] = val;
      const camelKey = snakeToCamel(key);
      if (camelKey !== key) {
        this[camelKey] = val;
      }
    }

    // Expose relational compatibility aliases
    if (data.institute_id !== undefined) {
      this.user = data.institute_id;
      this.institute = data.institute_id;
    }
    if (data.batch_id !== undefined) this.batch = data.batch_id;
    if (data.teacher_id !== undefined) this.teacher = data.teacher_id;
    if (data.student_id !== undefined) this.student = data.student_id;
    if (data.password_hash !== undefined) this.password = data.password_hash;
    if (data.file_url !== undefined) this.pdfUrl = data.file_url;
    if (data.student_ids !== undefined) this.students = data.student_ids;
    if (data.batch_ids !== undefined) this.batches = data.batch_ids;

    if (tableName === "institutes" && this._id) {
      const metadata = readInstitutesMetadata();
      const meta = metadata[this._id] || {};
      this.flexibleDueDate = meta.flexibleDueDate ?? this.flexibleDueDate ?? false;
      this.flexible_due_date = this.flexibleDueDate;
      this.leadApiKey = meta.leadApiKey ?? this.leadApiKey ?? "";
      this.lead_api_key = this.leadApiKey;
      this.subscriptionHistory = meta.subscriptionHistory ?? this.subscriptionHistory ?? [];
      this.subscription_history = this.subscriptionHistory;
      this.studentCustomFields = meta.studentCustomFields ?? this.studentCustomFields ?? [];
      this.student_custom_fields = this.studentCustomFields;
      this.studentPortalEnabled = meta.studentPortalEnabled ?? this.studentPortalEnabled ?? true;
      this.student_portal_enabled = this.studentPortalEnabled;
    }

    if (tableName === "students" && this._id) {
      const metadata = readStudentMetadata();
      const meta = metadata[this._id] || {};
      this.customFields = meta.customFields ?? this.customFields ?? {};
      this.custom_fields = this.customFields;
    }

    if (tableName === "batches" && this._id) {
      const metadata = readBatchesMetadata();
      const meta = metadata[this._id] || {};
      this.status = meta.status ?? this.status ?? "active";
    }
  }

  async save() {
    if (MISSING_TABLES.has(this._tableName)) {
      const fallbackData = readFallbackData(this._tableName);
      const index = fallbackData.findIndex(doc => String(doc.id) === String(this._id) || String(doc._id) === String(this._id));
      const plainObj = this.toObject();
      if (index !== -1) {
        fallbackData[index] = { ...fallbackData[index], ...plainObj };
      } else {
        fallbackData.push(plainObj);
      }
      writeFallbackData(this._tableName, fallbackData);
      return this;
    }

    if (this._tableName === "test_marks") {
      const realId = String(this.id).split("_")[0];
      const studentUuid = this.student || String(this.id).split("_")[1];
      
      const { data: testRow } = await this._model.supabase
        .from("test_marks")
        .select("*")
        .eq("id", realId)
        .maybeSingle();

      const newMarksMap = { ...(testRow?.marks || {}), [studentUuid]: Number(this.score || 0) };
      
      const dbPayload = {
        test_name: this.title,
        max_marks: Number(this.totalMarks || 100),
        test_date: this.examDate ? new Date(this.examDate).toISOString().substring(0, 10) : new Date().toISOString().substring(0, 10),
        marks: newMarksMap
      };

      const { error } = await this._model.supabase
        .from("test_marks")
        .update(dbPayload)
        .eq("id", realId);

      if (error) throw error;
      return this;
    }

    const payload = {};
    for (const key of Object.keys(this)) {
      if (key.startsWith("_")) continue;
      // Skip fields that are populated objects
      if (typeof this[key] === "object" && this[key] !== null && this[key]._tableName) {
        continue;
      }
      
      const dbKey = camelToSnake(key);
      payload[dbKey] = this[key];
    }

    if (this._tableName === "institutes") {
      delete payload.flexible_due_date;
      delete payload.lead_api_key;
      delete payload.subscription_history;
      delete payload.student_custom_fields;
      delete payload.student_portal_enabled;
    }

    if (this._tableName === "students") {
      delete payload.custom_fields;
      delete payload.customFields;
    }

    if (this._tableName === "batches") {
      delete payload.status;
    }

    if (this._id) {
      payload.id = this._id;
    }

    if (payload.id) {
      // Update
      let attempt = 0;
      while (attempt < 5) {
        const { data, error } = await this._model.supabase
          .from(this._tableName)
          .update(payload)
          .eq("id", payload.id)
          .select()
          .maybeSingle();

        if (error && error.message) {
          let badCol = null;
          if (error.message.includes("does not exist")) {
            const match = error.message.match(/column "([^"]+)"/);
            if (match) badCol = match[1];
          } else if (error.code === "PGRST204" || error.message.includes("Could not find the") || error.message.includes("schema cache")) {
            const match = error.message.match(/Could not find the '([^']+)' column/);
            if (match) badCol = match[1];
          }

          if (badCol) {
            console.warn(`Stripping missing column "${badCol}" from ${this._tableName} update payload.`);
            delete payload[badCol];
            attempt++;
            continue;
          }
        }

        if (error) throw error;
        if (data) Object.assign(this, data);
        break;
      }
      if (this._tableName === "institutes" && this._id) {
        const metadata = readInstitutesMetadata();
        metadata[this._id] = {
          flexibleDueDate: this.flexibleDueDate ?? false,
          leadApiKey: this.leadApiKey ?? "",
          subscriptionHistory: this.subscriptionHistory ?? [],
          studentCustomFields: this.studentCustomFields ?? [],
          studentPortalEnabled: this.studentPortalEnabled ?? true
        };
        writeInstitutesMetadata(metadata);
      }
      if (this._tableName === "students" && this._id) {
        const metadata = readStudentMetadata();
        metadata[this._id] = {
          customFields: this.customFields ?? {}
        };
        writeStudentMetadata(metadata);
      }
      if (this._tableName === "batches" && this._id) {
        const metadata = readBatchesMetadata();
        metadata[this._id] = {
          status: this.status ?? "active"
        };
        writeBatchesMetadata(metadata);
      }
      return this;
    } else {
      // Insert
      let attempt = 0;
      while (attempt < 5) {
        const { data, error } = await this._model.supabase
          .from(this._tableName)
          .insert(payload)
          .select()
          .maybeSingle();

        if (error && error.message) {
          let badCol = null;
          if (error.message.includes("does not exist")) {
            const match = error.message.match(/column "([^"]+)"/);
            if (match) badCol = match[1];
          } else if (error.code === "PGRST204" || error.message.includes("Could not find the") || error.message.includes("schema cache")) {
            const match = error.message.match(/Could not find the '([^']+)' column/);
            if (match) badCol = match[1];
          }

          if (badCol) {
            console.warn(`Stripping missing column "${badCol}" from ${this._tableName} insert payload.`);
            delete payload[badCol];
            attempt++;
            continue;
          }
        }

        if (error) throw error;
        if (data) {
          Object.assign(this, data);
          this._id = data.id;
        }
        break;
      }
      if (this._tableName === "institutes" && this._id) {
        const metadata = readInstitutesMetadata();
        metadata[this._id] = {
          flexibleDueDate: this.flexibleDueDate ?? false,
          leadApiKey: this.leadApiKey ?? "",
          subscriptionHistory: this.subscriptionHistory ?? [],
          studentCustomFields: this.studentCustomFields ?? [],
          studentPortalEnabled: this.studentPortalEnabled ?? true
        };
        writeInstitutesMetadata(metadata);
      }
      if (this._tableName === "students" && this._id) {
        const metadata = readStudentMetadata();
        metadata[this._id] = {
          customFields: this.customFields ?? {}
        };
        writeStudentMetadata(metadata);
      }
      if (this._tableName === "batches" && this._id) {
        const metadata = readBatchesMetadata();
        metadata[this._id] = {
          status: this.status ?? "active"
        };
        writeBatchesMetadata(metadata);
      }
      return this;
    }
  }

  toObject() {
    const obj = { ...this };
    delete obj._tableName;
    delete obj._model;
    return obj;
  }

  toJSON() {
    return this.toObject();
  }
}

class SupabaseQuery {
  constructor(modelInstance, queryType, args) {
    this.model = modelInstance;
    this.queryType = queryType;
    this.args = args;
    this.selectFields = null;
    this.sortFields = null;
    this.limitVal = null;
    this.populateFields = [];
  }

  select(fields) {
    this.selectFields = fields;
    return this;
  }

  sort(fields) {
    this.sortFields = fields;
    return this;
  }

  limit(val) {
    this.limitVal = val;
    return this;
  }

  populate(fields, selectFields) {
    this.populateFields.push({ fields, selectFields });
    return this;
  }

  async exec() {
    const tableName = this.model.tableName;

    if (this.queryType === "findOneAndUpdate") {
      const filter = this.args[0] || {};
      const update = this.args[1] || {};
      const options = this.args[2] || {};

      if (MISSING_TABLES.has(tableName)) {
        const fallbackData = readFallbackData(tableName);
        const index = fallbackData.findIndex(doc => matchFilter(doc, filter));
        if (index === -1) return null;

        const updated = applyUpdateJson(fallbackData[index], update);
        writeFallbackData(tableName, fallbackData);
        const doc = new SupabaseDocument(tableName, updated, this.model);
        await this.resolvePopulations([doc]);
        return doc;
      }

      const payload = update.$set ? update.$set : update;
      const dbPayload = {};
      for (const [key, val] of Object.entries(payload)) {
        if (key.startsWith("$")) continue;
        const dbKey = camelToSnake(key);
        dbPayload[dbKey] = val;
      }

      let updateQuery = this.model.supabase.from(tableName).update(dbPayload);
      updateQuery = this.model.applyFilters(updateQuery, filter);
      const { data, error } = await updateQuery.select();

      if (error && (error.code === "PGRST205" || error.code === "42P01" || (error.message && (error.message.includes("schema cache") || error.message.includes("relation"))))) {
        console.warn(`Table "${tableName}" does not exist in DB, ignoring findOneAndUpdate.`);
        return null;
      }
      if (error) throw error;

      const row = data?.[0];
      if (!row) return null;

      const doc = new SupabaseDocument(tableName, row, this.model);
      await this.resolvePopulations([doc]);
      return doc;
    }

    if (MISSING_TABLES.has(tableName)) {
      const fallbackData = readFallbackData(tableName);
      const currentFilter = { ...(this.args[0] || {}) };
      let filtered = fallbackData.filter(doc => matchFilter(doc, currentFilter));

      // Sort
      if (this.sortFields) {
        let field = typeof this.sortFields === "string" ? this.sortFields.replace(/^-/, "") : Object.keys(this.sortFields)[0];
        if (field === "createdAt") field = "created_at";
        if (field === "updatedAt") field = "updated_at";
        
        const desc = typeof this.sortFields === "string" ? this.sortFields.startsWith("-") : this.sortFields[field] === -1;
        filtered.sort((a, b) => {
          const valA = a[field] !== undefined ? a[field] : a._id;
          const valB = b[field] !== undefined ? b[field] : b._id;
          if (valA < valB) return desc ? 1 : -1;
          if (valA > valB) return desc ? -1 : 1;
          return 0;
        });
      }

      // Limit
      if (this.limitVal !== null) {
        filtered = filtered.slice(0, this.limitVal);
      }

      const docs = filtered.map(row => new SupabaseDocument(tableName, row, this.model));
      await this.resolvePopulations(docs);

      if (this.queryType === "findOne" || this.queryType === "findById") {
        return docs[0] || null;
      }
      return docs;
    }

    let attempt = 0;
    const currentFilter = { ...(this.args[0] || {}) };

    if (tableName === "institutes" && (currentFilter.leadApiKey || currentFilter.lead_api_key)) {
      const keyToFind = currentFilter.leadApiKey || currentFilter.lead_api_key;
      const metadata = readInstitutesMetadata();
      const instId = Object.keys(metadata).find(id => metadata[id].leadApiKey === keyToFind);
      if (instId) {
        currentFilter.id = instId;
        delete currentFilter.leadApiKey;
        delete currentFilter.lead_api_key;
      }
    }

    for (const key of ["user", "institute", "institute_id", "instituteId"]) {
      if (currentFilter[key] && typeof currentFilter[key] === "string" && currentFilter[key].length === 36) {
        const { data: userData } = await this.model.supabase
          .from("users")
          .select("institute_id")
          .eq("id", currentFilter[key])
          .maybeSingle();
        if (userData && userData.institute_id) {
          currentFilter[key] = userData.institute_id;
        }
      }
    }
    while (attempt < 5) {
      let query = this.model.supabase.from(tableName).select("*");
      query = this.model.applyFilters(query, currentFilter);

      if (this.sortFields) {
        if (typeof this.sortFields === "string") {
          const parts = this.sortFields.split(" ");
          for (const part of parts) {
            const descending = part.startsWith("-");
            const field = descending ? part.substring(1) : part;
            const dbSortField = camelToSnake(field);
            query = query.order(dbSortField, { ascending: !descending });
          }
        } else if (typeof this.sortFields === "object") {
          for (const [key, val] of Object.entries(this.sortFields)) {
            const dbSortField = camelToSnake(key);
            query = query.order(dbSortField, { ascending: val !== -1 });
          }
        }
      }

      if (this.limitVal !== null) {
        query = query.limit(this.limitVal);
      }

      if (this.queryType === "findOne" || this.queryType === "findById") {
        let finalQuery = query;
        if (tableName === "test_marks" && currentFilter._id && String(currentFilter._id).includes("_")) {
          const [realId] = String(currentFilter._id).split("_");
          finalQuery = this.model.supabase.from(tableName).select("*").eq("id", realId);
        }

        const { data, error } = await finalQuery.limit(1);
        if (error && (error.code === "PGRST205" || error.code === "42P01" || (error.message && (error.message.includes("schema cache") || error.message.includes("relation"))))) {
          console.warn(`Table "${tableName}" does not exist in DB, returning null.`);
          return null;
        }
        if (error && error.message && error.message.includes("does not exist")) {
          const match = error.message.match(/column "?([^"\s]+)"?/);
          if (match && match[1]) {
            let badCol = match[1];
            if (badCol.includes(".")) {
              badCol = badCol.split(".")[1];
            }
            const filterKey = Object.keys(currentFilter).find(k => camelToSnake(k) === badCol);
            if (filterKey) {
              console.warn(`Stripping missing filter column "${filterKey}" from ${tableName} findOne query.`);
              delete currentFilter[filterKey];
              attempt++;
              continue;
            }
          }
        }
        if (error) throw error;
        const row = data?.[0];
        if (!row) return null;

        let targetRow = row;
        if (tableName === "test_marks") {
          const studentUuid = currentFilter.student || (currentFilter._id && String(currentFilter._id).includes("_") ? String(currentFilter._id).split("_")[1] : Object.keys(row.marks || {})[0]);
          if (!studentUuid) return null;
          targetRow = {
            id: `${row.id}_${studentUuid}`,
            student: studentUuid,
            student_id: studentUuid,
            title: row.test_name,
            score: Number(row.marks?.[studentUuid] || 0),
            totalMarks: Number(row.max_marks || 100),
            examDate: row.test_date || row.created_at,
            createdAt: row.created_at,
            institute_id: row.institute_id,
            batch_id: row.batch_id
          };
        }

        const doc = new SupabaseDocument(tableName, targetRow, this.model);
        if (tableName === "students") {
          await this.populateStudentRecords([doc]);
        }
        await this.resolvePopulations([doc]);
        return doc;
      } else {
        const { data, error } = await query;
        if (error && (error.code === "PGRST205" || error.code === "42P01" || (error.message && (error.message.includes("schema cache") || error.message.includes("relation"))))) {
          console.warn(`Table "${tableName}" does not exist in DB, returning empty array.`);
          return [];
        }
        if (error && error.message && error.message.includes("does not exist")) {
          const match = error.message.match(/column "?([^"\s]+)"?/);
          if (match && match[1]) {
            let badCol = match[1];
            if (badCol.includes(".")) {
              badCol = badCol.split(".")[1];
            }
            const filterKey = Object.keys(currentFilter).find(k => camelToSnake(k) === badCol);
            if (filterKey) {
              console.warn(`Stripping missing filter column "${filterKey}" from ${tableName} find query.`);
              delete currentFilter[filterKey];
              attempt++;
              continue;
            }
          }
        }
        if (error) throw error;

        let rows = data || [];
        if (tableName === "test_marks") {
          const flattened = [];
          for (const row of rows) {
            const marksMap = row.marks || {};
            for (const [studentUuid, score] of Object.entries(marksMap)) {
              flattened.push({
                id: `${row.id}_${studentUuid}`,
                student: studentUuid,
                student_id: studentUuid,
                title: row.test_name,
                score: Number(score || 0),
                totalMarks: Number(row.max_marks || 100),
                examDate: row.test_date || row.created_at,
                createdAt: row.created_at,
                institute_id: row.institute_id,
                batch_id: row.batch_id
              });
            }
          }
          // Filter the flattened array according to filter
          rows = flattened.filter(doc => {
            // Check student filter
            if (currentFilter.student) {
              const filterVal = currentFilter.student;
              if (filterVal && typeof filterVal === "object" && filterVal.$in) {
                return filterVal.$in.includes(doc.student);
              }
              return doc.student === filterVal;
            }
            return true;
          });
        }

        const docs = rows.map(row => new SupabaseDocument(tableName, row, this.model));
        if (tableName === "students" && docs.length > 0) {
          await this.populateStudentRecords(docs);
        }
        await this.resolvePopulations(docs);
        return docs;
      }
    }
    return this.queryType === "findOne" || this.queryType === "findById" ? null : [];
  }

  then(onFulfilled, onRejected) {
    return this.exec().then(onFulfilled, onRejected);
  }

  async resolvePopulations(docs) {
    if (docs.length === 0 || this.populateFields.length === 0) return;

    for (const pop of this.populateFields) {
      let path = typeof pop.fields === "string" ? pop.fields : pop.fields.path;
      let select = typeof pop.fields === "object" ? pop.fields.select : pop.selectFields;

      for (const doc of docs) {
        // Map references
        const idKey = path === "teacher" ? "teacher_id" : 
                      path === "batch" ? "batch_id" : 
                      path === "institute" ? "institute_id" : 
                      path === "student" ? "student_id" : path;
        
        const refId = doc[idKey] || doc[path];
        if (!refId) continue;

        let refTable = "";
        if (path === "teacher" || path === "user") refTable = "users";
        else if (path === "batch") refTable = "batches";
        else if (path === "institute") refTable = "institutes";
        else if (path === "student") refTable = "students";
        else continue;

        let selectStr = "*";
        if (select && typeof select === "string") {
          const fieldsArray = select.trim().split(/\s+/).map(f => camelToSnake(f));
          if (!fieldsArray.includes("id")) {
            fieldsArray.push("id");
          }
          selectStr = fieldsArray.join(", ");
        }

        if (Array.isArray(refId)) {
          const { data, error } = await this.model.supabase
            .from(refTable)
            .select(selectStr)
            .in("id", refId);
          if (!error && data) {
            doc[path] = data.map(row => new SupabaseDocument(refTable, row, { tableName: refTable, supabase: this.model.supabase }));
          }
        } else {
          const { data, error } = await this.model.supabase
            .from(refTable)
            .select(selectStr)
            .eq("id", refId)
            .maybeSingle();

          if (!error && data) {
            doc[path] = new SupabaseDocument(refTable, data, { tableName: refTable, supabase: this.model.supabase });
          }
        }
      }
    }
  }

  async populateStudentRecords(docs, options = {}) {
    const studentIds = docs.map(d => d.id).filter(Boolean);
    if (studentIds.length === 0) return;
    
    const includeAttendance = options.includeAttendance !== false;

    const promises = [
      this.model.supabase
        .from("payments")
        .select("id, student_id, amount, payment_date, payment_type, note")
        .in("student_id", studentIds)
        .order("payment_date", { ascending: true })
    ];

    if (includeAttendance) {
      promises.push(
        this.model.supabase
          .from("attendance")
          .select("id, student_id, date, status")
          .in("student_id", studentIds)
          .order("date", { ascending: false })
      );
    }

    const results = await Promise.all(promises);
    const paymentsData = results[0]?.data || [];
    const attendanceData = includeAttendance ? (results[1]?.data || []) : [];

    const paymentsByStudent = {};
    const attendanceByStudent = {};
    
    for (const id of studentIds) {
      paymentsByStudent[id] = [];
      attendanceByStudent[id] = [];
    }

    for (const p of paymentsData) {
      if (!paymentsByStudent[p.student_id]) paymentsByStudent[p.student_id] = [];
      paymentsByStudent[p.student_id].push({
        _id: p.id,
        amount: Number(p.amount || 0),
        paymentDate: p.payment_date,
        paymentType: p.payment_type,
        note: p.note || ""
      });
    }

    for (const a of attendanceData) {
      if (!attendanceByStudent[a.student_id]) attendanceByStudent[a.student_id] = [];
      attendanceByStudent[a.student_id].push({
        _id: a.id,
        date: a.date,
        status: a.status
      });
    }

    for (const doc of docs) {
      doc.paymentHistory = paymentsByStudent[doc.id] || [];
      doc.payment_history = doc.paymentHistory;
      doc.attendanceRecords = attendanceByStudent[doc.id] || [];
      doc.attendance_records = doc.attendanceRecords;
      
      const paid = doc.paymentHistory.reduce((sum, p) => sum + p.amount, 0);
      doc.paidAmount = paid;
      doc.pendingAmount = Number(doc.totalFees || doc.total_fees || 0) - paid;
    }
  }
}

class SupabaseModel {
  constructor(tableName) {
    this.tableName = tableName;
    this.supabase = supabase;
  }

  applyFilters(queryBuilder, filter = {}) {
    let q = queryBuilder;
    const cleanValue = (v) => {
      if (v === null || v === undefined) return v;
      if (typeof v === "object" && !(v instanceof Date) && !Array.isArray(v) && v.$in === undefined && v.$gte === undefined && v.$lte === undefined && v.$gt === undefined && v.$lt === undefined && v.$ne === undefined && v.$nin === undefined && v.$size === undefined) {
        if (v._id) return String(v._id);
        if (v.id) return String(v.id);
        return String(v);
      }
      return v;
    };

    for (const [key, rawVal] of Object.entries(filter)) {
      const val = cleanValue(rawVal);

      if (key === "$or" && Array.isArray(val)) {
        const orParts = [];
        for (const subFilter of val) {
          for (const [subKey, rawSubVal] of Object.entries(subFilter)) {
            let dbSubKey = camelToSnake(subKey);
            if (this.tableName === "test_marks") {
              if (dbSubKey === "title") dbSubKey = "test_name";
              else if (dbSubKey === "exam_date") dbSubKey = "test_date";
              else if (dbSubKey === "total_marks") dbSubKey = "max_marks";
              else if (dbSubKey === "batch") dbSubKey = "batch_id";
              else if (dbSubKey === "institute") dbSubKey = "institute_id";
            }

            let subVal = cleanValue(rawSubVal);
            if (subVal && typeof subVal === "object" && subVal.$in !== undefined) {
              subVal = subVal.$in;
            }

            const isIdArray = dbSubKey === "student_ids" || dbSubKey === "batch_ids";

            if (subVal !== undefined) {
              if (subVal === null) {
                orParts.push(`${dbSubKey}.is.null`);
              } else if (isIdArray) {
                if (Array.isArray(subVal)) {
                  subVal.forEach(item => {
                    const cleanItem = cleanValue(item);
                    if (cleanItem && String(cleanItem) !== "[object Object]") {
                      orParts.push(`${dbSubKey}.cs.{${cleanItem}}`);
                    }
                  });
                } else if (typeof subVal === "object" && subVal.$size === 0) {
                  orParts.push(`${dbSubKey}.eq.{}`);
                } else {
                  const cleanItem = cleanValue(subVal);
                  if (cleanItem && String(cleanItem) !== "[object Object]") {
                    orParts.push(`${dbSubKey}.cs.{${cleanItem}}`);
                  }
                }
              } else if (Array.isArray(subVal)) {
                subVal.forEach(item => {
                  const cleanItem = cleanValue(item);
                  if (cleanItem && String(cleanItem) !== "[object Object]") {
                    orParts.push(`${dbSubKey}.eq.${cleanItem}`);
                  }
                });
              } else if (subVal instanceof Date) {
                orParts.push(`${dbSubKey}.eq.${subVal.toISOString()}`);
              } else {
                const cleanItem = cleanValue(subVal);
                if (cleanItem && String(cleanItem) !== "[object Object]") {
                  orParts.push(`${dbSubKey}.eq.${cleanItem}`);
                }
              }
            }
          }
        }
        if (orParts.length > 0) {
          q = q.or(orParts.join(","));
        }
        continue;
      }

      let dbKey = camelToSnake(key);
      if (this.tableName === "test_marks") {
        if (dbKey === "title") dbKey = "test_name";
        else if (dbKey === "exam_date") dbKey = "test_date";
        else if (dbKey === "total_marks") dbKey = "max_marks";
        else if (dbKey === "batch") dbKey = "batch_id";
        else if (dbKey === "institute") dbKey = "institute_id";
      }

      if (val === null) {
        q = q.is(dbKey, null);
      } else if (val instanceof Date) {
        q = q.eq(dbKey, val.toISOString());
      } else if ((dbKey === "student_ids" || dbKey === "batch_ids") && typeof val === "string") {
        q = q.contains(dbKey, [val]);
      } else if (typeof val === "object" && val !== null && val.$size === undefined && val._id === undefined && val.id === undefined) {
        for (const [op, opVal] of Object.entries(val)) {
          let formattedVal = opVal instanceof Date ? opVal.toISOString() : opVal;
          if (Array.isArray(formattedVal)) {
            formattedVal = formattedVal.map(v => cleanValue(v));
          } else {
            formattedVal = cleanValue(formattedVal);
          }
          if (op === "$in") {
            q = q.in(dbKey, formattedVal);
          } else if (op === "$gte") {
            q = q.gte(dbKey, formattedVal);
          } else if (op === "$lte") {
            q = q.lte(dbKey, formattedVal);
          } else if (op === "$gt") {
            q = q.gt(dbKey, formattedVal);
          } else if (op === "$lt") {
            q = q.lt(dbKey, formattedVal);
          } else if (op === "$ne") {
            q = q.neq(dbKey, formattedVal);
          } else if (op === "$nin") {
            q = q.not(dbKey, "in", `(${formattedVal.map(v => String(v)).join(",")})`);
          }
        }
      } else {
        if (dbKey === "student_ids" || dbKey === "batch_ids") {
          if (val && typeof val === "object" && val.$size === 0) {
            q = q.eq(dbKey, "{}");
          } else {
            const arr = Array.isArray(val) ? val.map(v => cleanValue(v)) : [cleanValue(val)];
            q = q.contains(dbKey, arr);
          }
        } else {
          q = q.eq(dbKey, cleanValue(val));
        }
      }
    }
    return q;
  }

  find(filter = {}) {
    return new SupabaseQuery(this, "find", [filter]);
  }

  findOne(filter = {}) {
    return new SupabaseQuery(this, "findOne", [filter]);
  }

  findById(id) {
    return new SupabaseQuery(this, "findById", [{ _id: id }]);
  }

  findOneAndUpdate(filter = {}, update = {}, options = {}) {
    return new SupabaseQuery(this, "findOneAndUpdate", [filter, update, options]);
  }

  async create(doc) {
    if (MISSING_TABLES.has(this.tableName)) {
      const data = Array.isArray(doc) ? doc : [doc];
      const fallbackData = readFallbackData(this.tableName);
      const createdDocs = [];

      for (const item of data) {
        const docId = crypto.randomUUID();
        const newItem = {
          id: docId,
          _id: docId,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          createdAt: new Date(),
          updatedAt: new Date(),
          ...item
        };
        if (newItem.institute_id) {
          newItem.user = newItem.institute_id;
          newItem.institute = newItem.institute_id;
        }
        if (newItem.user) {
          newItem.institute_id = newItem.user;
          newItem.institute = newItem.user;
        }
        fallbackData.push(newItem);
        createdDocs.push(new SupabaseDocument(this.tableName, newItem, this));
      }

      writeFallbackData(this.tableName, fallbackData);
      return Array.isArray(doc) ? createdDocs : createdDocs[0];
    }

    if (Array.isArray(doc)) {
      const results = [];
      for (const item of doc) {
        const res = await this.create(item);
        results.push(res);
      }
      return results;
    }

    const payload = {};
    for (const [key, val] of Object.entries(doc)) {
      if (key.startsWith("_")) continue;
      const dbKey = camelToSnake(key);
      payload[dbKey] = val;
    }

    if (this.tableName === "institutes") {
      delete payload.flexible_due_date;
      delete payload.lead_api_key;
      delete payload.subscription_history;
      delete payload.student_custom_fields;
      delete payload.student_portal_enabled;
    }

    if (this.tableName === "students") {
      delete payload.custom_fields;
      delete payload.customFields;
    }

    let attempt = 0;
    let data = null;

    while (attempt < 5) {
      const { data: insertedData, error } = await this.supabase
        .from(this.tableName)
        .insert(payload)
        .select()
        .maybeSingle();

      if (error && error.message) {
        let badCol = null;
        if (error.message.includes("does not exist")) {
          const match = error.message.match(/column "([^"]+)"/);
          if (match) badCol = match[1];
        } else if (error.code === "PGRST204" || error.message.includes("Could not find the") || error.message.includes("schema cache")) {
          const match = error.message.match(/Could not find the '([^']+)' column/);
          if (match) badCol = match[1];
        }

        if (badCol) {
          console.warn(`Stripping missing column "${badCol}" from ${this.tableName} create payload.`);
          delete payload[badCol];
          attempt++;
          continue;
        }
      }

      if (error) throw error;
      data = insertedData;
      break;
    }

    // Save initial payment history or attendance records if creating student
    if (data && this.tableName === "students") {
      const studentId = data.id;
      if (Array.isArray(doc.paymentHistory) && doc.paymentHistory.length > 0) {
        for (const p of doc.paymentHistory) {
          try {
            await this.supabase.from("payments").insert({
              student_id: studentId,
              amount: p.amount,
              payment_date: p.paymentDate || new Date(),
              payment_type: p.paymentType || "monthly",
              note: p.note || ""
            });
          } catch (e) {}
        }
      }
      if (Array.isArray(doc.attendanceRecords) && doc.attendanceRecords.length > 0) {
        for (const a of doc.attendanceRecords) {
          try {
            await this.supabase.from("attendance").insert({
              student_id: studentId,
              date: a.date || new Date(),
              status: a.status || "present"
            });
          } catch (e) {}
        }
      }
    }

    if (this.tableName === "institutes" && data) {
      const metadata = readInstitutesMetadata();
      metadata[data.id] = {
        flexibleDueDate: doc.flexibleDueDate ?? false,
        leadApiKey: doc.leadApiKey ?? "",
        subscriptionHistory: doc.subscriptionHistory ?? [],
        studentCustomFields: doc.studentCustomFields ?? [],
        studentPortalEnabled: doc.studentPortalEnabled ?? true
      };
      writeInstitutesMetadata(metadata);
    }

    if (this.tableName === "students" && data) {
      const metadata = readStudentMetadata();
      metadata[data.id] = {
        customFields: doc.customFields ?? {}
      };
      writeStudentMetadata(metadata);
    }

    return new SupabaseDocument(this.tableName, data, this);
  }

  async insertMany(docs) {
    return this.create(docs);
  }

  async updateOne(filter = {}, update = {}) {
    if (MISSING_TABLES.has(this.tableName)) {
      const fallbackData = readFallbackData(this.tableName);
      let matchedCount = 0;
      let modifiedCount = 0;

      for (const doc of fallbackData) {
        if (matchFilter(doc, filter)) {
          applyUpdateJson(doc, update);
          matchedCount++;
          modifiedCount++;
        }
      }

      if (modifiedCount > 0) {
        writeFallbackData(this.tableName, fallbackData);
      }
      return { matchedCount, modifiedCount };
    }

    const payload = update.$set ? update.$set : update;
    const dbPayload = {};
    for (const [key, val] of Object.entries(payload)) {
      if (key.startsWith("$")) continue;
      const dbKey = camelToSnake(key);
      dbPayload[dbKey] = val;
    }

    let query = this.supabase.from(this.tableName).update(dbPayload);
    query = this.applyFilters(query, filter);

    const { data, error } = await query.select();
    if (error && (error.code === "PGRST205" || error.code === "42P01" || (error.message && (error.message.includes("schema cache") || error.message.includes("relation"))))) {
      console.warn(`Table "${this.tableName}" does not exist in DB, ignoring updateOne.`);
      return { matchedCount: 0, modifiedCount: 0 };
    }
    if (error) throw error;
    return { matchedCount: data?.length || 0, modifiedCount: data?.length || 0 };
  }

  async deleteOne(filter = {}) {
    if (MISSING_TABLES.has(this.tableName)) {
      const fallbackData = readFallbackData(this.tableName);
      const remaining = [];
      let deletedCount = 0;

      for (const doc of fallbackData) {
        if (matchFilter(doc, filter)) {
          deletedCount++;
        } else {
          remaining.push(doc);
        }
      }

      if (deletedCount > 0) {
        writeFallbackData(this.tableName, remaining);
      }
      return { deletedCount };
    }

    if (this.tableName === "test_marks" && filter._id && String(filter._id).includes("_")) {
      const [realId, studentUuid] = String(filter._id).split("_");
      
      const { data: testRow } = await this.supabase
        .from("test_marks")
        .select("*")
        .eq("id", realId)
        .maybeSingle();
        
      if (testRow) {
        const newMarksMap = { ...(testRow.marks || {}) };
        delete newMarksMap[studentUuid];
        
        if (Object.keys(newMarksMap).length === 0) {
          const { error } = await this.supabase
            .from("test_marks")
            .delete()
            .eq("id", realId);
          if (error) throw error;
        } else {
          const { error } = await this.supabase
            .from("test_marks")
            .update({ marks: newMarksMap })
            .eq("id", realId);
          if (error) throw error;
        }
      }
      return { deletedCount: 1 };
    }

    let query = this.supabase.from(this.tableName).delete();
    query = this.applyFilters(query, filter);

    const { data, error } = await query.select();
    if (error && (error.code === "PGRST205" || error.code === "42P01" || (error.message && (error.message.includes("schema cache") || error.message.includes("relation"))))) {
      console.warn(`Table "${this.tableName}" does not exist in DB, ignoring deleteOne.`);
      return { deletedCount: 0 };
    }
    if (error) throw error;
    return { deletedCount: data?.length || 0 };
  }

  async deleteMany(filter = {}) {
    return this.deleteOne(filter);
  }

  async updateMany(filter = {}, update = {}) {
    return this.updateOne(filter, update);
  }

  async findByIdAndUpdate(id, update = {}, options = {}) {
    if (MISSING_TABLES.has(this.tableName)) {
      const fallbackData = readFallbackData(this.tableName);
      const index = fallbackData.findIndex(doc => String(doc.id) === String(id) || String(doc._id) === String(id));
      if (index === -1) return null;

      const updated = applyUpdateJson(fallbackData[index], update);
      writeFallbackData(this.tableName, fallbackData);
      return new SupabaseDocument(this.tableName, updated, this);
    }

    const payload = update.$set ? update.$set : update;
    const dbPayload = {};
    for (const [key, val] of Object.entries(payload)) {
      const dbKey = camelToSnake(key);
      dbPayload[dbKey] = val;
    }

    const { data, error } = await this.supabase
      .from(this.tableName)
      .update(dbPayload)
      .eq("id", id)
      .select()
      .maybeSingle();

    if (error && (error.code === "PGRST205" || error.code === "42P01" || (error.message && (error.message.includes("schema cache") || error.message.includes("relation"))))) {
      console.warn(`Table "${this.tableName}" does not exist in DB, ignoring findByIdAndUpdate.`);
      return null;
    }
    if (error) throw error;
    return data ? new SupabaseDocument(this.tableName, data, this) : null;
  }

  async findByIdAndDelete(id) {
    if (MISSING_TABLES.has(this.tableName)) {
      const fallbackData = readFallbackData(this.tableName);
      const index = fallbackData.findIndex(doc => String(doc.id) === String(id) || String(doc._id) === String(id));
      if (index === -1) return null;

      const [deleted] = fallbackData.splice(index, 1);
      writeFallbackData(this.tableName, fallbackData);
      return new SupabaseDocument(this.tableName, deleted, this);
    }

    const { data, error } = await this.supabase
      .from(this.tableName)
      .delete()
      .eq("id", id)
      .select()
      .maybeSingle();

    if (error && (error.code === "PGRST205" || error.code === "42P01" || (error.message && (error.message.includes("schema cache") || error.message.includes("relation"))))) {
      console.warn(`Table "${this.tableName}" does not exist in DB, ignoring findByIdAndDelete.`);
      return null;
    }
    if (error) throw error;
    return data ? new SupabaseDocument(this.tableName, data, this) : null;
  }

  async findOneAndDelete(filter = {}) {
    if (MISSING_TABLES.has(this.tableName)) {
      const fallbackData = readFallbackData(this.tableName);
      const index = fallbackData.findIndex(doc => matchFilter(doc, filter));
      if (index === -1) return null;

      const [deleted] = fallbackData.splice(index, 1);
      writeFallbackData(this.tableName, fallbackData);
      return new SupabaseDocument(this.tableName, deleted, this);
    }

    let query = this.supabase.from(this.tableName).delete();
    query = this.applyFilters(query, filter);
    const { data, error } = await query.select().maybeSingle();

    if (error && (error.code === "PGRST205" || error.code === "42P01" || (error.message && (error.message.includes("schema cache") || error.message.includes("relation"))))) {
      console.warn(`Table "${this.tableName}" does not exist in DB, ignoring findOneAndDelete.`);
      return null;
    }
    if (error) throw error;
    return data ? new SupabaseDocument(this.tableName, data, this) : null;
  }

  async countDocuments(filter = {}) {
    if (MISSING_TABLES.has(this.tableName)) {
      const fallbackData = readFallbackData(this.tableName);
      const filtered = fallbackData.filter(doc => matchFilter(doc, filter));
      return filtered.length;
    }

    let attempt = 0;
    const currentFilter = { ...filter };

    if (this.tableName === "institutes" && (currentFilter.leadApiKey || currentFilter.lead_api_key)) {
      const keyToFind = currentFilter.leadApiKey || currentFilter.lead_api_key;
      const metadata = readInstitutesMetadata();
      const instId = Object.keys(metadata).find(id => metadata[id].leadApiKey === keyToFind);
      if (instId) {
        currentFilter.id = instId;
        delete currentFilter.leadApiKey;
        delete currentFilter.lead_api_key;
      }
    }

    for (const key of ["user", "institute", "institute_id", "instituteId"]) {
      if (currentFilter[key] && typeof currentFilter[key] === "string" && currentFilter[key].length === 36) {
        const { data: userData } = await this.supabase
          .from("users")
          .select("institute_id")
          .eq("id", currentFilter[key])
          .maybeSingle();
        if (userData && userData.institute_id) {
          currentFilter[key] = userData.institute_id;
        }
      }
    }
    while (attempt < 5) {
      let query = this.supabase.from(this.tableName).select("*", { count: "exact" }).limit(0);
      query = this.applyFilters(query, currentFilter);

      const { count, error } = await query;
      if (error && error.message && error.message.includes("does not exist")) {
        const match = error.message.match(/column "?([^"\s]+)"?/i);
        if (match && match[1]) {
          let badCol = match[1];
          if (badCol.includes(".")) {
            badCol = badCol.split(".")[1];
          }
          const filterKey = Object.keys(currentFilter).find(k => camelToSnake(k) === badCol);
          if (filterKey) {
            console.warn(`Stripping missing filter column "${filterKey}" from ${this.tableName} countDocuments query.`);
            delete currentFilter[filterKey];
            attempt++;
            continue;
          }
        }
      }
      if (error && (error.code === "PGRST205" || error.code === "42P01" || (error.message && (error.message.includes("schema cache") || error.message.includes("relation"))))) {
        console.warn(`Table "${this.tableName}" does not exist in DB, returning count 0.`);
        return 0;
      }
      if (error) {
        console.error(`countDocuments DB Error details on table "${this.tableName}":`, JSON.stringify(error, null, 2));
        throw error;
      }
      return count || 0;
    }
    return 0;
  }

  async aggregate(pipeline = []) {
    let matchStage = (pipeline || []).find(stage => stage.$match);
    let filter = matchStage?.$match || {};
    
    const { data: allInsts } = await this.supabase.from("institutes").select("id, admin_email");
    const demoIds = (allInsts || [])
      .filter(i => (i.admin_email && i.admin_email.toLowerCase().includes("demo")))
      .map(i => i.id);

    let query = this.supabase.from("students").select("enrollment_number, institute_id");

    if (filter.user && typeof filter.user === "string") {
      const matchId = filter.user;
      const { data: userData } = await this.supabase.from("users").select("institute_id").eq("id", matchId).maybeSingle();
      if (userData && userData.institute_id) {
        query = query.eq("institute_id", userData.institute_id);
      } else {
        query = query.eq("institute_id", matchId);
      }
    }

    if (filter.isDemoAccount === false || filter.isDemoAccount?.$ne === true) {
      if (demoIds.length > 0) {
        query = query.not("institute_id", "in", `(${demoIds.join(",")})`);
      }
    }

    if (filter.lastActiveAt) {
      let minTime = filter.lastActiveAt.$gte || filter.lastActiveAt;
      if (minTime) {
        query = query.gte("last_active_at", minTime instanceof Date ? minTime.toISOString() : minTime);
      }
    }

    let { data, error } = await query;
      
    if (error && error.message && error.message.includes("last_active_at")) {
      let retryQuery = this.supabase.from("students").select("enrollment_number, institute_id");
      if (filter.user && typeof filter.user === "string") {
        const matchId = filter.user;
        const { data: userData } = await this.supabase.from("users").select("institute_id").eq("id", matchId).maybeSingle();
        if (userData && userData.institute_id) {
          retryQuery = retryQuery.eq("institute_id", userData.institute_id);
        } else {
          retryQuery = retryQuery.eq("institute_id", matchId);
        }
      }
      if (filter.isDemoAccount === false || filter.isDemoAccount?.$ne === true) {
        if (demoIds.length > 0) {
          retryQuery = retryQuery.not("institute_id", "in", `(${demoIds.join(",")})`);
        }
      }
      const retry = await retryQuery;
      data = retry.data;
      error = retry.error;
    }
      
    if (error) throw error;
    
    const uniqueEnrollments = new Set(
      (data || [])
        .filter(row => {
          if (filter.isDemoAccount === false || filter.isDemoAccount?.$ne === true) {
            if (demoIds.includes(row.institute_id)) return false;
          }
          return true;
        })
        .map(row => row.enrollment_number)
    );
    return [{ count: uniqueEnrollments.size }];
  }
}

const mockMongoose = {
  Schema: class Schema {
    constructor(definition, options) {
      this.definition = definition;
      this.options = options;
    }
    virtual(name, options) {
      return {
        get(fn) {
          return this;
        },
        set(fn) {
          return this;
        }
      };
    }
    index(fields, options) {
      return this;
    }
    pre(hookName, fn) {
      return this;
    }
    post(hookName, fn) {
      return this;
    }
  },
  model(modelName, schema) {
    let tableName = "";
    if (modelName === "User") tableName = "users";
    else if (modelName === "Student") tableName = "students";
    else if (modelName === "Batch") tableName = "batches";
    else if (modelName === "Institute") tableName = "institutes";
    else if (modelName === "Note") tableName = "notes";
    else if (modelName === "Quiz") tableName = "quizzes";
    else if (modelName === "QuizAttempt") tableName = "quiz_attempts";
    else if (modelName === "TestResult") tableName = "test_marks";
    else if (modelName === "UptimeEvent") tableName = "uptime_events";
    else if (modelName === "SystemMetric" || modelName === "SystemSetting") tableName = "system_metrics";
    else if (modelName === "Notice") tableName = "notices";
    else if (modelName === "SystemLog") tableName = "system_logs";
    else if (modelName === "Lead") tableName = "leads";
    else if (modelName === "LeadForm") tableName = "lead_forms";
    else tableName = modelName.toLowerCase() + "s";

    return new SupabaseModel(tableName);
  },
  Types: {
    ObjectId: (function() {
      function ObjectId(val) {
        if (!(this instanceof ObjectId)) {
          return val;
        }
        this.value = val;
      }
      ObjectId.prototype.toString = function() {
        return this.value;
      };
      ObjectId.prototype.valueOf = function() {
        return this.value;
      };
      ObjectId.isValid = function(val) {
        return typeof val === "string" && val.length === 24 && /^[0-9a-fA-F]{24}$/.test(val);
      };
      return ObjectId;
    })()
  }
};

mockMongoose.Schema.Types = {
  ObjectId: "ObjectId",
  Mixed: "Mixed",
};

export default mockMongoose;
