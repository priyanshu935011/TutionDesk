export const subscriptionPlans = {
  trial: (startDate, trialDays) => {
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + Number(trialDays || 0));
    return endDate;
  },
  monthly: (startDate) => {
    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + 1);
    return endDate;
  },
  quarterly: (startDate) => {
    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + 3);
    return endDate;
  },
  half_yearly: (startDate) => {
    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + 6);
    return endDate;
  },
  yearly: (startDate) => {
    const endDate = new Date(startDate);
    endDate.setFullYear(endDate.getFullYear() + 1);
    return endDate;
  },
};

export const resolveSubscriptionEnd = ({ subscriptionPlan, subscriptionStart, trialDays }) => {
  const calculator = subscriptionPlans[subscriptionPlan];

  if (!calculator) {
    return null;
  }

  return subscriptionPlan === "trial"
    ? calculator(subscriptionStart, trialDays)
    : calculator(subscriptionStart);
};

export const isSubscriptionExpired = (institute) =>
  !institute || institute.status !== "active" || new Date(institute.subscriptionEnd).getTime() < Date.now();
