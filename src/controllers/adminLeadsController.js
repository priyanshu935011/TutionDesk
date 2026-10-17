import SalesLead from "../models/SalesLead.js";
import SalesTerritory from "../models/SalesTerritory.js";
import User from "../models/User.js";

// Comprehensive India States & Districts directory
export const DEFAULT_STATES_AND_DISTRICTS = {
  Jharkhand: ["Ranchi", "Dhanbad", "Bokaro", "Jamshedpur", "Deoghar", "Hazaribagh", "Giridih", "Ramgarh", "Dumka", "Chaibasa", "Medininagar", "Phusro"],
  Bihar: ["Patna", "Gaya", "Muzaffarpur", "Bhagalpur", "Darbhanga", "Purnia", "Begusarai", "Arrah", "Bihar Sharif", "Samastipur", "Sasaram", "Motihari"],
  "Uttar Pradesh": ["Lucknow", "Kanpur", "Varanasi", "Prayagraj", "Noida", "Greater Noida", "Ghaziabad", "Agra", "Gorakhpur", "Meerut", "Bareilly", "Aligarh", "Moradabad", "Saharanpur", "Jhansi", "Mathura"],
  Delhi: ["Central Delhi", "North Delhi", "South Delhi", "East Delhi", "West Delhi", "New Delhi", "Rohini", "Dwarka"],
  Rajasthan: ["Jaipur", "Kota", "Jodhpur", "Udaipur", "Bikaner", "Ajmer", "Sikar", "Alwar", "Bhilwara", "Sri Ganganagar"],
  "Madhya Pradesh": ["Bhopal", "Indore", "Gwalior", "Jabalpur", "Ujjain", "Sagar", "Dewas", "Satna", "Ratlam", "Rewa"],
  Maharashtra: ["Mumbai", "Pune", "Nagpur", "Nashik", "Thane", "Aurangabad", "Solapur", "Amravati", "Kolhapur", "Navi Mumbai"],
  "West Bengal": ["Kolkata", "Howrah", "Durgapur", "Asansol", "Siliguri", "Bardhaman", "Malda", "Kharagpur"],
  Haryana: ["Gurugram", "Faridabad", "Panipat", "Ambala", "Rohtak", "Hisar", "Karnal", "Sonipat", "Yamunanagar", "Panchkula"],
  Punjab: ["Ludhiana", "Amritsar", "Jalandhar", "Patiala", "Bathinda", "Mohali", "Hoshiarpur", "Pathankot"],
  Gujarat: ["Ahmedabad", "Surat", "Vadodara", "Rajkot", "Bhavnagar", "Jamnagar", "Gandhinagar", "Junagadh"],
  Karnataka: ["Bengaluru", "Mysuru", "Hubballi", "Mangaluru", "Belagavi", "Davanagere", "Ballari", "Kalaburagi"],
  Telangana: ["Hyderabad", "Warangal", "Nizamabad", "Karimnagar", "Khammam", "Ramagundam"],
  "Tamil Nadu": ["Chennai", "Coimbatore", "Madurai", "Tiruchirappalli", "Salem", "Tirunelveli", "Tiruppur", "Vellore"],
  Kerala: ["Thiruvananthapuram", "Kochi", "Kozhikode", "Thrissur", "Kollam", "Palakkad", "Alappuzha", "Kannur"],
  Odisha: ["Bhubaneswar", "Cuttack", "Rourkela", "Berhampur", "Sambalpur", "Puri", "Balasore"],
  Assam: ["Guwahati", "Silchar", "Dibrugarh", "Jorhat", "Nagaon", "Tinsukia", "Tezpur"],
  Chhattisgarh: ["Raipur", "Bilaspur", "Durg", "Bhilai", "Korba", "Rajnandgaon", "Jagdalpur"],
  Uttarakhand: ["Dehradun", "Haridwar", "Roorkee", "Haldwani", "Rudrapur", "Kashipur", "Rishikesh"],
  "Himachal Pradesh": ["Shimla", "Dharamshala", "Solan", "Mandi", "Kullu", "Baddi"],
  "Jammu & Kashmir": ["Srinagar", "Jammu", "Anantnag", "Baramulla", "Udhampur"],
  "Andhra Pradesh": ["Visakhapatnam", "Vijayawada", "Guntur", "Nellore", "Kurnool", "Kakinada", "Tirupati"],
  Goa: ["North Goa", "South Goa", "Panaji", "Margao"],
  Chandigarh: ["Chandigarh"],
};

// GET /api/admin/leads/folders - Return state and district folder structure with counts and assignments
export const getLeadFolders = async (req, res) => {
  try {
    const [allLeads, assignments, salesStaff] = await Promise.all([
      SalesLead.find(),
      SalesTerritory.find(),
      User.find({ role: "sales_person" }),
    ]);

    // Exclude leads added by staff ("show leads added by staff only in staff dashboard, not on super admin")
    const masterLeads = (allLeads || []).filter((l) => l.source !== "Self-Added");

    // Staff lookup map
    const staffMap = {};
    salesStaff.forEach((s) => {
      const id = String(s._id || s.id);
      staffMap[id] = s.name;
    });

    // Territory lookup maps
    const stateAssignments = {}; // stateLower -> { salesPersonId, salesPersonName }
    const cityAssignments = {}; // `${stateLower}::${cityLower}` -> { salesPersonId, salesPersonName }

    (assignments || []).forEach((t) => {
      const sLower = (t.state || "").trim().toLowerCase();
      const cLower = (t.city || "").trim().toLowerCase();
      const spId = String(t.salesPersonId || "");
      const spName = t.salesPersonName || staffMap[spId] || "Sales Specialist";

      if (sLower && !cLower) {
        stateAssignments[sLower] = { salesPersonId: spId, salesPersonName: spName };
      } else if (sLower && cLower) {
        cityAssignments[`${sLower}::${cLower}`] = { salesPersonId: spId, salesPersonName: spName };
      }
    });

    // Merge default states with any custom states in leads or assignments
    const stateNamesSet = new Set(Object.keys(DEFAULT_STATES_AND_DISTRICTS));
    masterLeads.forEach((l) => {
      if (l.state && l.state.trim()) stateNamesSet.add(l.state.trim());
    });
    (assignments || []).forEach((t) => {
      if (t.state && t.state.trim()) stateNamesSet.add(t.state.trim());
    });

    const statesList = Array.from(stateNamesSet).sort();

    const folderData = statesList.map((stateName) => {
      const sLower = stateName.toLowerCase();
      const stateAssignment = stateAssignments[sLower] || null;

      // Collect districts for this state
      const defaultDistricts = DEFAULT_STATES_AND_DISTRICTS[stateName] || [];
      const districtSet = new Set(defaultDistricts);

      // Add any custom cities/districts found in leads or assignments for this state
      masterLeads.forEach((l) => {
        if ((l.state || "").trim().toLowerCase() === sLower) {
          const d = (l.district || l.city || "").trim();
          if (d) districtSet.add(d);
        }
      });
      (assignments || []).forEach((t) => {
        if ((t.state || "").trim().toLowerCase() === sLower && t.city && t.city.trim()) {
          districtSet.add(t.city.trim());
        }
      });

      const districtNames = Array.from(districtSet).sort();

      // Calculate leads in this state
      const stateLeads = masterLeads.filter(
        (l) => (l.state || "").trim().toLowerCase() === sLower
      );

      const districtsData = districtNames.map((districtName) => {
        const dLower = districtName.toLowerCase();
        const cityAssignment = cityAssignments[`${sLower}::${dLower}`];
        const effectiveAssignment = cityAssignment || stateAssignment;

        const count = stateLeads.filter((l) => {
          const leadCity = (l.district || l.city || "").trim().toLowerCase();
          return leadCity === dLower;
        }).length;

        return {
          district: districtName,
          leadsCount: count,
          assignedSalesPersonId: cityAssignment?.salesPersonId || null,
          assignedSalesPersonName: cityAssignment?.salesPersonName || null,
          inheritedSalesPersonId: !cityAssignment && stateAssignment ? stateAssignment.salesPersonId : null,
          inheritedSalesPersonName: !cityAssignment && stateAssignment ? stateAssignment.salesPersonName : null,
        };
      });

      return {
        state: stateName,
        totalLeads: stateLeads.length,
        districtsCount: districtNames.length,
        assignedSalesPersonId: stateAssignment?.salesPersonId || null,
        assignedSalesPersonName: stateAssignment?.salesPersonName || null,
        districts: districtsData,
      };
    });

    return res.json({
      states: folderData,
      totalMasterLeads: masterLeads.length,
    });
  } catch (error) {
    console.error("getLeadFolders error:", error);
    return res.status(500).json({ message: "Could not fetch lead folder structure" });
  }
};

// GET /api/admin/leads - Fetch master leads with state/district/search filters
export const getAdminLeads = async (req, res) => {
  try {
    const { state, district, city, status, search, salesPersonId } = req.query;

    const allLeads = await SalesLead.find().sort({ updatedAt: -1, createdAt: -1 });

    // Strictly exclude staff self-added leads from Super Admin leads page
    let filtered = (allLeads || []).filter((l) => l.source !== "Self-Added");

    if (state) {
      filtered = filtered.filter(
        (l) => (l.state || "").trim().toLowerCase() === state.trim().toLowerCase()
      );
    }

    const targetCity = (district || city || "").trim().toLowerCase();
    if (targetCity) {
      filtered = filtered.filter((l) => {
        const c = (l.district || l.city || "").trim().toLowerCase();
        return c === targetCity;
      });
    }

    if (status && status !== "all") {
      filtered = filtered.filter((l) => l.status === status);
    }

    if (salesPersonId && salesPersonId !== "all") {
      if (salesPersonId === "unassigned") {
        filtered = filtered.filter((l) => !l.salesPerson);
      } else {
        filtered = filtered.filter((l) => String(l.salesPerson || "") === String(salesPersonId));
      }
    }

    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      filtered = filtered.filter((l) => {
        return (
          (l.coachingName || "").toLowerCase().includes(q) ||
          (l.contactPerson || "").toLowerCase().includes(q) ||
          (l.phone || "").includes(q) ||
          (l.city || "").toLowerCase().includes(q) ||
          (l.state || "").toLowerCase().includes(q) ||
          (l.email || "").toLowerCase().includes(q)
        );
      });
    }

    return res.json(filtered);
  } catch (error) {
    console.error("getAdminLeads error:", error);
    return res.status(500).json({ message: "Could not fetch leads" });
  }
};

// POST /api/admin/leads - Create a lead inside a folder
export const createAdminLead = async (req, res) => {
  try {
    const {
      coachingName,
      contactPerson,
      phone,
      email,
      state,
      district,
      city,
      address,
      studentCapacity,
      planInterest,
      status,
      notes,
      salesPerson,
      salesPersonName,
    } = req.body;

    if (!coachingName || !contactPerson || !phone) {
      return res.status(400).json({ message: "Coaching Name, Contact Person and Phone are required." });
    }

    const resolvedState = (state || "").trim();
    const resolvedCity = (city || district || "").trim();
    const resolvedDistrict = (district || city || "").trim();

    // Check if territory has an assigned sales person
    let assignedSp = salesPerson || null;
    let assignedSpName = salesPersonName || "";

    if (!assignedSp && (resolvedState || resolvedCity)) {
      const assignments = await SalesTerritory.find();
      const cityMatch = assignments.find(
        (t) =>
          (t.state || "").trim().toLowerCase() === resolvedState.toLowerCase() &&
          (t.city || "").trim().toLowerCase() === resolvedCity.toLowerCase()
      );
      const stateMatch = assignments.find(
        (t) => (t.state || "").trim().toLowerCase() === resolvedState.toLowerCase() && !t.city
      );
      const match = cityMatch || stateMatch;
      if (match) {
        assignedSp = match.salesPersonId;
        assignedSpName = match.salesPersonName;
      }
    }

    const newLead = await SalesLead.create({
      coachingName: coachingName.trim(),
      contactPerson: contactPerson.trim(),
      phone: phone.trim(),
      email: email ? email.trim().toLowerCase() : "",
      state: resolvedState,
      district: resolvedDistrict,
      city: resolvedCity,
      address: address ? address.trim() : "",
      studentCapacity: studentCapacity ? studentCapacity.trim() : "",
      planInterest: planInterest || "Yearly Subscription",
      status: status || "new",
      source: "Super Admin",
      salesPerson: assignedSp,
      salesPersonName: assignedSpName,
      addedBy: req.user._id || req.user.id,
      notes: notes ? notes.trim() : "",
      callLogs: [],
    });

    return res.status(201).json({
      message: "Lead created successfully in folder",
      lead: newLead,
    });
  } catch (error) {
    console.error("createAdminLead error:", error);
    return res.status(500).json({ message: "Could not create lead" });
  }
};

// PUT /api/admin/leads/:id - Update lead details or assignment
export const updateAdminLead = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    if (updates.city && !updates.district) updates.district = updates.city;
    if (updates.district && !updates.city) updates.city = updates.district;

    const lead = await SalesLead.findById(id);
    if (!lead) {
      return res.status(404).json({ message: "Lead not found" });
    }

    const updated = await SalesLead.findByIdAndUpdate(id, updates, { new: true });
    return res.json({ message: "Lead updated successfully", lead: updated });
  } catch (error) {
    console.error("updateAdminLead error:", error);
    return res.status(500).json({ message: "Could not update lead" });
  }
};

// DELETE /api/admin/leads/:id - Delete a lead
export const deleteAdminLead = async (req, res) => {
  try {
    const { id } = req.params;
    await SalesLead.findByIdAndDelete(id);
    return res.json({ message: "Lead deleted successfully" });
  } catch (error) {
    console.error("deleteAdminLead error:", error);
    return res.status(500).json({ message: "Could not delete lead" });
  }
};

// POST /api/admin/leads/assign-territory - Assign a sales person to a state or district/city
export const assignTerritory = async (req, res) => {
  try {
    const { state, city, salesPersonId, salesPersonName } = req.body;

    if (!state || !state.trim()) {
      return res.status(400).json({ message: "State is required for territory assignment." });
    }

    const cleanState = state.trim();
    const cleanCity = city ? city.trim() : "";

    // If salesPersonId is empty, unassign the territory
    if (!salesPersonId) {
      const existing = await SalesTerritory.find();
      const match = existing.find(
        (t) =>
          (t.state || "").trim().toLowerCase() === cleanState.toLowerCase() &&
          (t.city || "").trim().toLowerCase() === cleanCity.toLowerCase()
      );
      if (match && match._id) {
        await SalesTerritory.findByIdAndDelete(match._id);
      }
      return res.json({ message: `Territory ${cleanCity ? cleanCity + ", " : ""}${cleanState} unassigned successfully` });
    }

    // Lookup staff name if missing
    let spName = salesPersonName || "";
    if (!spName) {
      const staffUser = await User.findById(salesPersonId);
      if (staffUser) spName = staffUser.name;
    }

    // Upsert assignment
    const allAssignments = await SalesTerritory.find();
    const existing = allAssignments.find(
      (t) =>
        (t.state || "").trim().toLowerCase() === cleanState.toLowerCase() &&
        (t.city || "").trim().toLowerCase() === cleanCity.toLowerCase()
    );

    if (existing && existing._id) {
      await SalesTerritory.findByIdAndUpdate(existing._id, {
        salesPersonId,
        salesPersonName: spName,
        assignedBy: req.user._id || req.user.id,
      });
    } else {
      await SalesTerritory.create({
        state: cleanState,
        city: cleanCity,
        salesPersonId,
        salesPersonName: spName,
        assignedBy: req.user._id || req.user.id,
      });
    }

    // Automatically update all existing master leads in this territory!
    const allLeads = await SalesLead.find();
    const matchingLeads = allLeads.filter((l) => {
      if (l.source === "Self-Added") return false; // Never reassign staff's self-added leads
      const sMatch = (l.state || "").trim().toLowerCase() === cleanState.toLowerCase();
      if (!sMatch) return false;
      if (cleanCity) {
        const cMatch = (l.district || l.city || "").trim().toLowerCase() === cleanCity.toLowerCase();
        return cMatch;
      }
      return true;
    });

    for (const lead of matchingLeads) {
      await SalesLead.findByIdAndUpdate(lead._id || lead.id, {
        salesPerson: salesPersonId,
        salesPersonName: spName,
      });
    }

    return res.json({
      message: `Assigned ${cleanCity ? cleanCity + " (" + cleanState + ")" : cleanState} to ${spName}. Updated ${matchingLeads.length} leads.`,
    });
  } catch (error) {
    console.error("assignTerritory error:", error);
    return res.status(500).json({ message: "Could not assign territory" });
  }
};

// POST /api/admin/leads/bulk-import - Bulk import leads into a folder
export const bulkImportAdminLeads = async (req, res) => {
  try {
    const { state, district, leads } = req.body;

    if (!Array.isArray(leads) || leads.length === 0) {
      return res.status(400).json({ message: "Leads array cannot be empty" });
    }

    const cleanState = (state || "").trim();
    const cleanCity = (district || "").trim();

    // Check assignment for this territory
    let assignedSp = null;
    let assignedSpName = "";
    if (cleanState || cleanCity) {
      const assignments = await SalesTerritory.find();
      const cityMatch = assignments.find(
        (t) =>
          (t.state || "").trim().toLowerCase() === cleanState.toLowerCase() &&
          (t.city || "").trim().toLowerCase() === cleanCity.toLowerCase()
      );
      const stateMatch = assignments.find(
        (t) => (t.state || "").trim().toLowerCase() === cleanState.toLowerCase() && !t.city
      );
      const match = cityMatch || stateMatch;
      if (match) {
        assignedSp = match.salesPersonId;
        assignedSpName = match.salesPersonName;
      }
    }

    let importedCount = 0;
    for (const item of leads) {
      if (!item.coachingName || !item.phone) continue;

      await SalesLead.create({
        coachingName: item.coachingName.trim(),
        contactPerson: (item.contactPerson || item.coachingName).trim(),
        phone: String(item.phone).trim(),
        email: item.email ? String(item.email).trim().toLowerCase() : "",
        state: cleanState || (item.state || "").trim(),
        district: cleanCity || (item.district || item.city || "").trim(),
        city: cleanCity || (item.city || item.district || "").trim(),
        address: (item.address || "").trim(),
        studentCapacity: (item.studentCapacity || "").trim(),
        planInterest: item.planInterest || "Yearly Subscription",
        status: item.status || "new",
        source: "Super Admin",
        salesPerson: assignedSp,
        salesPersonName: assignedSpName,
        addedBy: req.user._id || req.user.id,
        notes: (item.notes || "").trim(),
        callLogs: [],
      });
      importedCount++;
    }

    return res.status(201).json({
      message: `Successfully imported ${importedCount} leads into ${cleanCity ? cleanCity + ", " : ""}${cleanState}`,
      count: importedCount,
    });
  } catch (error) {
    console.error("bulkImportAdminLeads error:", error);
    return res.status(500).json({ message: "Could not bulk import leads" });
  }
};
