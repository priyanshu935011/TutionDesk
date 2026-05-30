import bcrypt from "bcryptjs";
import Institute from "../models/Institute.js";
import UptimeEvent from "../models/UptimeEvent.js";
import Student from "../models/Student.js";
import Batch from "../models/Batch.js";
import User from "../models/User.js";
import { isSubscriptionExpired, resolveSubscriptionEnd } from "../utils/subscription.js";

const hydrateInstitute = async (institute) => {
  const [studentCount, batchCount] = await Promise.all([
    Student.countDocuments({ user: institute.adminUser }),
    Batch.countDocuments({ user: institute.adminUser }),
  ]);

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
    const institutes = await Institute.find().sort({ createdAt: -1 });
    const hydrated = await Promise.all(institutes.map((institute) => hydrateInstitute(institute)));

    const now = Date.now();
    const sevenDays = 1000 * 60 * 60 * 24 * 7;

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
      }
    );

    return res.json({
      summary,
      institutes: hydrated,
    });
  } catch (error) {
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

    return res.json(await hydrateInstitute(institute));
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

    const [userCount, batchCount, studentCount] = await Promise.all([
      User.countDocuments({ institute: institute._id }),
      Batch.countDocuments({ user: institute.adminUser }),
      Student.countDocuments({ user: institute.adminUser }),
    ]);

    await Promise.all([
      Student.deleteMany({ user: institute.adminUser }),
      Batch.deleteMany({ user: institute.adminUser }),
      User.deleteMany({ institute: institute._id }),
      Institute.deleteOne({ _id: institute._id }),
    ]);

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
    const events = await UptimeEvent.find().sort({ startedAt: -1 }).limit(20);
    const downEvents = await UptimeEvent.find({ status: "down" }).sort({ startedAt: -1 }).limit(20);

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
