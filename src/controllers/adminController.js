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
        { $match: { email: { $nin: adminEmails } } },
        { $group: { _id: "$enrollmentNumber" } },
        { $count: "count" }
      ]),
      User.countDocuments({ role: "teacher" }),
      Institute.countDocuments({ tuitionType: "solo" }),
      Institute.countDocuments({ tuitionType: "institution" }),
    ]);

    const totalStudents = totalStudentsResult[0]?.count || 0;

    const hydrated = await Promise.all(institutes.map((institute) => hydrateInstitute(institute, adminEmails)));

    const now = Date.now();
    const sevenDays = 1000 * 60 * 60 * 24 * 7;

    // Active Now: count users/students active in the last 5 minutes
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
        User.countDocuments({ lastActiveAt: { $gte: fiveMinsAgo } }),
        Student.aggregate([
          { $match: { lastActiveAt: { $gte: fiveMinsAgo }, email: { $nin: adminEmails } } },
          { $group: { _id: "$enrollmentNumber" } },
          { $count: "count" }
        ]),
      ]);
      const activeStudentsNow = activeStudentsNowResult[0]?.count || 0;
      activeNow = activeUsersNow + activeStudentsNow;
    }

    // Active Today: count users/students active since midnight
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const [activeUsersToday, activeStudentsTodayResult] = await Promise.all([
      User.countDocuments({ lastActiveAt: { $gte: startOfToday } }),
      Student.aggregate([
        { $match: { lastActiveAt: { $gte: startOfToday }, email: { $nin: adminEmails } } },
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

    // Growth Analytics signup trends (last 6 months)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
    sixMonthsAgo.setDate(1);
    sixMonthsAgo.setHours(0, 0, 0, 0);

    const [institutesSignups, studentsSignups] = await Promise.all([
      Institute.find({ createdAt: { $gte: sixMonthsAgo } }).select("createdAt"),
      Student.find({ createdAt: { $gte: sixMonthsAgo }, email: { $nin: adminEmails } }).select("createdAt"),
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

    const summary = hydrated.reduce(
      (totals, institute) => {
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
    const students = await Student.find({ email: { $nin: adminEmails } })
      .populate({
        path: "batch",
        select: "name teacher",
        populate: {
          path: "teacher",
          select: "name email",
        },
      })
      .sort({ lastActiveAt: -1, createdAt: -1 });

    const studentsWithDetails = await Promise.all(
      students.map(async (student) => {
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
