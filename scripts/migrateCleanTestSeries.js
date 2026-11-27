import dotenv from "dotenv";
dotenv.config();

import AgentTestSeries from "../src/models/AgentTestSeries.js";
import TestSeries from "../src/models/TestSeries.js";
import { formatDisplayMath, formatStepByStepSolution } from "../src/utils/mathFormatter.js";

async function runMigration() {
  console.log("Starting test series explanation and math cleanup migration...");

  // 1. Clean all staged test series in agent_test_series
  const agentTests = await AgentTestSeries.find({});
  console.log(`Found ${agentTests.length} agent test series.`);

  let updatedAgentCount = 0;
  for (const test of agentTests) {
    let changed = false;
    const questions = Array.isArray(test.questions) ? test.questions : [];
    const cleanedQuestions = questions.map((q) => {
      const origExp = q.explanation || "";
      const cleanedExp = formatStepByStepSolution(origExp);
      const cleanedQ = formatDisplayMath(q.question);
      const cleanedOpts = Array.isArray(q.options)
        ? q.options.map((opt) => ({ ...opt, text: formatDisplayMath(opt.text) }))
        : q.options;

      if (cleanedExp !== origExp) changed = true;
      return {
        ...q,
        question: cleanedQ,
        options: cleanedOpts,
        explanation: cleanedExp,
      };
    });

    if (changed) {
      test.questions = cleanedQuestions;
      await test.save();
      updatedAgentCount++;
      console.log(`[UPDATED AGENT TEST] ${test.title} (${test._id || test.id})`);
    }
  }

  // 2. Clean any test series in main test_series table
  const mainTests = await TestSeries.find({});
  console.log(`Found ${mainTests.length} main production test series.`);

  let updatedMainCount = 0;
  for (const test of mainTests) {
    let changed = false;
    const questions = Array.isArray(test.questions) ? test.questions : [];
    const cleanedQuestions = questions.map((q) => {
      const origExp = q.explanation || "";
      const cleanedExp = formatStepByStepSolution(origExp);
      const cleanedQ = formatDisplayMath(q.question);
      const cleanedOpts = Array.isArray(q.options)
        ? q.options.map((opt) => ({ ...opt, text: formatDisplayMath(opt.text) }))
        : q.options;

      if (cleanedExp !== origExp) changed = true;
      return {
        ...q,
        question: cleanedQ,
        options: cleanedOpts,
        explanation: cleanedExp,
      };
    });

    if (changed) {
      test.questions = cleanedQuestions;
      await test.save();
      updatedMainCount++;
      console.log(`[UPDATED MAIN TEST] ${test.title} (${test._id || test.id})`);
    }
  }

  console.log(`Migration complete! Updated ${updatedAgentCount} agent tests and ${updatedMainCount} main tests.`);
  process.exit(0);
}

runMigration().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
