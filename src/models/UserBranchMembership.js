import mongoose from "../utils/supabaseModel.js";

const userBranchMembershipSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    institute: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Institute",
      required: true,
    },
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      default: null,
    },
    role: {
      type: String,
      enum: ["org_admin", "branch_admin", "teacher", "receptionist", "staff"],
      default: "staff",
    },
  },
  { timestamps: true }
);

const UserBranchMembership = mongoose.model(
  "UserBranchMembership",
  userBranchMembershipSchema,
  "user_branch_memberships"
);

export default UserBranchMembership;
