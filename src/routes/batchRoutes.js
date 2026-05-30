import express from "express";
import {
  createBatch,
  deleteBatch,
  getBatches,
  updateBatch,
} from "../controllers/batchController.js";
import protect from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(protect);
router.route("/").get(getBatches).post(createBatch);
router.route("/:id").put(updateBatch).delete(deleteBatch);

export default router;
