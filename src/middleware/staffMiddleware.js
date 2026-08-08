const staffMiddleware = (req, res, next) => {
  const staffRoles = [
    "super_admin",
    "tech_admin",
    "sales_admin",
    "sales_person",
    "marketing_admin",
    "marketing_person",
  ];

  if (!req.user || !staffRoles.includes(req.user.role)) {
    return res.status(403).json({ message: "Access denied. Staff clearance required." });
  }

  next();
};

export default staffMiddleware;
