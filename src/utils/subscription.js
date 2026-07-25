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
  lifetime: () => {
    return new Date("2099-12-31T23:59:59.999Z");
  },
  custom: (_, __, customEndDate) => {
    return customEndDate ? new Date(customEndDate) : null;
  },
};

export const resolveSubscriptionEnd = ({ subscriptionPlan, subscriptionStart, trialDays, customEndDate }) => {
  const calculator = subscriptionPlans[subscriptionPlan];

  if (!calculator) {
    return null;
  }

  if (subscriptionPlan === "trial") {
    return calculator(subscriptionStart, trialDays);
  }
  if (subscriptionPlan === "custom") {
    return calculator(subscriptionStart, trialDays, customEndDate);
  }
  return calculator(subscriptionStart);
};

export const isSubscriptionExpired = (institute) =>
  !institute || institute.status !== "active" || new Date(institute.subscriptionEnd).getTime() < Date.now();
