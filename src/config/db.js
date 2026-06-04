import mongoose from "mongoose";

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("MongoDB connected");
    // Drop unique index on enrollmentNumber to allow same student (enrollmentNumber) across multiple batches/institutions
    try {
      await mongoose.connection.db.collection("students").dropIndex("enrollmentNumber_1");
      console.log("Dropped enrollmentNumber unique index");
    } catch (e) {
      // index might not exist or already dropped
    }
  } catch (error) {
    console.error("MongoDB connection failed:", error.message);
    process.exit(1);
  }
};

export default connectDB;
