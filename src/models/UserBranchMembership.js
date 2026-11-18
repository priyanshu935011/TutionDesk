import mongoose from "../utils/supabaseModel.js";

const userBranchMembershipSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    institute: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Institute",
    },
    instituteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Institute",
    },
    institute_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Institute",
    },
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      default: null,
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      default: null,
    },
    organization_id: {
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
