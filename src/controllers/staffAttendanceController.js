import StaffAttendance from "../models/StaffAttendance.js";
import User from "../models/User.js";
import { getTodayISTDateString, isReceptionist } from "../utils/staffPermissionHelper.js";

// Helper for Indian today's date formatted as YYYY-MM-DD
export const getTodayDateString = getTodayISTDateString;

export const markStaffAttendance = async (req, res) => {
  try {
    if (req.user.role === "teacher" || isReceptionist(req.user)) {
      return res.status(403).json({ message: "Access denied. Only institute admins can mark staff attendance." });
    }

    const { staffId, date, status, notes } = req.body;
    if (!staffId || !status) {
      return res.status(400).json({ message: "staffId and status are required." });
    }

    const validStatuses = ["present", "absent", "half_day", "leave"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: `Invalid status. Must be one of: ${validStatuses.join(", ")}` });
    }

    const instituteId = req.user.institute?._id || req.user.institute || req.user._id;
    let targetDate = date ? String(date).split("T")[0].trim() : getTodayDateString();
    if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(targetDate)) {
      targetDate = getTodayDateString();
    }

    // Verify staff exists AND belongs to the current institute (strict IDOR protection)
    const staffUser = await User.findOne({
      _id: staffId,
      institute: instituteId,
      role: { $in: ["teacher", "receptionist"] },
    });
    if (!staffUser) {
      return res.status(404).json({ message: "Staff member not found in your institute." });
    }

    const attendance = await StaffAttendance.findOneAndUpdate(
      {
        institute: instituteId,
        staff: staffId,
        date: targetDate,
      },
      {
        institute: instituteId,
        staff: staffId,
        staffName: staffUser.name,
        date: targetDate,
        status: status,
        notes: notes ? String(notes).trim() : "",
        markedBy: req.user._id,
      },
      { upsert: true, new: true }
    );

    return res.json({
      message: "Staff attendance recorded successfully.",
      attendance,
    });
  } catch (error) {
    console.error("markStaffAttendance error:", error);
    return res.status(500).json({ message: "Could not mark staff attendance." });
  }
};

export const getStaffAttendanceHistory = async (req, res) => {
  try {
    const { staffId } = req.params;
    const instituteId = req.user.institute?._id || req.user.institute || req.user._id;

    // A hired staff member can view their own, an admin can view any
    const isStaff = req.user.role === "teacher" || isReceptionist(req.user);
    if (isStaff && String(req.user._id) !== String(staffId)) {
      return res.status(403).json({ message: "Access denied." });
    }

    // Tenant check: ensure staffId belongs to this institute
    const staffUser = await User.findOne({
      _id: staffId,
      institute: instituteId,
    });
    if (!staffUser && !isStaff) {
      return res.status(404).json({ message: "Staff member not found in your institute." });
    }

    const query = {
      institute: instituteId,
      staff: staffId,
    };

    if (req.query.month) {
      const cleanMonth = String(req.query.month).trim();
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(cleanMonth)) {
        return res.status(400).json({ message: "Invalid month format. Expected YYYY-MM." });
      }
      query.date = { $regex: `^${cleanMonth}` };
    }

    const records = await StaffAttendance.find(query).sort({ date: -1 });

    let present = 0;
    let absent = 0;
    let halfDay = 0;
    let leave = 0;

    for (const r of records) {
      if (r.status === "present") present++;
      else if (r.status === "absent") absent++;
      else if (r.status === "half_day") halfDay++;
      else if (r.status === "leave") leave++;
    }

    return res.json({
      staffId,
      stats: {
        total: records.length,
        present,
        absent,
        halfDay,
        leave,
      },
      records,
    });
  } catch (error) {
    console.error("getStaffAttendanceHistory error:", error);
    return res.status(500).json({ message: "Could not fetch staff attendance history." });
  }
};

export const getMyStaffAttendance = async (req, res) => {
  try {
    const staffId = req.user._id;
    const instituteId = req.user.institute?._id || req.user.institute || req.user._id;

    const query = {
      institute: instituteId,
      staff: staffId,
    };

    if (req.query.month) {
      const cleanMonth = String(req.query.month).trim();
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(cleanMonth)) {
        return res.status(400).json({ message: "Invalid month format. Expected YYYY-MM." });
      }
      query.date = { $regex: `^${cleanMonth}` };
    }

    const records = await StaffAttendance.find(query).sort({ date: -1 });

    let present = 0;
    let absent = 0;
    let halfDay = 0;
    let leave = 0;

    for (const r of records) {
      if (r.status === "present") present++;
      else if (r.status === "absent") absent++;
      else if (r.status === "half_day") halfDay++;
      else if (r.status === "leave") leave++;
    }

    const todayStr = getTodayDateString();
    const todayRecord = records.find((r) => r.date === todayStr);

    return res.json({
      staffId,
      todayStatus: todayRecord ? todayRecord.status : "unmarked",
      todayNotes: todayRecord ? todayRecord.notes : "",
      stats: {
        total: records.length,
        present,
        absent,
        halfDay,
        leave,
      },
      records,
    });
  } catch (error) {
    console.error("getMyStaffAttendance error:", error);
    return res.status(500).json({ message: "Could not fetch attendance." });
  }
};
