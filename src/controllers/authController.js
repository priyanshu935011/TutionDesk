import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import Institute from "../models/Institute.js";
import User from "../models/User.js";

const SUPER_ADMIN_EMAIL = (process.env.SUPER_ADMIN_EMAIL || "admin@tutiondesk.com").toLowerCase();
const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD || "Admin@12345!";

const generateToken = (payload) =>
  jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "7d" });

const buildInstituteState = async (user) => {
  if (!user.institute) {
    return null;
  }

  const institute = await Institute.findById(user.institute).select(
    "name subscriptionPlan subscriptionAmount trialDays subscriptionStart subscriptionEnd status"
  );

  if (!institute) {
    return null;
  }

  return {
    id: institute._id,
    name: institute.name,
    subscriptionPlan: institute.subscriptionPlan,
    subscriptionAmount: institute.subscriptionAmount,
    trialDays: institute.trialDays,
    subscriptionStart: institute.subscriptionStart,
    subscriptionEnd: institute.subscriptionEnd,
    status: institute.status,
  };
};

export const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "Email and password are required" });
    }

    const normalizedEmail = email.toLowerCase();

    if (
      normalizedEmail === SUPER_ADMIN_EMAIL &&
      password === SUPER_ADMIN_PASSWORD
    ) {
      return res.json({
        token: generateToken({
          id: "super-admin",
          email: SUPER_ADMIN_EMAIL,
          role: "super_admin",
        }),
        user: {
          id: "super-admin",
          email: SUPER_ADMIN_EMAIL,
          role: "super_admin",
        },
      });
    }

    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const institute = await buildInstituteState(user);

    return res.json({
      token: generateToken({
        id: user._id,
        email: user.email,
        role: user.role,
      }),
      user: {
        id: user._id,
        email: user.email,
        role: user.role,
        institute,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: "Login failed" });
  }
};
