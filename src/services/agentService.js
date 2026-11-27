import AgentStateConfig from "../models/AgentStateConfig.js";
import AgentTestSeries from "../models/AgentTestSeries.js";
import TestSeries from "../models/TestSeries.js";
import { callGeminiApi, extractJsonFromText } from "./aiService.js";
import { readCategoryTaxonomy, writeCategoryTaxonomy } from "../controllers/testSeriesController.js";
import { formatDisplayMath } from "../utils/mathFormatter.js";

// Comprehensive Curriculum Knowledge Tree
export const CURRICULUM_CATALOG = {
  "JEE Main & Advanced": {
    Physics: [
      "Units, Dimensions & Errors",
      "Kinematics & Projectile Motion",
      "Laws of Motion & Friction",
      "Work, Energy & Power",
      "System of Particles & Rotational Dynamics",
      "Gravitation & Orbital Mechanics",
      "Mechanical Properties of Solids & Fluids",
      "Thermal Physics & Thermodynamics",
      "Oscillations & Simple Harmonic Motion",
      "Wave Motion & Sound Waves",
      "Electrostatics & Gauss Law",
      "Capacitance & Dielectrics",
      "Current Electricity & Kirchoff Laws",
      "Magnetic Effects of Current & Biot-Savart Law",
      "Electromagnetic Induction & Faradays Law",
      "Alternating Current & Resonance",
      "Electromagnetic Waves",
      "Ray Optics & Optical Instruments",
      "Wave Optics & Interference/Diffraction",
      "Dual Nature of Matter & Radiation",
      "Atomic Physics & Bohr Model",
      "Nuclear Physics & Radioactivity",
      "Semiconductor Electronics & Logic Gates",
    ],
    Chemistry: [
      "Some Basic Concepts of Chemistry & Stoichiometry",
      "Atomic Structure & Quantum Numbers",
      "Periodic Table & Periodicity of Elements",
      "Chemical Bonding & Molecular Structure",
      "States of Matter (Gaseous & Liquid)",
      "Thermodynamics & Thermochemistry",
      "Chemical & Ionic Equilibrium",
      "Redox Reactions & Electrochemistry",
      "Solutions & Colligative Properties",
      "Chemical Kinetics & Catalysis",
      "Surface Chemistry",
      "p-Block Elements",
      "d- and f-Block Elements & Metallurgy",
      "Coordination Compounds",
      "Purification & Organic Nomenclature",
      "General Organic Chemistry (GOC) & Reaction Mechanisms",
      "Hydrocarbons (Alkanes, Alkenes, Alkynes)",
      "Haloalkanes & Haloarenes",
      "Alcohols, Phenols & Ethers",
      "Aldehydes, Ketones & Carboxylic Acids",
      "Amines & Diazonium Salts",
      "Biomolecules & Polymers",
    ],
    Mathematics: [
      "Sets, Relations & Functions",
      "Complex Numbers & Quadratic Equations",
      "Matrices & Determinants",
      "Permutations & Combinations",
      "Mathematical Induction & Binomial Theorem",
      "Sequences & Series (AP, GP, HP)",
      "Limits, Continuity & Differentiability",
      "Differentiation & Mean Value Theorems",
      "Applications of Derivatives (Maxima & Minima, Tangents)",
      "Indefinite Integrals & Integration Techniques",
      "Definite Integrals & Properties",
      "Area Under Curves (Integral Applications)",
      "Differential Equations",
      "Straight Lines & Pairs of Straight Lines",
      "Circles & Systems of Circles",
      "Parabola, Ellipse & Hyperbola (Conic Sections)",
      "Vector Algebra & Triple Products",
      "Three-Dimensional Coordinate Geometry (3D)",
      "Trigonometric Ratios, Identities & Equations",
      "Inverse Trigonometric Functions",
      "Statistics & Probability Distributions",
    ],
  },
  "NEET": {
    Physics: [
      "Physical World & Measurement",
      "Kinematics in 1D & 2D",
      "Laws of Motion",
      "Work, Energy & Power",
      "Motion of System of Particles & Rigid Body",
      "Gravitation",
      "Properties of Bulk Matter",
      "Thermodynamics & Kinetic Theory of Gases",
      "Oscillations & Waves",
      "Electrostatics & Potential",
      "Current Electricity & Potentiometer",
      "Magnetic Effects of Current & Magnetism",
      "Electromagnetic Induction & AC",
      "Electromagnetic Waves",
      "Ray Optics & Wave Optics",
      "Modern Physics (Photoelectric Effect & X-Rays)",
      "Atoms & Nuclei",
      "Electronic Devices (Diodes & Transistors)",
    ],
    Chemistry: [
      "Structure of Atom",
      "Classification of Elements & Periodic Trends",
      "Chemical Bonding & Hybridization",
      "Chemical Thermodynamics",
      "Equilibrium (Physical & Chemical)",
      "Redox Reactions",
      "Solutions & Raoults Law",
      "Electrochemistry & Nernst Equation",
      "Chemical Kinetics & Order of Reactions",
      "Inorganic Chemistry (d & f Block, Coordination)",
      "Organic Chemistry Principles & Isomerism",
      "Hydrocarbons",
      "Organic Compounds Containing Oxygen & Nitrogen",
      "Biomolecules & Chemistry in Everyday Life",
    ],
    Biology: [
      "Diversity in the Living World & Taxonomy",
      "Biological Classification & Monera/Protista/Fungi",
      "Plant Kingdom (Algae to Angiosperms)",
      "Animal Kingdom (Invertebrates & Vertebrates)",
      "Morphology & Anatomy of Flowering Plants",
      "Structural Organisation in Animals",
      "Cell: The Unit of Life & Cell Cycle/Division",
      "Biomolecules & Enzymes",
      "Photosynthesis in Higher Plants",
      "Respiration in Plants",
      "Plant Growth & Development",
      "Breathing & Exchange of Gases",
      "Body Fluids & Circulation",
      "Excretory Products & Their Elimination",
      "Locomotion & Movement",
      "Neural Control & Coordination",
      "Chemical Coordination & Integration (Endocrine)",
      "Reproduction in Organisms & Human Reproduction",
      "Genetics: Principles of Inheritance & Variation",
      "Molecular Basis of Inheritance (DNA/RNA/Replication)",
      "Evolution & Darwinian Theories",
      "Human Health & Diseases & Immunity",
      "Biotechnology: Principles, Processes & Applications",
      "Ecology, Ecosystems & Biodiversity Conservation",
    ],
  },
  "Class 10": {
    Science: [
      "Chemical Reactions & Equations",
      "Acids, Bases & Salts",
      "Metals & Non-metals",
      "Carbon & Its Compounds",
      "Life Processes (Nutrition, Respiration, Transport)",
      "Control & Coordination in Animals & Plants",
      "How Do Organisms Reproduce?",
      "Heredity & Evolution",
      "Light: Reflection & Refraction",
      "Human Eye & Colourful World",
      "Electricity & Electric Current",
      "Magnetic Effects of Electric Current",
      "Our Environment",
    ],
    Mathematics: [
      "Real Numbers & Fundamental Theorem of Arithmetic",
      "Polynomials & Zeros",
      "Pair of Linear Equations in Two Variables",
      "Quadratic Equations & Quadratic Formula",
      "Arithmetic Progressions (AP)",
      "Triangles & Similarity Criteria",
      "Coordinate Geometry & Section Formula",
      "Introduction to Trigonometry & Identities",
      "Some Applications of Trigonometry (Heights & Distances)",
      "Circles & Tangents",
      "Areas Related to Circles",
      "Surface Areas & Volumes",
      "Statistics (Mean, Median, Mode)",
      "Probability",
    ],
  },
  "Class 11": {
    Physics: [
      "Units & Measurements",
      "Motion in a Straight Line",
      "Motion in a Plane",
      "Laws of Motion",
      "Work, Energy & Power",
      "System of Particles & Rotational Motion",
      "Gravitation",
      "Mechanical Properties of Solids & Fluids",
      "Thermal Properties of Matter & Thermodynamics",
      "Kinetic Theory",
      "Oscillations & Waves",
    ],
    Chemistry: [
      "Basic Concepts of Chemistry",
      "Structure of Atom",
      "Classification of Elements & Periodicity",
      "Chemical Bonding",
      "Thermodynamics",
      "Equilibrium",
      "Redox Reactions",
      "Organic Chemistry: Basic Principles & Techniques",
      "Hydrocarbons",
    ],
    Mathematics: [
      "Sets & Functions",
      "Trigonometric Functions",
      "Complex Numbers & Quadratic Equations",
      "Linear Inequalities",
      "Permutations & Combinations",
      "Binomial Theorem",
      "Sequence & Series",
      "Straight Lines & Conic Sections",
      "Introduction to Three Dimensional Geometry",
      "Limits & Derivatives",
      "Statistics & Probability",
    ],
  },
  "Class 12": {
    Physics: [
      "Electric Charges & Fields",
      "Electrostatic Potential & Capacitance",
      "Current Electricity",
      "Moving Charges & Magnetism",
      "Magnetism & Matter",
      "Electromagnetic Induction",
      "Alternating Current",
      "Electromagnetic Waves",
      "Ray Optics & Optical Instruments",
      "Wave Optics",
      "Dual Nature of Radiation & Matter",
      "Atoms & Nuclei",
      "Semiconductor Devices",
    ],
    Chemistry: [
      "Solutions",
      "Electrochemistry",
      "Chemical Kinetics",
      "d- & f-Block Elements",
      "Coordination Compounds",
      "Haloalkanes & Haloarenes",
      "Alcohols, Phenols & Ethers",
      "Aldehydes, Ketones & Carboxylic Acids",
      "Amines",
      "Biomolecules",
    ],
    Mathematics: [
      "Relations & Functions",
      "Inverse Trigonometric Functions",
      "Matrices & Determinants",
      "Continuity & Differentiability",
      "Application of Derivatives",
      "Integrals & Methods of Integration",
      "Application of Integrals",
      "Differential Equations",
      "Vector Algebra",
      "Three Dimensional Geometry",
      "Linear Programming",
      "Probability & Bayes Theorem",
    ],
  },
  "CUET": {
    "General Test": [
      "Quantitative Reasoning & Arithmetic",
      "Logical & Analytical Reasoning",
      "Current Affairs & General Knowledge",
      "Data Interpretation",
    ],
    "English Language": [
      "Reading Comprehension",
      "Vocabulary & Synonyms/Antonyms",
      "Sentence Rearrangement & Para Jumbles",
      "Idioms & Phrases",
    ],
  },
  "Bank & SSC": {
    "Quantitative Aptitude": [
      "Number Systems & Simplification",
      "Percentages, Profit & Loss",
      "Simple & Compound Interest",
      "Ratio, Proportion & Mixture",
      "Time, Speed, Distance & Work",
      "Data Interpretation & Analysis",
    ],
    "Reasoning Ability": [
      "Syllogisms & Deductive Logic",
      "Seating Arrangement & Puzzles",
      "Blood Relations & Direction Sense",
      "Coding-Decoding & Series",
    ],
  },
};

// Internal active timer reference
let agentIntervalTimer = null;
let isLoopRunning = false;
const AGENT_ID = "test_series_agent";

// Helper: Append log to agent state
export async function appendAgentLog(agentId, level, message, details = null) {
  try {
    const timestamp = new Date().toISOString();
    const logEntry = { timestamp, level, message, details };
    
    // Fetch current state doc
    let doc = await AgentStateConfig.findOne({ agentId });
    if (!doc) {
      doc = await AgentStateConfig.create({
        agentId,
        name: "Autonomous Test Series Synthesizer",
        logs: [logEntry],
      });
    } else {
      const existingLogs = Array.isArray(doc.logs) ? doc.logs : [];
      // Keep last 100 log entries
      const updatedLogs = [logEntry, ...existingLogs].slice(0, 100);
      doc.logs = updatedLogs;
      await doc.save();
    }
  } catch (err) {
    console.error("[AgentService] Failed to append log:", err.message);
  }
}

// 1. Get Agent State and Telemetry
export async function getAgentState(agentId = AGENT_ID) {
  let doc = await AgentStateConfig.findOne({ agentId });
  if (!doc) {
    doc = await AgentStateConfig.create({
      agentId,
      name: "Autonomous Test Series Synthesizer",
      isRunning: false,
      config: {
        intervalSeconds: 45,
        rateLimitPerHour: 15,
        maxConsecutiveErrors: 3,
        preferredModel: "gemini-3.8-flash",
        categories: Object.keys(CURRICULUM_CATALOG),
        questionsCount: 15,
      },
      state: {
        currentCategory: "JEE Main & Advanced",
        currentSubject: "Physics",
        currentTopic: "Electrostatics & Gauss Law",
        currentDifficulty: "Medium",
        totalGenerated: 0,
        totalApproved: 0,
        lastGeneratedTitle: "",
      },
      logs: [
        {
          timestamp: new Date().toISOString(),
          level: "info",
          message: "Autonomous Test Series Agent initialized in standby mode.",
        },
      ],
      runsThisHour: 0,
      hourWindowStart: new Date(),
      consecutiveErrors: 0,
      circuitBreakerTripped: false,
    });
  }

  // Count pending, approved, rejected from AgentTestSeries
  const pendingCount = await AgentTestSeries.countDocuments({ status: "pending_review" });
  const approvedCount = await AgentTestSeries.countDocuments({ status: "approved" });
  const rejectedCount = await AgentTestSeries.countDocuments({ status: "rejected" });
  const totalStaged = pendingCount + approvedCount + rejectedCount;

  return {
    agentId: doc.agentId,
    name: doc.name,
    isRunning: Boolean(doc.isRunning),
    config: doc.config || {},
    state: doc.state || {},
    logs: doc.logs || [],
    lastRunAt: doc.lastRunAt,
    nextRunAt: doc.nextRunAt,
    runsThisHour: doc.runsThisHour || 0,
    consecutiveErrors: doc.consecutiveErrors || 0,
    circuitBreakerTripped: Boolean(doc.circuitBreakerTripped),
    metrics: {
      pendingReview: pendingCount,
      approved: approvedCount,
      rejected: rejectedCount,
      totalGenerated: totalStaged,
    },
  };
}

// 2. Update Agent Configuration
export async function updateAgentConfig(agentId = AGENT_ID, updates = {}) {
  let doc = await AgentStateConfig.findOne({ agentId });
  if (!doc) {
    await getAgentState(agentId);
    doc = await AgentStateConfig.findOne({ agentId });
  }

  if (updates.config) {
    doc.config = { ...doc.config, ...updates.config };
  }
  if (updates.resetCircuitBreaker) {
    doc.circuitBreakerTripped = false;
    doc.consecutiveErrors = 0;
    await appendAgentLog(agentId, "info", "Circuit breaker manually reset by admin.");
  }

  await doc.save();
  return await getAgentState(agentId);
}

// 3. Duplicate Detection and Topic Selector
async function selectNextSynthesisTarget(agentDoc) {
  const allowedCategories =
    agentDoc.config?.categories && agentDoc.config.categories.length > 0
      ? agentDoc.config.categories
      : Object.keys(CURRICULUM_CATALOG);

  const difficulties = ["Easy", "Medium", "Hard"];

  // Fetch recent titles from AgentTestSeries and main TestSeries to avoid duplicates
  let stagedRecent = [];
  try {
    stagedRecent = await AgentTestSeries.find({})
      .select("category subject topic difficulty title")
      .limit(500);
  } catch (_) {}

  let mainRecent = [];
  try {
    mainRecent = await TestSeries.find({})
      .select("category subject topic difficulty title")
      .limit(500);
  } catch (_) {}

  const existingCombinations = new Set();
  [...stagedRecent, ...mainRecent].forEach((item) => {
    if (item.category && item.subject && item.topic && item.difficulty) {
      existingCombinations.add(
        `${item.category.trim()}|||${item.subject.trim()}|||${item.topic.trim()}|||${item.difficulty.trim()}`.toLowerCase()
      );
    }
  });

  // Also read custom taxonomy from disk
  const taxonomy = readCategoryTaxonomy();

  // Find a target combination that has not been generated yet
  for (const cat of allowedCategories) {
    const catalogSubjects = CURRICULUM_CATALOG[cat] || {};
    // Merge taxonomy subjects if any
    const taxCat = taxonomy[cat.toLowerCase()]?.subjects || [];
    const subjectNames = new Set([
      ...Object.keys(catalogSubjects),
      ...taxCat.map((s) => s.name),
    ]);

    for (const sub of subjectNames) {
      const catalogTopics = catalogSubjects[sub] || [];
      const taxTopics =
        taxCat.find((s) => s.name?.toLowerCase() === sub.toLowerCase())?.topics || [];
      const topicNames = [...new Set([...catalogTopics, ...taxTopics])];

      for (const top of topicNames) {
        for (const diff of difficulties) {
          const comboKey = `${cat.trim()}|||${sub.trim()}|||${top.trim()}|||${diff.trim()}`.toLowerCase();
          if (!existingCombinations.has(comboKey)) {
            return {
              category: cat,
              subject: sub,
              topic: top,
              difficulty: diff,
            };
          }
        }
      }
    }
  }

  // If all generated, pick random from active categories with randomized difficulty
  const randomCat = allowedCategories[Math.floor(Math.random() * allowedCategories.length)];
  const subjectsObj = CURRICULUM_CATALOG[randomCat] || { General: ["Comprehensive Test"] };
  const subKeys = Object.keys(subjectsObj);
  const randomSub = subKeys[Math.floor(Math.random() * subKeys.length)];
  const topicList = subjectsObj[randomSub] || ["Core Concepts"];
  const randomTop = topicList[Math.floor(Math.random() * topicList.length)];
  const randomDiff = difficulties[Math.floor(Math.random() * difficulties.length)];

  return {
    category: randomCat,
    subject: randomSub,
    topic: randomTop,
    difficulty: randomDiff,
  };
}

// 4. Autonomous Agent Step Synthesis
export async function executeAgentStep(agentId = AGENT_ID) {
  if (isLoopRunning) {
    console.log("[AgentService] Step already running, skipping overlapping tick.");
    return;
  }
  isLoopRunning = true;

  try {
    const doc = await AgentStateConfig.findOne({ agentId });
    if (!doc || !doc.isRunning) {
      isLoopRunning = false;
      return;
    }

    // Check Circuit Breaker
    if (doc.circuitBreakerTripped) {
      console.warn("[AgentService] Circuit breaker is tripped. Halting agent to protect credits.");
      doc.isRunning = false;
      await doc.save();
      await appendAgentLog(
        agentId,
        "warn",
        "Agent paused automatically: Circuit breaker tripped due to consecutive errors. Reset in dashboard to resume."
      );
      stopAgentLoop();
      isLoopRunning = false;
      return;
    }

    // Check Rate Limiter (Hour window check)
    const now = new Date();
    const windowStart = doc.hourWindowStart ? new Date(doc.hourWindowStart) : now;
    const hoursElapsed = (now.getTime() - windowStart.getTime()) / (1000 * 60 * 60);

    if (hoursElapsed >= 1) {
      // Reset hourly rate limit window
      doc.runsThisHour = 0;
      doc.hourWindowStart = now;
    }

    const rateLimitPerHour = doc.config?.rateLimitPerHour || 15;
    if (doc.runsThisHour >= rateLimitPerHour) {
      await appendAgentLog(
        agentId,
        "warn",
        `Rate limit reached (${doc.runsThisHour}/${rateLimitPerHour} tests this hour). Standing by until window reset to protect AI quota.`
      );
      isLoopRunning = false;
      return;
    }

    // Target Selection
    const target = await selectNextSynthesisTarget(doc);
    const questionsCount = doc.config?.questionsCount || 15;

    await appendAgentLog(
      agentId,
      "info",
      `[RESEARCH] Initiating PYQ & high-yield synthesis for: [${target.category}] > [${target.subject}] > [${target.topic}] (Difficulty: ${target.difficulty})...`
    );

    // Update state to current target
    doc.state = {
      ...doc.state,
      currentCategory: target.category,
      currentSubject: target.subject,
      currentTopic: target.topic,
      currentDifficulty: target.difficulty,
    };
    await doc.save();

    // Call Gemini API to scrape & synthesize authentic content
    const systemInstruction = `You are an elite Examination Board Chief Curator, Competitive Test Architect, and Academic Researcher specializing in Indian & Global standardized examinations (JEE Main & Advanced, NEET-UG, CBSE Board, ICSE, CUET, Banking, Olympiads).
Your task is to crawl and synthesize authentic Previous Year Questions (PYQs), repeated examination patterns, top coaching institute benchmarks, and high-yield problems.
Produce rigorous, accurate, high-quality test series with zero hallucinations. Every question must feature unambiguous options, an accurate correct answer, and an in-depth step-by-step mathematical/conceptual derivation in explanation.
Respond ONLY with a valid, clean JSON object matching the requested schema.`;

    const prompt = `Research and generate a complete, authentic high-yield test series for:
- Exam / Category: ${target.category}
- Subject: ${target.subject}
- Topic: ${target.topic}
- Target Difficulty: ${target.difficulty}
- Total Questions: ${questionsCount}

Requirements:
1. Synthesize real PYQs (Previous Year Questions from 2017 to 2024), standard NCERT exemplars, and competitive examination tier questions.
2. Structure the title professionally, e.g.: "${target.category} ${target.subject} - ${target.topic} (PYQ & Benchmark Series)"
3. For ${target.difficulty} difficulty:
   - Easy: Direct conceptual, formula applications, standard definitions.
   - Medium: Multi-concept problems, standard exam level, tricky edge cases.
   - Hard: Advanced multi-step derivations, Olympiad/JEE-Advanced level numericals, assertion-reason or composite statements.
4. Total Marks: ${questionsCount * 4}, Passing Marks: ${Math.round(questionsCount * 4 * 0.4)}, Duration: ${Math.max(30, questionsCount * 3)} minutes.
5. All mathematical symbols, physical dimensions, and chemical equations MUST be formatted using real-world typographic notation. Never use raw ASCII carets or bracketed powers like [M^0 L T^(-3)] or x^2 or 10^(-6). Use real-world superscripts: e.g. [M⁰ L T⁻³], [M¹ L² T⁻²], 10⁻⁶, x², cm³, kg m⁻³.
6. Provide an informative summary in sourceInfo explaining the historical exam frequency, target years, and key conceptual anchors.

Return strictly a JSON object with this exact structure:
{
  "title": "string",
  "description": "string",
  "category": "${target.category}",
  "subject": "${target.subject}",
  "topic": "${target.topic}",
  "difficulty": "${target.difficulty}",
  "durationMinutes": number,
  "totalMarks": number,
  "passingMarks": number,
  "instructions": "string",
  "sourceInfo": {
    "sourceExam": "string",
    "yearRange": "string",
    "pyqFocus": "string",
    "keyConceptsCovered": ["string"]
  },
  "questions": [
    {
      "id": "q_1",
      "type": "single_choice",
      "question": "string",
      "options": [
        { "id": "A", "text": "string" },
        { "id": "B", "text": "string" },
        { "id": "C", "text": "string" },
        { "id": "D", "text": "string" }
      ],
      "correctAnswers": ["A"],
      "marks": 4,
      "negativeMarks": 1,
      "explanation": "string with detailed derivation"
    }
  ]
}`;

    const preferredModel = doc.config?.preferredModel || "gemini-3.8-flash";
    const rawResponse = await callGeminiApi({
      prompt,
      systemInstruction,
      temperature: 0.25,
      preferredModel,
    });

    const parsedData = extractJsonFromText(rawResponse);
    if (!parsedData || !Array.isArray(parsedData.questions) || parsedData.questions.length === 0) {
      throw new Error("Failed to parse valid structured test series JSON from Gemini response.");
    }

    // Format & validate questions with real-world superscripts
    const formattedQuestions = parsedData.questions.map((q, idx) => ({
      id: q.id || `q_${Date.now()}_${idx + 1}`,
      type: q.type || "single_choice",
      question: formatDisplayMath(q.question || "Question prompt"),
      questionImageUrl: q.questionImageUrl || "",
      options: (Array.isArray(q.options) && q.options.length >= 2
        ? q.options
        : [
            { id: "A", text: "Option A" },
            { id: "B", text: "Option B" },
            { id: "C", text: "Option C" },
            { id: "D", text: "Option D" },
          ]
      ).map((opt, oIdx) => ({
        id: opt.id || String.fromCharCode(65 + oIdx),
        text: formatDisplayMath(String(opt.text || "")),
        imageUrl: opt.imageUrl || "",
      })),
      correctAnswers: Array.isArray(q.correctAnswers)
        ? q.correctAnswers
        : q.correctAnswer
        ? [q.correctAnswer]
        : ["A"],
      marks: Number(q.marks || 4),
      negativeMarks: Number(q.negativeMarks || 1),
      explanation: formatDisplayMath(String(q.explanation || "")),
    }));

    // Stage into AgentTestSeries
    const stagedTest = await AgentTestSeries.create({
      title: formatDisplayMath(parsedData.title || `${target.category} ${target.subject} - ${target.topic}`),
      description: formatDisplayMath(parsedData.description || `Autonomous AI Curated PYQs and conceptual benchmarks for ${target.topic}.`),
      category: target.category,
      subject: target.subject,
      topic: target.topic,
      difficulty: target.difficulty,
      durationMinutes: Number(parsedData.durationMinutes || 60),
      totalMarks: Number(parsedData.totalMarks || formattedQuestions.length * 4),
      passingMarks: Number(parsedData.passingMarks || Math.round(formattedQuestions.length * 4 * 0.4)),
      instructions: parsedData.instructions || "Read each question carefully. Negative marking applies for wrong answers.",
      questions: formattedQuestions,
      sourceInfo: parsedData.sourceInfo || {
        sourceExam: target.category,
        pyqFocus: "Curated Previous Year Questions & Core Exam Benchmarks",
      },
      status: "pending_review",
    });

    // Update telemetry state
    doc.lastRunAt = new Date();
    doc.runsThisHour = (doc.runsThisHour || 0) + 1;
    doc.consecutiveErrors = 0; // Reset error streak on success
    doc.state = {
      ...doc.state,
      totalGenerated: (doc.state?.totalGenerated || 0) + 1,
      lastGeneratedTitle: stagedTest.title,
    };
    await doc.save();

    await appendAgentLog(
      agentId,
      "success",
      `[STAGED] Successfully synthesized and staged "${stagedTest.title}" with ${formattedQuestions.length} questions. Pending admin review.`,
      {
        testId: stagedTest._id || stagedTest.id,
        category: target.category,
        subject: target.subject,
        topic: target.topic,
        difficulty: target.difficulty,
      }
    );
  } catch (error) {
    console.error("[AgentService] Execution step failed:", error);
    try {
      const doc = await AgentStateConfig.findOne({ agentId });
      if (doc) {
        doc.consecutiveErrors = (doc.consecutiveErrors || 0) + 1;
        const maxConsecutive = doc.config?.maxConsecutiveErrors || 3;
        if (doc.consecutiveErrors >= maxConsecutive) {
          doc.circuitBreakerTripped = true;
          doc.isRunning = false;
          stopAgentLoop();
          await appendAgentLog(
            agentId,
            "error",
            `[CIRCUIT_BREAKER] Tripped after ${doc.consecutiveErrors} consecutive errors: "${error.message}". Agent paused automatically to safeguard AI credits.`
          );
        } else {
          await appendAgentLog(
            agentId,
            "error",
            `[ERROR] Synthesis step error (${doc.consecutiveErrors}/${maxConsecutive}): ${error.message}`
          );
        }
        await doc.save();
      }
    } catch (_) {}
  } finally {
    isLoopRunning = false;
  }
}

// 5. Start Agent Loop
export async function startAgent(agentId = AGENT_ID) {
  let doc = await AgentStateConfig.findOne({ agentId });
  if (!doc) {
    await getAgentState(agentId);
    doc = await AgentStateConfig.findOne({ agentId });
  }

  if (doc.circuitBreakerTripped) {
    // Reset circuit breaker when user explicitly turns agent on
    doc.circuitBreakerTripped = false;
    doc.consecutiveErrors = 0;
  }

  doc.isRunning = true;
  await doc.save();

  await appendAgentLog(
    agentId,
    "info",
    "Autonomous Agent activated by Super Admin. Synthesis loop started."
  );

  // Trigger immediate first step
  setTimeout(() => {
    executeAgentStep(agentId).catch((e) => console.error(e));
  }, 1000);

  // Set recurring loop interval
  startAgentLoop(agentId, doc.config?.intervalSeconds || 45);

  return await getAgentState(agentId);
}

// 6. Stop Agent Loop
export async function stopAgent(agentId = AGENT_ID) {
  let doc = await AgentStateConfig.findOne({ agentId });
  if (doc) {
    doc.isRunning = false;
    await doc.save();
  }

  stopAgentLoop();
  await appendAgentLog(
    agentId,
    "info",
    "Autonomous Agent halted by Super Admin. Standby mode active."
  );

  return await getAgentState(agentId);
}

function startAgentLoop(agentId, intervalSeconds = 45) {
  stopAgentLoop();
  const ms = Math.max(15, intervalSeconds) * 1000;
  agentIntervalTimer = setInterval(() => {
    executeAgentStep(agentId).catch((err) =>
      console.error("[AgentService] Periodic loop error:", err)
    );
  }, ms);
  console.log(`[AgentService] Autonomous loop running with interval ${intervalSeconds}s.`);
}

function stopAgentLoop() {
  if (agentIntervalTimer) {
    clearInterval(agentIntervalTimer);
    agentIntervalTimer = null;
  }
}

// 7. Staging and Review Management
export async function getStagedTestSeries({ status, page = 1, limit = 20, search }) {
  const query = {};
  if (status && status !== "all") {
    query.status = status;
  } else if (!status) {
    query.status = "pending_review";
  }

  if (search) {
    query.$or = [
      { title: { $regex: search, $options: "i" } },
      { category: { $regex: search, $options: "i" } },
      { subject: { $regex: search, $options: "i" } },
      { topic: { $regex: search, $options: "i" } },
    ];
  }

  const skip = (Number(page) - 1) * Number(limit);
  const total = await AgentTestSeries.countDocuments(query);
  const items = await AgentTestSeries.find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(Number(limit));

  return {
    items,
    pagination: {
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / Number(limit)),
    },
  };
}

// 8. Promote / Approve Staged Test Series to Main Table
export async function approveAgentTest(stagedId, adminUser = null) {
  const staged = await AgentTestSeries.findById(stagedId);
  if (!staged) {
    throw new Error("Staged test series not found.");
  }
  if (staged.status === "approved" && staged.promotedTestId) {
    return staged;
  }

  const folderPath = `/${staged.category}/${staged.subject}/${staged.topic}`;

  // Copy into main TestSeries table
  const mainTest = await TestSeries.create({
    title: staged.title,
    description: staged.description || "",
    category: staged.category,
    subject: staged.subject,
    topic: staged.topic,
    difficulty: staged.difficulty,
    durationMinutes: staged.durationMinutes,
    totalMarks: staged.totalMarks,
    passingMarks: staged.passingMarks,
    instructions: staged.instructions,
    questions: staged.questions,
    folderPath,
    isGlobal: true,
    isPublished: true,
    isLocked: false,
    createdBy: adminUser?._id || adminUser?.id || null,
  });

  // Ensure category, subject & topic are recorded in category_taxonomy.json
  try {
    const taxonomy = readCategoryTaxonomy();
    const catKey = String(staged.category || "General").toLowerCase().trim();
    if (!taxonomy[catKey]) {
      taxonomy[catKey] = { subjects: [] };
    }
    if (!Array.isArray(taxonomy[catKey].subjects)) {
      taxonomy[catKey].subjects = [];
    }
    let subObj = taxonomy[catKey].subjects.find(
      (s) => s.name?.toLowerCase().trim() === String(staged.subject).toLowerCase().trim()
    );
    if (!subObj) {
      subObj = { name: staged.subject, icon: "📚", topics: [] };
      taxonomy[catKey].subjects.push(subObj);
    }
    if (!Array.isArray(subObj.topics)) subObj.topics = [];
    if (!subObj.topics.includes(staged.topic)) {
      subObj.topics.push(staged.topic);
    }
    writeCategoryTaxonomy(taxonomy);
  } catch (taxErr) {
    console.warn("[AgentService] Failed updating taxonomy:", taxErr.message);
  }

  // Update staged test status
  staged.status = "approved";
  staged.promotedTestId = mainTest._id || mainTest.id;
  staged.reviewedAt = new Date();
  staged.reviewedBy = adminUser?.name || adminUser?.email || "Super Admin";
  await staged.save();

  // Increment total approved counter in agent state
  try {
    const agentDoc = await AgentStateConfig.findOne({ agentId: AGENT_ID });
    if (agentDoc) {
      agentDoc.state = {
        ...agentDoc.state,
        totalApproved: (agentDoc.state?.totalApproved || 0) + 1,
      };
      await agentDoc.save();
    }
  } catch (_) {}

  await appendAgentLog(
    AGENT_ID,
    "success",
    `[APPROVED] Test "${staged.title}" approved and published to main test series table (ID: ${mainTest._id || mainTest.id}).`
  );

  return staged;
}

// 9. Reject Staged Test
export async function rejectAgentTest(stagedId, reason = "", adminUser = null) {
  const staged = await AgentTestSeries.findById(stagedId);
  if (!staged) {
    throw new Error("Staged test series not found.");
  }

  staged.status = "rejected";
  staged.rejectionReason = reason || "Declined by reviewer";
  staged.reviewedAt = new Date();
  staged.reviewedBy = adminUser?.name || adminUser?.email || "Super Admin";
  await staged.save();

  await appendAgentLog(
    AGENT_ID,
    "info",
    `[REJECTED] Staged test "${staged.title}" rejected. Reason: ${staged.rejectionReason}`
  );

  return staged;
}

// 10. Batch Approve All Pending
export async function approveAllPending(adminUser = null) {
  const pendingTests = await AgentTestSeries.find({ status: "pending_review" });
  const results = { approved: 0, errors: 0 };

  for (const test of pendingTests) {
    try {
      await approveAgentTest(test._id || test.id, adminUser);
      results.approved++;
    } catch (err) {
      console.error(`[AgentService] Error approving test ${test._id}:`, err);
      results.errors++;
    }
  }

  await appendAgentLog(
    AGENT_ID,
    "success",
    `[BATCH_APPROVE] Batch approved ${results.approved} tests into main catalog (${results.errors} errors).`
  );

  return results;
}
