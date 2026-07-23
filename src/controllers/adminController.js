import bcrypt from "bcryptjs";
import mongoose from "../utils/supabaseModel.js";
import Institute from "../models/Institute.js";
import UptimeEvent from "../models/UptimeEvent.js";
import TestResult from "../models/TestResult.js";
import QuizAttempt from "../models/QuizAttempt.js";
import Student from "../models/Student.js";
import Batch from "../models/Batch.js";
import User from "../models/User.js";
import SystemMetric from "../models/SystemMetric.js";
import Note from "../models/Note.js";
import Notice from "../models/Notice.js";
import Quiz from "../models/Quiz.js";
import SystemLog from "../models/SystemLog.js";
import { inMemoryLogs } from "../utils/systemLogger.js";
import { isSubscriptionExpired, resolveSubscriptionEnd } from "../utils/subscription.js";
import redisClient from "../config/redis.js";
import { clearCachePattern } from "../utils/cache.js";

const getAdminEmails = async () => {
  try {
    const adminUsers = await User.find({ role: { $in: ["super_admin", "institute_admin"] } }).select("email");
    const adminEmails = adminUsers.map(u => u.email.toLowerCase()).filter(Boolean);
    if (process.env.SUPER_ADMIN_EMAIL) {
      adminEmails.push(process.env.SUPER_ADMIN_EMAIL.toLowerCase());
    }
    return [...new Set(adminEmails)];
  } catch (error) {
    console.error("getAdminEmails error:", error);
    return [];
  }
};

const hydrateInstitute = async (institute, adminEmails) => {
  const matchUser = institute.adminUser ? (mongoose.Types.ObjectId.isValid(institute.adminUser) ? new mongoose.Types.ObjectId(institute.adminUser) : institute.adminUser) : null;
  const [studentCountResult, batchCount] = await Promise.all([
    Student.aggregate([
      { $match: { user: matchUser, email: { $nin: adminEmails } } },
      { $group: { _id: "$enrollmentNumber" } },
      { $count: "count" }
    ]),
    Batch.countDocuments({ user: institute.adminUser }),
  ]);

  const studentCount = studentCountResult[0]?.count || 0;

  return {
    ...institute.toObject(),
    studentCount,
    batchCount,
    subscriptionStatus: isSubscriptionExpired(institute) ? "expired" : "active",
  };
};

const getNextStartDate = (institute) => {
  const lastHistory = (institute.subscriptionHistory || []).slice().sort(
    (a, b) => new Date(b.endDate).getTime() - new Date(a.endDate).getTime()
  )[0];

  return lastHistory ? new Date(lastHistory.endDate) : new Date(institute.subscriptionStart);
};

export const getAdminOverview = async (req, res) => {
  try {
    const adminEmails = await getAdminEmails();

    const [institutes, totalStudentsResult, totalTeachers, totalSolo, totalInstitutions] = await Promise.all([
      Institute.find().sort({ createdAt: -1 }),
      Student.aggregate([
        { $match: { email: { $nin: adminEmails }, isDemoAccount: { $ne: true } } },
        { $group: { _id: "$enrollmentNumber" } },
        { $count: "count" }
      ]),
      User.countDocuments({ role: "teacher", isDemoAccount: { $ne: true } }),
      Institute.countDocuments({ tuitionType: "solo", isDemoAccount: { $ne: true } }),
      Institute.countDocuments({ tuitionType: "institution", isDemoAccount: { $ne: true } }),
    ]);

    const totalStudents = totalStudentsResult[0]?.count || 0;

    const hydrated = await Promise.all(institutes.map((institute) => hydrateInstitute(institute, adminEmails)));

    const now = Date.now();
    const sevenDays = 1000 * 60 * 60 * 24 * 7;

    // Active Now: count users/students active in the last 5 minutes (excluding demo)
    let activeNow = 0;
    if (redisClient.isReady) {
      let count = 0;
      for await (const key of redisClient.scanIterator({
        MATCH: "active:user:*",
        COUNT: 500,
      })) {
        count++;
      }
      activeNow = count;
    } else {
      const fiveMinsAgo = new Date(now - 5 * 60 * 1000);
      const [activeUsersNow, activeStudentsNowResult] = await Promise.all([
        User.countDocuments({ lastActiveAt: { $gte: fiveMinsAgo }, isDemoAccount: { $ne: true } }),
        Student.aggregate([
          { $match: { lastActiveAt: { $gte: fiveMinsAgo }, email: { $nin: adminEmails }, isDemoAccount: { $ne: true } } },
          { $group: { _id: "$enrollmentNumber" } },
          { $count: "count" }
        ]),
      ]);
      const activeStudentsNow = activeStudentsNowResult[0]?.count || 0;
      activeNow = activeUsersNow + activeStudentsNow;
    }

    // Active Today: count users/students active since midnight (excluding demo)
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const [activeUsersToday, activeStudentsTodayResult] = await Promise.all([
      User.countDocuments({ lastActiveAt: { $gte: startOfToday }, isDemoAccount: { $ne: true } }),
      Student.aggregate([
        { $match: { lastActiveAt: { $gte: startOfToday }, email: { $nin: adminEmails }, isDemoAccount: { $ne: true } } },
        { $group: { _id: "$enrollmentNumber" } },
        { $count: "count" }
      ]),
    ]);
    const activeStudentsToday = activeStudentsTodayResult[0]?.count || 0;
    const activeToday = activeUsersToday + activeStudentsToday;

    // Peak Concurrent: read from SystemMetric
    let highestConcurrent = activeNow;
    try {
      const peakMetric = await SystemMetric.findOne({ key: "highestConcurrentActiveUsers" });
      if (peakMetric) {
        highestConcurrent = Number(peakMetric.value || 0);
      }
    } catch (e) {
      console.warn("Could not query highestConcurrentActiveUsers from system_metrics:", e.message);
    }

    // Growth Analytics signup trends (last 6 months, excluding demo)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
    sixMonthsAgo.setDate(1);
    sixMonthsAgo.setHours(0, 0, 0, 0);

    const [institutesSignups, studentsSignups] = await Promise.all([
      Institute.find({ createdAt: { $gte: sixMonthsAgo }, isDemoAccount: { $ne: true } }).select("createdAt"),
      Student.find({ createdAt: { $gte: sixMonthsAgo }, email: { $nin: adminEmails }, isDemoAccount: { $ne: true } }).select("createdAt"),
    ]);

    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const yearMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      months.push({ month: yearMonth, institutesCount: 0, studentsCount: 0 });
    }

    for (const inst of institutesSignups) {
      const date = new Date(inst.createdAt);
      const ym = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      const bucket = months.find((m) => m.month === ym);
      if (bucket) bucket.institutesCount += 1;
    }

    for (const stud of studentsSignups) {
      const date = new Date(stud.createdAt);
      const ym = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      const bucket = months.find((m) => m.month === ym);
      if (bucket) bucket.studentsCount += 1;
    }

    const isDemoAccountDoc = (inst) =>
      Boolean(inst.isDemoAccount) === true ||
      Boolean(inst.adminEmail && inst.adminEmail.toLowerCase().includes("demo"));

    const summary = hydrated.reduce(
      (totals, institute) => {
        // Exclude Demo Accounts from Super Admin statistics completely
        if (isDemoAccountDoc(institute)) {
          totals.demoCount += 1;
          return totals;
        }

        totals.totalInstitutes += 1;
        totals.activeInstitutes += institute.subscriptionStatus === "active" ? 1 : 0;
        totals.expiredInstitutes += institute.subscriptionStatus === "expired" ? 1 : 0;
        totals.totalRevenueTillDate += (institute.subscriptionHistory || []).reduce(
          (sum, item) => sum + Number(item.amount || 0),
          0
        );
        totals.monthlyRecurringRevenue +=
          institute.subscriptionPlan === "monthly" && institute.subscriptionStatus === "active"
            ? Number(institute.subscriptionAmount || 0)
            : 0;

        const expiresSoon =
          institute.subscriptionStatus === "active" &&
          new Date(institute.subscriptionEnd).getTime() - now <= sevenDays;

        if (expiresSoon) {
          totals.expiringSoon += 1;
          totals.expiringInstitutes.push(institute);
        }

        return totals;
      },
      {
        totalInstitutes: 0,
        activeInstitutes: 0,
        expiredInstitutes: 0,
        expiringSoon: 0,
        totalRevenueTillDate: 0,
        monthlyRecurringRevenue: 0,
        expiringInstitutes: [],
        totalStudents,
        totalTeachers,
        totalSolo,
        totalInstitutions,
        activeNow,
        activeToday,
        highestConcurrent,
        registrationStats: months,
        demoCount: 0,
      }
    );

    return res.json({
      summary,
      institutes: hydrated,
    });
  } catch (error) {
    console.error("getAdminOverview error:", error);
    return res.status(500).json({ message: "Could not load admin overview" });
  }
};

export const getInstituteDetail = async (req, res) => {
  try {
    const institute = await Institute.findById(req.params.id);

    if (!institute) {
      return res.status(404).json({ message: "Tution not found" });
    }

    const hydrated = await hydrateInstitute(institute);

    return res.json(hydrated);
  } catch (error) {
    return res.status(500).json({ message: "Could not load tution detail" });
  }
};

export const createInstitute = async (req, res) => {
  try {
    const {
      name,
      ownerName,
      adminEmail,
      adminPhone,
      adminPassword,
      subscriptionPlan,
      subscriptionAmount,
      trialDays,
      subscriptionStart,
      tuitionType,
      quizFeatureEnabled,
      brandingEnabled,
      logoUrl,
      themeColor,
      allowedFeatures,
    } = req.body;

    if (
      !name ||
      !ownerName ||
      !adminEmail ||
      !adminPassword ||
      !subscriptionPlan ||
      subscriptionAmount === undefined ||
      !subscriptionStart
    ) {
      return res.status(400).json({ message: "All required fields must be filled" });
    }

    const normalizedEmail = adminEmail.toLowerCase();
    const existingUser = await User.findOne({ email: normalizedEmail });

    if (existingUser) {
      return res.status(400).json({ message: "Admin email already exists" });
    }

    const startDate = new Date(subscriptionStart);
    const endDate = resolveSubscriptionEnd({
      subscriptionPlan,
      subscriptionStart: startDate,
      trialDays,
    });

    if (!endDate) {
      return res.status(400).json({ message: "Invalid subscription plan" });
    }

    const institute = await Institute.create({
      name,
      ownerName,
      adminEmail: normalizedEmail,
      adminPhone: adminPhone || "",
      subscriptionPlan,
      subscriptionAmount: Number(subscriptionAmount),
      trialDays: Number(trialDays || 14),
      subscriptionStart: startDate,
      subscriptionEnd: endDate,
      status: "active",
      tuitionType: tuitionType || "solo",
      quizFeatureEnabled: quizFeatureEnabled !== false,
      brandingEnabled: brandingEnabled !== false,
      logoUrl: logoUrl || null,
      themeColor: themeColor || "#6366f1",
      allowedFeatures: allowedFeatures || ["attendance", "notes", "marks", "tests", "whatsapp"],
      subscriptionHistory: [
        {
          plan: subscriptionPlan,
          amount: Number(subscriptionAmount),
          startDate,
          endDate,
          trialDays: Number(trialDays || 14),
          note: "Initial subscription",
        },
      ],
    });

    const hashedPassword = await bcrypt.hash(adminPassword, 10);
    const user = await User.create({
      email: normalizedEmail,
      password: hashedPassword,
      role: "institute_admin",
      institute: institute._id,
    });

    institute.adminUser = user._id;
    await institute.save();

    return res.status(201).json({
      institute: await hydrateInstitute(institute),
      adminCredentials: {
        email: normalizedEmail,
        password: adminPassword,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: "Could not create tution" });
  }
};

export const updateInstitute = async (req, res) => {
  try {
    const institute = await Institute.findById(req.params.id);

    if (!institute) {
      return res.status(404).json({ message: "Tution not found" });
    }

    const {
      name,
      ownerName,
      adminEmail,
      adminPhone,
      adminPassword,
      subscriptionPlan,
      subscriptionAmount,
      trialDays,
      subscriptionStart,
      status,
      tuitionType,
      quizFeatureEnabled,
      brandingEnabled,
      logoUrl,
      themeColor,
      allowedFeatures,
    } = req.body;

    if (adminEmail && adminEmail.toLowerCase() !== institute.adminEmail) {
      const existingUser = await User.findOne({ email: adminEmail.toLowerCase() });
      if (existingUser && String(existingUser._id) !== String(institute.adminUser)) {
        return res.status(400).json({ message: "Admin email already exists" });
      }
    }

    if (name !== undefined) institute.name = name;
    if (ownerName !== undefined) institute.ownerName = ownerName;
    if (adminPhone !== undefined) institute.adminPhone = adminPhone;
    if (adminEmail !== undefined) institute.adminEmail = adminEmail.toLowerCase();
    if (subscriptionPlan !== undefined) institute.subscriptionPlan = subscriptionPlan;
    if (subscriptionAmount !== undefined) institute.subscriptionAmount = Number(subscriptionAmount);
    if (trialDays !== undefined) institute.trialDays = Number(trialDays);
    if (subscriptionStart !== undefined) institute.subscriptionStart = new Date(subscriptionStart);
    if (status !== undefined) institute.status = status;
    if (tuitionType !== undefined) institute.tuitionType = tuitionType;
    if (quizFeatureEnabled !== undefined) institute.quizFeatureEnabled = Boolean(quizFeatureEnabled);
    if (brandingEnabled !== undefined) institute.brandingEnabled = Boolean(brandingEnabled);
    if (logoUrl !== undefined) institute.logoUrl = logoUrl;
    if (themeColor !== undefined) institute.themeColor = themeColor;
    if (allowedFeatures !== undefined) institute.allowedFeatures = allowedFeatures;

    institute.subscriptionEnd = resolveSubscriptionEnd({
      subscriptionPlan: institute.subscriptionPlan,
      subscriptionStart: institute.subscriptionStart,
      trialDays: institute.trialDays,
    });

    await institute.save();

    if (institute.adminUser) {
      const adminUser = await User.findById(institute.adminUser);
      if (adminUser) {
        if (adminEmail !== undefined) adminUser.email = adminEmail.toLowerCase();
        if (adminPassword) adminUser.password = await bcrypt.hash(adminPassword, 10);
        await adminUser.save();
      }
    }

    await clearCachePattern("teacher:dashboard:*");
    await clearCachePattern("student:dashboard:*");

    return res.json(await hydrateInstitute(institute));
  } catch (error) {
    return res.status(500).json({ message: "Could not update tution" });
  }
};

export const renewInstituteSubscription = async (req, res) => {
  try {
    const institute = await Institute.findById(req.params.id);

    if (!institute) {
      return res.status(404).json({ message: "Tution not found" });
    }

    const { plan, amount, trialDays, note } = req.body;

    if (!plan || amount === undefined) {
      return res.status(400).json({ message: "Plan and amount are required" });
    }

    const nextStart = getNextStartDate(institute);
    const nextEnd = resolveSubscriptionEnd({
      subscriptionPlan: plan,
      subscriptionStart: nextStart,
      trialDays,
    });

    if (!nextEnd) {
      return res.status(400).json({ message: "Invalid subscription plan" });
    }

    institute.subscriptionPlan = plan;
    institute.subscriptionAmount = Number(amount);
    institute.trialDays = Number(trialDays || institute.trialDays || 14);
    institute.subscriptionStart = nextStart;
    institute.subscriptionEnd = nextEnd;
    institute.status = "active";
    institute.subscriptionHistory.unshift({
      plan,
      amount: Number(amount),
      startDate: nextStart,
      endDate: nextEnd,
      trialDays: Number(trialDays || institute.trialDays || 14),
      note: note || "Renewal",
    });

    await institute.save();

    await clearCachePattern("teacher:dashboard:*");
    await clearCachePattern("student:dashboard:*");

    const adminEmails = await getAdminEmails();
    return res.json(await hydrateInstitute(institute, adminEmails));
  } catch (error) {
    return res.status(500).json({ message: "Could not renew subscription" });
  }
};

export const deleteInstitute = async (req, res) => {
  try {
    const institute = await Institute.findById(req.params.id);

    if (!institute) {
      return res.status(404).json({ message: "Tution not found" });
    }

    const adminEmails = await getAdminEmails();
    const [userCount, batchCount, studentCount] = await Promise.all([
      User.countDocuments({ institute: institute._id }),
      Batch.countDocuments({ user: institute.adminUser }),
      Student.countDocuments({ user: institute.adminUser, email: { $nin: adminEmails } }),
    ]);

    await Promise.all([
      Student.deleteMany({ user: institute.adminUser }),
      Batch.deleteMany({ user: institute.adminUser }),
      User.deleteMany({ institute: institute._id }),
      Institute.deleteOne({ _id: institute._id }),
    ]);

    await clearCachePattern("teacher:dashboard:*");
    await clearCachePattern("student:dashboard:*");

    return res.json({
      message: "Tution deleted successfully",
      deleted: { userCount, batchCount, studentCount },
    });
  } catch (error) {
    return res.status(500).json({ message: "Could not delete tution" });
  }
};

export const getUptimeOverview = async (req, res) => {
  try {
    let events = [];
    let downEvents = [];
    try {
      events = await UptimeEvent.find().sort({ startedAt: -1 }).limit(20);
      downEvents = await UptimeEvent.find({ status: "down" }).sort({ startedAt: -1 }).limit(20);
    } catch (e) {
      console.warn("Could not query uptime_events from database, using empty:", e.message);
    }

    const totalDownMinutes = downEvents.reduce((sum, event) => {
      if (!event.endedAt) {
        return sum;
      }
      return sum + Math.max(0, Math.round((event.endedAt.getTime() - event.startedAt.getTime()) / 60000));
    }, 0);

    return res.json({
      serverStatus: "up",
      processUptimeSeconds: Math.floor(process.uptime()),
      totalTrackedDowntimeMinutes: totalDownMinutes,
      recentEvents: events.map((event) => ({
        id: event._id,
        status: event.status,
        reason: event.reason,
        startedAt: event.startedAt,
        endedAt: event.endedAt,
        durationMinutes: event.endedAt
          ? Math.max(0, Math.round((event.endedAt.getTime() - event.startedAt.getTime()) / 60000))
          : 0,
      })),
    });
  } catch (error) {
    return res.status(500).json({ message: "Could not load uptime overview" });
  }
};

export const getAdminTeachers = async (req, res) => {
  try {
    const adminEmails = await getAdminEmails();
    const teachers = await User.find({ role: "teacher" })
      .populate("institute", "name")
      .sort({ lastActiveAt: -1, createdAt: -1 });

    const teachersWithDetails = await Promise.all(
      teachers.map(async (teacher) => {
        const teacherBatches = await Batch.find({ teacher: teacher._id }).select(
          "name scheduleDays startTime endTime"
        );
        
        const batchesWithCounts = await Promise.all(
          teacherBatches.map(async (b) => {
            const studentCount = await Student.countDocuments({ batch: b._id, email: { $nin: adminEmails } });
            return {
              ...b.toObject(),
              studentCount,
            };
          })
        );

        return {
          ...teacher.toObject(),
          batches: batchesWithCounts,
          batchCount: batchesWithCounts.length,
        };
      })
    );

    return res.json(teachersWithDetails);
  } catch (error) {
    return res.status(500).json({ message: "Could not fetch teachers list" });
  }
};

export const getAdminStudents = async (req, res) => {
  try {
    const adminEmails = await getAdminEmails();
    const allStudents = await Student.find({ email: { $nin: adminEmails } })
      .populate({
        path: "batch",
        select: "name teacher",
        populate: {
          path: "teacher",
          select: "name email",
        },
      })
      .sort({ lastActiveAt: -1, createdAt: -1 });

    const demoInstitutes = await Institute.find().select("_id isDemoAccount adminEmail");
    const demoInstMap = (demoInstitutes || []).reduce((map, inst) => {
      const isDemo = Boolean(inst.isDemoAccount) || Boolean(inst.adminEmail && inst.adminEmail.toLowerCase().includes("demo"));
      map[String(inst._id)] = isDemo;
      return map;
    }, {});

    const realStudents = allStudents.filter((student) => {
      if (student.isDemoAccount) return false;
      const instId = String(student.user);
      if (demoInstMap[instId]) return false;
      return true;
    });

    const studentsWithDetails = await Promise.all(
      realStudents.map(async (student) => {
        const institute = student.user
          ? await Institute.findById(student.user).select("name")
          : null;

        return {
          ...student.toJSON(),
          instituteName: institute ? institute.name : "Unknown",
        };
      })
    );

    return res.json(studentsWithDetails);
  } catch (error) {
    return res.status(500).json({ message: "Could not fetch students list" });
  }
};

export const updateAdminTeacher = async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const teacher = await User.findOne({ _id: req.params.id, role: "teacher" });
    if (!teacher) {
      return res.status(404).json({ message: "Teacher not found" });
    }

    if (email) {
      const normalizedEmail = email.toLowerCase();
      const existingUser = await User.findOne({ email: normalizedEmail, _id: { $ne: teacher._id } });
      if (existingUser) {
        return res.status(400).json({ message: "Email already in use" });
      }
      teacher.email = normalizedEmail;
    }

    if (name !== undefined) teacher.name = name;
    if (password) {
      teacher.password = await bcrypt.hash(password, 10);
    }

    await teacher.save();
    await clearCachePattern("teacher:dashboard:*");
    await clearCachePattern("student:dashboard:*");
    return res.json({ message: "Teacher updated successfully", teacher: { _id: teacher._id, name: teacher.name, email: teacher.email } });
  } catch (error) {
    return res.status(500).json({ message: "Could not update teacher" });
  }
};

export const deleteAdminTeacher = async (req, res) => {
  try {
    const teacher = await User.findOneAndDelete({ _id: req.params.id, role: "teacher" });
    if (!teacher) {
      return res.status(404).json({ message: "Teacher not found" });
    }

    await Batch.updateMany({ teacher: teacher._id }, { $set: { teacher: null } });

    await clearCachePattern("teacher:dashboard:*");
    await clearCachePattern("student:dashboard:*");

    return res.json({ message: "Teacher deleted successfully" });
  } catch (error) {
    return res.status(500).json({ message: "Could not delete teacher" });
  }
};

export const updateAdminStudent = async (req, res) => {
  try {
    const { name, email, phone, parentName, parentPhone, address, pendingAmount, totalFees, paidAmount, dueDate, feePlanType } = req.body;
    const student = await Student.findById(req.params.id);
    if (!student) {
      return res.status(404).json({ message: "Student not found" });
    }

    if (name !== undefined) student.name = name;
    if (email !== undefined) student.email = email.toLowerCase();
    if (phone !== undefined) student.phone = phone;
    if (parentName !== undefined) student.parentName = parentName;
    if (parentPhone !== undefined) student.parentPhone = parentPhone;
    if (address !== undefined) student.address = address;
    if (pendingAmount !== undefined) student.pendingAmount = Number(pendingAmount);
    if (totalFees !== undefined) student.totalFees = Number(totalFees);
    if (paidAmount !== undefined) student.paidAmount = Number(paidAmount);
    if (dueDate !== undefined) student.dueDate = dueDate;
    if (feePlanType !== undefined) student.feePlanType = feePlanType;

    await student.save();

    if (student.enrollmentNumber) {
      await Student.updateMany(
        { enrollmentNumber: student.enrollmentNumber, _id: { $ne: student._id } },
        {
          $set: {
            name: student.name,
            email: student.email,
            phone: student.phone,
            parentName: student.parentName,
            parentPhone: student.parentPhone,
            address: student.address,
          }
        }
      );
    }

    await clearCachePattern("teacher:dashboard:*");
    await clearCachePattern("student:dashboard:*");

    return res.json({ message: "Student updated successfully", student });
  } catch (error) {
    return res.status(500).json({ message: "Could not update student" });
  }
};

export const deleteAdminStudent = async (req, res) => {
  try {
    const student = await Student.findByIdAndDelete(req.params.id);
    if (!student) {
      return res.status(404).json({ message: "Student not found" });
    }

    await Promise.all([
      TestResult.deleteMany({ student: student._id }),
      QuizAttempt.deleteMany({ student: student._id }),
    ]);

    await clearCachePattern("teacher:dashboard:*");
    await clearCachePattern("student:dashboard:*");

    return res.json({ message: "Student deleted successfully" });
  } catch (error) {
    return res.status(500).json({ message: "Could not delete student" });
  }
};

import cloudinary from "../utils/cloudinary.js";
import { Readable } from "stream";

const uploadBufferToCloudinary = (buffer, options = {}) =>
  new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: "image",
        folder: "tutiondesk/logos",
        ...options,
      },
      (error, result) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(result);
      },
    );
    Readable.from(buffer).pipe(uploadStream);
  });

export const uploadInstituteLogo = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }
    const result = await uploadBufferToCloudinary(req.file.buffer);
    return res.json({ logoUrl: result.secure_url });
  } catch (error) {
    console.error("uploadInstituteLogo error:", error);
    return res.status(500).json({ message: "Could not upload logo" });
  }
};

export const getDemoAccounts = async (req, res) => {
  try {
    const allInstitutes = await Institute.find().sort({ createdAt: -1 });
    const demoInstitutes = allInstitutes.filter(
      (inst) =>
        Boolean(inst.isDemoAccount) === true ||
        Boolean(inst.adminEmail && inst.adminEmail.toLowerCase().includes("demo"))
    );
    
    const demoAccounts = await Promise.all(
      demoInstitutes.map(async (inst) => {
        const adminUser = inst.adminUser ? await User.findById(inst.adminUser).select("_id email name role") : null;
        const teachers = await User.find({ institute: inst._id, role: "teacher" }).select("_id name email");
        const students = await Student.find({ user: inst.adminUser }).select("_id name phone email enrollmentNumber");
        return {
          institute: inst,
          adminUser,
          teachers,
          students,
        };
      })
    );

    return res.json(demoAccounts);
  } catch (error) {
    console.error("getDemoAccounts error:", error);
    return res.status(500).json({ message: "Could not fetch demo accounts." });
  }
};

export const createDemoAccount = async (req, res) => {
  try {
    const { name, ownerName, adminEmail, adminPhone, password } = req.body;

    if (!name || !ownerName || !adminEmail || !password) {
      return res.status(400).json({ message: "Institute name, owner name, admin email, and password are required." });
    }

    const existingUser = await User.findOne({ email: adminEmail.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ message: "A user with this email already exists." });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const startDate = new Date();
    const endDate = new Date(Date.now() + 3650 * 24 * 60 * 60 * 1000); // 10 years demo duration

    const institute = await Institute.create({
      name,
      ownerName,
      adminEmail: adminEmail.toLowerCase(),
      adminPhone: adminPhone || "",
      subscriptionPlan: "yearly",
      subscriptionAmount: 0,
      subscriptionStart: startDate,
      subscriptionEnd: endDate,
      status: "active",
      tuitionType: "institution",
      isDemoAccount: true,
      allowedFeatures: ["attendance", "notes", "marks", "tests", "whatsapp", "notices", "quizzes"],
      subscriptionHistory: [
        {
          plan: "yearly",
          amount: 0,
          startDate,
          endDate,
          note: "Demo Account Lifetime Access",
        },
      ],
    });

    const adminUser = await User.create({
      email: adminEmail.toLowerCase(),
      password: hashedPassword,
      name: ownerName,
      role: "institute_admin",
      institute: institute._id,
      isDemoAccount: true,
    });

    institute.adminUser = adminUser._id;
    await institute.save();

    // Create default demo batch and sample demo students
    try {
      const demoBatch = await Batch.create({
        institute: institute._id,
        user: adminUser._id,
        name: "Demo Batch 10th",
        scheduleDays: ["Mon", "Wed", "Fri"],
        startTime: "16:00",
        endTime: "17:30",
      });

      const todayStr = new Date();
      const sampleStudents = [
        { name: "Rohan Sharma", phone: "8888888888", parentName: "Suresh Sharma", parentPhone: "8888888888", email: "rohan.demo@gmail.com", enrollmentNumber: "ENR9001", totalFees: 2000, feePlanType: "monthly" },
        { name: "Aarav Patel", phone: "9999999999", parentName: "Rajesh Patel", parentPhone: "9999999999", email: "aarav.demo@gmail.com", enrollmentNumber: "ENR9002", totalFees: 2000, feePlanType: "monthly" },
        { name: "Priya Singh", phone: "9999999999", parentName: "Vikram Singh", parentPhone: "9999999999", email: "priya.demo@gmail.com", enrollmentNumber: "ENR9003", totalFees: 2500, feePlanType: "monthly" },
        { name: "Ananya Verma", phone: "9999999999", parentName: "Amit Verma", parentPhone: "9999999999", email: "ananya.demo@gmail.com", enrollmentNumber: "ENR9004", totalFees: 2000, feePlanType: "monthly" },
        { name: "Kabir Gupta", phone: "9999999999", parentName: "Sanjay Gupta", parentPhone: "9999999999", email: "kabir.demo@gmail.com", enrollmentNumber: "ENR9005", totalFees: 3000, feePlanType: "full_course" },
      ];

      for (const s of sampleStudents) {
        await Student.create({
          user: adminUser._id,
          name: s.name,
          phone: s.phone,
          parentName: s.parentName,
          parentPhone: s.parentPhone,
          email: s.email,
          enrollmentNumber: s.enrollmentNumber,
          batch: demoBatch._id,
          joinedOn: todayStr,
          dueDate: todayStr,
          totalFees: s.totalFees,
          feePlanType: s.feePlanType,
          isDemoAccount: true,
        });
      }
    } catch (seedErr) {
      console.warn("Could not seed initial demo batch/students:", seedErr.message);
    }

    await clearCachePattern("admin:*");
    return res.status(201).json({ message: "Demo institute and credentials created successfully.", institute, adminUser });
  } catch (error) {
    console.error("createDemoAccount error:", error);
    return res.status(500).json({ message: "Could not create demo account." });
  }
};

export const updateDemoCredentials = async (req, res) => {
  try {
    const { id } = req.params;
    const { adminEmail, password, name, ownerName, adminPhone } = req.body;

    const institute = await Institute.findById(id);
    if (!institute) {
      return res.status(404).json({ message: "Institute not found." });
    }

    if (name) institute.name = name;
    if (ownerName) institute.ownerName = ownerName;
    if (adminPhone !== undefined) institute.adminPhone = adminPhone;

    if (adminEmail && adminEmail.toLowerCase() !== institute.adminEmail.toLowerCase()) {
      const existingUser = await User.findOne({ email: adminEmail.toLowerCase(), _id: { $ne: institute.adminUser } });
      if (existingUser) {
        return res.status(400).json({ message: "Another user already exists with this email." });
      }
      institute.adminEmail = adminEmail.toLowerCase();
    }

    await institute.save();

    if (institute.adminUser) {
      const user = await User.findById(institute.adminUser);
      if (user) {
        if (adminEmail) user.email = adminEmail.toLowerCase();
        if (password) user.password = await bcrypt.hash(password, 10);
        if (ownerName) user.name = ownerName;
        user.isDemoAccount = true;
        await user.save();
      }
    }

    await clearCachePattern("admin:*");
    return res.json({ message: "Demo account credentials updated successfully.", institute });
  } catch (error) {
    console.error("updateDemoCredentials error:", error);
    return res.status(500).json({ message: "Could not update demo credentials." });
  }
};

export const getInstituteFullAnalytics = async (req, res) => {
  try {
    const { id } = req.params;
    const institute = await Institute.findById(id);
    if (!institute) {
      return res.status(404).json({ message: "Tuition not found" });
    }

    const adminEmails = await getAdminEmails();
    const adminUser = institute.adminUser ? await User.findById(institute.adminUser).select("_id email name role lastActiveAt createdAt") : null;
    
    // Find all teachers under this institute
    const teachers = await User.find({ institute: institute._id, role: "teacher" }).select("_id name email lastActiveAt createdAt");

    // Find all batches under this institute
    const batches = await Batch.find({ user: institute.adminUser }).select("_id name scheduleDays startTime endTime teacher");

    // Find all students under this institute
    const students = await Student.find({ user: institute.adminUser, email: { $nin: adminEmails } })
      .select("_id name phone parentName parentPhone email enrollmentNumber batch totalFees feePlanType paymentHistory attendanceRecords joinedOn lastActiveAt createdAt")
      .populate("batch", "name");

    // Compute financial totals
    let totalExpectedFees = 0;
    let totalCollectedFees = 0;
    let totalPendingFees = 0;

    const studentList = students.map((s) => {
      const sObj = s.toObject ? s.toObject() : s;
      const history = sObj.paymentHistory || [];
      const paid = history.reduce((sum, p) => sum + Number(p.amount || 0), 0);
      const total = Number(sObj.totalFees || 0);
      const pending = Math.max(0, total - paid);

      totalExpectedFees += total;
      totalCollectedFees += paid;
      totalPendingFees += pending;

      return {
        ...sObj,
        batchName: sObj.batch?.name || "Unassigned",
        paidAmount: paid,
        pendingAmount: pending,
      };
    });

    // Compute Feature Usage
    let notesCount = 0;
    let latestNoteDate = null;
    try {
      const notes = await Note.find({ user: institute.adminUser }).sort({ createdAt: -1 });
      notesCount = notes.length;
      if (notes.length > 0) latestNoteDate = notes[0].createdAt;
    } catch (e) {}

    let noticesCount = 0;
    try {
      const notices = await Notice.find({ user: institute.adminUser });
      noticesCount = notices.length;
    } catch (e) {}

    let testsCount = 0;
    let totalTestMarksCount = 0;
    let averageScorePercent = 0;
    let latestTestDate = null;
    try {
      const tests = await TestResult.find({ institute: institute._id }).sort({ examDate: -1 });
      testsCount = tests.length;
      if (tests.length > 0) {
        latestTestDate = tests[0].examDate || tests[0].createdAt;
        let totalScoreSum = 0;
        let totalMaxSum = 0;
        for (const t of tests) {
          totalTestMarksCount++;
          if (t.totalMarks > 0) {
            totalScoreSum += t.score || 0;
            totalMaxSum += t.totalMarks || 100;
          }
        }
        if (totalMaxSum > 0) {
          averageScorePercent = Math.round((totalScoreSum / totalMaxSum) * 100);
        }
      }
    } catch (e) {}

    let quizzesCount = 0;
    let quizAttemptsCount = 0;
    try {
      const quizzes = await Quiz.find({ institute: institute._id });
      quizzesCount = quizzes.length;
      const quizIds = quizzes.map((q) => q._id);
      if (quizIds.length > 0) {
        quizAttemptsCount = await QuizAttempt.countDocuments({ quiz: { $in: quizIds } });
      }
    } catch (e) {}

    // Activity check
    const now = Date.now();
    const fiveMinsAgo = new Date(now - 5 * 60 * 1000);
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);

    const isAdminActiveNow = adminUser?.lastActiveAt && new Date(adminUser.lastActiveAt) >= fiveMinsAgo;
    const activeTeachersCount = teachers.filter((t) => t.lastActiveAt && new Date(t.lastActiveAt) >= fiveMinsAgo).length;
    const activeStudents7Days = students.filter((s) => s.lastActiveAt && new Date(s.lastActiveAt) >= sevenDaysAgo).length;

    let activityScore = "Moderate Activity";
    if (activeTeachersCount > 0 || notesCount > 5 || testsCount > 3 || activeStudents7Days > 5 || isAdminActiveNow) {
      activityScore = "High Activity";
    } else if (notesCount === 0 && testsCount === 0 && !isAdminActiveNow) {
      activityScore = "Low / Inactive";
    }

    return res.json({
      institute: institute.toObject ? institute.toObject() : institute,
      adminUser,
      teachers,
      batches,
      studentCount: students.length,
      activeStudents7Days,
      activeTeachersCount,
      isAdminActiveNow,
      activityScore,
      financials: {
        totalExpectedFees,
        totalCollectedFees,
        totalPendingFees,
      },
      featureUsage: {
        batchesCount: batches.length,
        notesCount,
        latestNoteDate,
        noticesCount,
        testsCount,
        latestTestDate,
        totalTestMarksCount,
        averageScorePercent,
        quizzesCount,
        quizAttemptsCount,
      },
      students: studentList,
    });
  } catch (error) {
    console.error("getInstituteFullAnalytics error:", error);
    return res.status(500).json({ message: "Could not fetch full institute analytics." });
  }
};

export const getSystemLogs = async (req, res) => {
  try {
    let dbLogs = [];
    try {
      dbLogs = await SystemLog.find().sort({ createdAt: -1 }).limit(100);
    } catch (e) {}

    const combinedMap = new Map();
    for (const log of [...inMemoryLogs, ...dbLogs]) {
      const id = String(log._id || log.id || Math.random());
      if (!combinedMap.has(id)) {
        combinedMap.set(id, log);
      }
    }

    const allLogs = Array.from(combinedMap.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    return res.json(allLogs);
  } catch (error) {
    console.error("getSystemLogs error:", error);
    return res.status(500).json({ message: "Could not fetch system logs." });
  }
};

export const clearSystemLogs = async (req, res) => {
  try {
    inMemoryLogs.length = 0;
    try {
      await SystemLog.deleteMany({});
    } catch (e) {}

    return res.json({ message: "System error logs cleared successfully." });
  } catch (error) {
    return res.status(500).json({ message: "Could not clear logs." });
  }
};

export const updateTuitionWebsite = async (req, res) => {
  try {
    const { id } = req.params;
    const { enabled, slug, headline, subheadline, aboutText, bannerUrl, contactAddress, contactPhone, netlifyToken } = req.body;

    const institute = await Institute.findById(id);
    if (!institute) {
      return res.status(404).json({ message: "Tuition institute not found." });
    }

    let sanitizedSlug = (slug || institute.name)
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-");

    const { deployToNetlify, generateTuitionHTML } = await import("../services/netlifyService.js");

    const htmlContent = generateTuitionHTML({
      instituteName: institute.name,
      ownerName: institute.ownerName,
      slug: sanitizedSlug,
      headline,
      subheadline,
      aboutText,
      bannerUrl,
      logoUrl: institute.logoUrl,
      contactPhone: contactPhone || institute.adminPhone,
      adminEmail: institute.adminEmail,
      contactAddress,
      clientUrl: process.env.CLIENT_URL || "http://localhost:5173",
    });

    const deployResult = await deployToNetlify({
      slug: sanitizedSlug,
      htmlContent,
      customToken: netlifyToken,
    });

    const updatedConfig = {
      enabled: enabled !== false,
      slug: sanitizedSlug,
      headline: headline || `Welcome to ${institute.name}`,
      subheadline: subheadline || "",
      aboutText: aboutText || "",
      bannerUrl: bannerUrl || "",
      contactAddress: contactAddress || "",
      contactPhone: contactPhone || institute.adminPhone || "",
      netlifySiteId: deployResult.siteId || "",
      netlifySubdomain: deployResult.subdomain || `${sanitizedSlug}.netlify.app`,
      publishedUrl: deployResult.publishedUrl || `https://${sanitizedSlug}.netlify.app`,
      lastDeployedAt: new Date(),
    };

    institute.websiteConfig = updatedConfig;
    await institute.save();

    return res.json({
      message: deployResult.message || "Tuition website deployed successfully!",
      websiteConfig: updatedConfig,
      institute,
    });
  } catch (error) {
    console.error("updateTuitionWebsite error:", error);
    return res.status(500).json({ message: error.message || "Could not deploy tuition website." });
  }
};
