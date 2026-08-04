import mongoose from "../utils/supabaseModel.js";

const leadFormSchema = new mongoose.Schema(
  {
    institute: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Institute",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      default: "",
    },
    fields: {
      type: [
        {
          name: String, // name, phone, email, course, message
          label: String,
          required: Boolean,
          type: String, // text, select, textarea
          options: [String], // for select fields
        }
      ],
      default: [
        { name: "name", label: "Full Name", required: true, type: "text" },
        { name: "phone", label: "Phone Number", required: true, type: "text" },
        { name: "email", label: "Email Address", required: false, type: "text" },
        { name: "course", label: "Interested Course / Class", required: false, type: "text" },
        { name: "message", label: "Additional Query", required: false, type: "textarea" },
      ],
    },
  },
  {
    timestamps: true,
  }
);

const LeadForm = mongoose.model("LeadForm", leadFormSchema);
export default LeadForm;
