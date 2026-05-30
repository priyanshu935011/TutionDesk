import Batch from "../models/Batch.js";
import Student from "../models/Student.js";

export const getBatches = async (req, res) => {
  try {
    const batches = await Batch.find({ user: req.user._id }).sort({ createdAt: -1 });
    return res.json(batches);
  } catch (error) {
    return res.status(500).json({ message: "Could not fetch batches" });
  }
};

export const createBatch = async (req, res) => {
  try {
    const { name, scheduleDays, startTime, endTime } = req.body;

    if (!name || !startTime || !endTime) {
      return res.status(400).json({ message: "Batch name and schedule time are required" });
    }

    const batch = await Batch.create({
      user: req.user._id,
      name,
      scheduleDays: Array.isArray(scheduleDays) ? scheduleDays : [],
      startTime,
      endTime,
    });

    return res.status(201).json(batch);
  } catch (error) {
    return res.status(500).json({ message: "Could not create batch" });
  }
};

export const updateBatch = async (req, res) => {
  try {
    const { name, scheduleDays, startTime, endTime } = req.body;
    const batch = await Batch.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      {
        name,
        scheduleDays: Array.isArray(scheduleDays) ? scheduleDays : [],
        startTime,
        endTime,
      },
      { new: true, runValidators: true }
    );

    if (!batch) {
      return res.status(404).json({ message: "Batch not found" });
    }

    return res.json(batch);
  } catch (error) {
    return res.status(500).json({ message: "Could not update batch" });
  }
};

export const deleteBatch = async (req, res) => {
  try {
    const linkedStudents = await Student.countDocuments({
      user: req.user._id,
      batch: req.params.id,
    });

    if (linkedStudents > 0) {
      return res.status(400).json({
        message: "This batch is assigned to students. Reassign students before deleting it.",
      });
    }

    const batch = await Batch.findOneAndDelete({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!batch) {
      return res.status(404).json({ message: "Batch not found" });
    }

    return res.json({ message: "Batch deleted successfully" });
  } catch (error) {
    return res.status(500).json({ message: "Could not delete batch" });
  }
};
