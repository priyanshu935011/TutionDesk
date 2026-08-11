import Batch from "../models/Batch.js";
import Student from "../models/Student.js";
import Quiz from "../models/Quiz.js";
import Note from "../models/Note.js";
import TestResult from "../models/TestResult.js";
import QuizAttempt from "../models/QuizAttempt.js";
import { getCache, setCache, deleteCache, clearCachePattern } from "../utils/cache.js";


export const getBatches = async (req, res) => {
  try {
    const ownerId = req.user.role === "teacher" 
      ? (req.user.institute?.adminUser || req.user.institute?._id || req.user.institute)
      : (req.user.institute?._id || req.user.institute || req.user._id);

    const cacheKey = `teacher:batches:${ownerId}:${req.user.role}`;
    const cached = await getCache(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const query = { user: ownerId };
    if (req.user.role === "teacher") {
      query.teacher = req.user._id;
    }
    const [batches, students] = await Promise.all([
      Batch.find(query).sort({ createdAt: -1 }).populate("teacher", "name email"),
      Student.find({ user: ownerId }),
    ]);

    const processedBatches = batches.map((batch) => {
      const count = students.filter(
        (s) => s.batch && String(s.batch) === String(batch._id)
      ).length;
      return {
        ...batch.toJSON(),
        studentCount: count,
      };
    });

    await setCache(cacheKey, processedBatches, 86400);
    return res.json(processedBatches);
  } catch (error) {
    return res.status(500).json({ message: "Could not fetch batches" });
  }
};

export const createBatch = async (req, res) => {
  try {
    if (req.user.role === "teacher") {
      return res.status(403).json({ message: "Access denied. Teachers cannot create batches." });
    }

    const { name, scheduleDays, startTime, endTime, teacher } = req.body;

    if (!name || !startTime || !endTime) {
      return res.status(400).json({ message: "Batch name and schedule time are required" });
    }

    // Use institute ID (not user ID) to satisfy the institute_id FK constraint in Supabase
    const instituteId = req.user.institute?._id || req.user.institute || req.user._id;
    const batch = await Batch.create({
      user: instituteId,
      name,
      scheduleDays: Array.isArray(scheduleDays) ? scheduleDays : [],
      startTime,
      endTime,
      teacher: teacher || null,
    });

    const populated = await Batch.findById(batch._id).populate("teacher", "name email");
    await clearCachePattern("teacher:dashboard:*");
    await clearCachePattern("student:dashboard:*");
    await clearCachePattern("teacher:batches:*");
    return res.status(201).json(populated);
  } catch (error) {
    console.error("createBatch error:", error);
    return res.status(500).json({ message: error.message || "Could not create batch" });
  }
};

export const updateBatch = async (req, res) => {
  try {
    if (req.user.role === "teacher") {
      return res.status(403).json({ message: "Access denied. Teachers cannot modify batches." });
    }

    const { name, scheduleDays, startTime, endTime, teacher, status } = req.body;
    
    const updateData = {
      name,
      scheduleDays: Array.isArray(scheduleDays) ? scheduleDays : [],
      startTime,
      endTime,
      teacher: (teacher && teacher !== "") ? teacher : null,
    };
    
    if (status !== undefined) {
      updateData.status = status;
    }

    const ownerId = req.user.institute?._id || req.user.institute || req.user._id;

    const batch = await Batch.findOneAndUpdate(
      { _id: req.params.id, user: ownerId },
      updateData,
      { new: true, runValidators: true }
    ).populate("teacher", "name email");

    if (!batch) {
      return res.status(404).json({ message: "Batch not found" });
    }

    await clearCachePattern("teacher:dashboard:*");
    await clearCachePattern("student:dashboard:*");
    await clearCachePattern("teacher:batches:*");
    return res.json(batch);
  } catch (error) {
    console.error("updateBatch error:", error);
    return res.status(500).json({ message: error.message || "Could not update batch" });
  }
};

export const deleteBatch = async (req, res) => {
  try {
    if (req.user.role === "teacher") {
      return res.status(403).json({ message: "Access denied. Teachers cannot delete batches." });
    }

    const batchId = req.params.id;
    const ownerId = req.user.institute?._id || req.user.institute || req.user._id;

    // Find the batch first to confirm it belongs to the user
    const batch = await Batch.findOne({
      _id: batchId,
      user: ownerId,
    });

    if (!batch) {
      return res.status(404).json({ message: "Batch not found" });
    }

    // Find all student records in this batch
    const studentsInBatch = await Student.find({
      user: ownerId,
      batch: batchId,
    });

    for (const student of studentsInBatch) {
      const email = student.email ? student.email.toLowerCase().trim() : "";
      const phone = student.phone ? student.phone.trim() : "";

      // Find all records for this student at this institute
      const allStudentRecords = await Student.find({
        user: ownerId,
        $or: [
          ...(email ? [{ email }] : []),
          ...(phone ? [{ phone }] : []),
        ].filter(Boolean),
      });

      const otherRecords = allStudentRecords.filter((r) => String(r._id) !== String(student._id));

      if (otherRecords.length > 0) {
        // If student is enrolled in multiple batches:
        // Delete the student record for this batch, but transfer fees if this record held them
        const holdsFees = Number(student.totalFees || 0) > 0 || (student.paymentHistory && student.paymentHistory.length > 0);
        if (holdsFees) {
          const recipient = otherRecords[0];
          recipient.totalFees = student.totalFees;
          recipient.feePlanType = student.feePlanType;
          recipient.dueDate = student.dueDate;
          recipient.paymentHistory = student.paymentHistory;
          await recipient.save();
        }
        
        await Student.deleteOne({ _id: student._id });
        await TestResult.deleteMany({ student: student._id });
        await QuizAttempt.deleteMany({ student: student._id });
      } else {
        // If enrolled ONLY in this batch, delete completely
        await Student.deleteOne({ _id: student._id });
        await TestResult.deleteMany({ student: student._id });
        await QuizAttempt.deleteMany({ student: student._id });
      }
    }

    // Clean up notes for this batch
    await Note.deleteMany({ batch: batchId });

    // Remove this batch from all quizzes
    await Quiz.updateMany(
      { batches: batchId },
      { $pull: { batches: batchId } }
    );

    // Finally delete the batch
    await Batch.deleteOne({ _id: batchId });

    await clearCachePattern("teacher:dashboard:*");
    await clearCachePattern("student:dashboard:*");
    await clearCachePattern("teacher:batches:*");

    return res.json({ message: "Batch and associated student records deleted successfully" });
  } catch (error) {
    console.error("deleteBatch error:", error);
    return res.status(500).json({ message: "Could not delete batch" });
  }
};
// Trivial change to force reload server - attempt 2
