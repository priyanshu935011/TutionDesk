const staffMiddleware = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ message: "Not authorized" });
  }

  const staffRoles = [
    "super_admin",
    "tech_admin",
    "sales_admin",
    "sales_person",
    "marketing_admin",
    "marketing_person",
    "admin",
    "teacher",
    "institute_admin",
    "owner",
  ];

  if (staffRoles.includes(req.user.role) || req.user.isAdmin || req.user.institute) {
    return next();
  }

  return res.status(403).json({ message: "Access denied. Staff clearance required." });
};

export default staffMiddleware;
