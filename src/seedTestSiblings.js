import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import Student from "./models/Student.js";
import Batch from "./models/Batch.js";

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://priyanshugiri63:KkBjEUe5njFZM2k4@cluster0.m1mclcw.mongodb.net/coaching_crm";

async function run() {
  try {
    console.log("Connecting to MongoDB...");
    await mongoose.connect(MONGO_URI);
    console.log("Connected!");

    // Find any batch
    const batch = await Batch.findOne({});
    if (!batch) {
      console.error("No batches found in database! Please create a batch first.");
      process.exit(1);
    }
    console.log(`Found batch: ${batch.name} (${batch._id}) owned by user ${batch.user}`);

    // Generate enrollment numbers
    const latestStudent = await Student.findOne({})
      .sort({ createdAt: -1 })
      .select("enrollmentNumber");

    const maxNumber = Number(
      String(latestStudent?.enrollmentNumber || "")
        .replace(/\D/g, "")
        .trim()
    );

    const nextNum = Number.isFinite(maxNumber) && maxNumber > 0 ? maxNumber + 1 : 1000;
    const enrA = `ENR${String(nextNum).padStart(4, "0")}`;
    const enrB = `ENR${String(nextNum + 1).padStart(4, "0")}`;

    const hashedPassword = await bcrypt.hash("123456", 10);

    const email = "siblingtest@gmail.com";
    const phone = "9999999999";

    // Delete any existing test students to keep clean
    await Student.deleteMany({ email, phone });

    // Create Aman Sharma
    const studentA = await Student.create({
      user: batch.user,
      name: "Aman Sharma",
      phone,
      parentName: "Sanjay Sharma",
      parentPhone: "9876543210",
      email,
      address: "123 Test Street, New Delhi",
      enrollmentNumber: enrA,
      batch: batch._id,
      joinedOn: new Date(),
      totalFees: 5000,
      feePlanType: "monthly",
      dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      paymentHistory: [
        {
          amount: 5000,
          paymentDate: new Date(),
          paymentType: "monthly",
          note: "Auto-collected on setup"
        }
      ],
      password: hashedPassword,
    });

    // Create Riya Sharma
    const studentB = await Student.create({
      user: batch.user,
      name: "Riya Sharma",
      phone,
      parentName: "Sanjay Sharma",
      parentPhone: "9876543210",
      email,
      address: "123 Test Street, New Delhi",
      enrollmentNumber: enrB,
      batch: batch._id,
      joinedOn: new Date(),
      totalFees: 6000,
      feePlanType: "monthly",
      dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      paymentHistory: [
        {
          amount: 6000,
          paymentDate: new Date(),
          paymentType: "monthly",
          note: "Auto-collected on setup"
        }
      ],
      password: hashedPassword,
    });

    console.log("\nDummy data created successfully!");
    console.log("=========================================");
    console.log(`Student 1: ${studentA.name} (Enrollment: ${studentA.enrollmentNumber})`);
    console.log(`Student 2: ${studentB.name} (Enrollment: ${studentB.enrollmentNumber})`);
    console.log(`Shared Login Identifier: ${email} OR ${phone}`);
    console.log("Shared Password: 123456");
    console.log("=========================================");
  } catch (err) {
    console.error("Error creating dummy data:", err);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected from MongoDB.");
  }
}

run();
