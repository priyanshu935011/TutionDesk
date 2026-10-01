export const getISTDateStr = (dateInput) => {
  if (!dateInput) {
    const nowIST = new Date(Date.now() + 5.5 * 3600 * 1000);
    return nowIST.toISOString().split("T")[0];
  }
  if (typeof dateInput === "string") {
    const match = dateInput.match(/^\d{4}-\d{2}-\d{2}/);
    if (match) return match[0];
  }
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) {
    const nowIST = new Date(Date.now() + 5.5 * 3600 * 1000);
    return nowIST.toISOString().split("T")[0];
  }
  const istMs = d.getTime() + (5.5 * 3600 * 1000);
  return new Date(istMs).toISOString().split("T")[0];
};

export const calculatePendingAmount = (student) => {
  if (!student) return 0;

  const sObj = typeof student.toObject === "function" ? student.toObject() : student;
  const feePlanType = sObj.feePlanType || "monthly";
  const totalFees = Number(sObj.totalFees ?? sObj.total_fees ?? sObj.fees ?? 0);
  const paymentHistory = sObj.paymentHistory || [];
  const paidAmount = (sObj.paidAmount !== undefined && sObj.paidAmount !== null && !isNaN(Number(sObj.paidAmount)))
    ? Number(sObj.paidAmount)
    : paymentHistory.reduce((sum, p) => sum + Number(p?.amount || 0), 0);

  if (feePlanType !== "monthly") {
    return Math.max(0, totalFees - paidAmount);
  }

  // Monthly plan logic
  const monthlyRate = totalFees;
  if (monthlyRate <= 0) return 0;

  const dueDateVal = sObj.dueDate || sObj.due_date;
  if (!dueDateVal) {
    return Math.max(0, monthlyRate - paidAmount);
  }

  const due = new Date(dueDateVal);
  if (isNaN(due.getTime())) {
    return Math.max(0, monthlyRate - paidAmount);
  }

  const todayStr = getISTDateStr(new Date());
  const dueStr = getISTDateStr(due);

  const [tY, tM, tD] = todayStr.split("-").map(Number);
  const [dY, dM, dD] = dueStr.split("-").map(Number);

  // If today is strictly before the due date (e.g. today is 25th Sept, due date is 1st Oct):
  if (tY < dY || (tY === dY && tM < dM) || (tY === dY && tM === dM && tD < dD)) {
    return 0;
  }

  // Today is on or after due date (e.g. today is 1st Oct and due date is 1st Oct)
  const monthDiff = (tY - dY) * 12 + (tM - dM);
  let monthsOverdue = monthDiff + (tD >= dD ? 1 : 0);
  if (monthsOverdue < 1) monthsOverdue = 1;

  const rawPending = monthsOverdue * monthlyRate;
  return Math.max(0, rawPending);
};
