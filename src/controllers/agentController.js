import * as agentService from "../services/agentService.js";
import AgentTestSeries from "../models/AgentTestSeries.js";

// 1. Get Agent Telemetry & Status
export const getAgentStatus = async (req, res) => {
  try {
    const agentId = req.params.agentId || "test_series_agent";
    const status = await agentService.getAgentState(agentId);
    res.json(status);
  } catch (error) {
    console.error("[AgentController] getAgentStatus error:", error);
    res.status(500).json({ message: "Failed to fetch agent status", error: error.message });
  }
};

// 2. Start Agent
export const startAgent = async (req, res) => {
  try {
    const agentId = req.body.agentId || "test_series_agent";
    const status = await agentService.startAgent(agentId);
    res.json({ message: "Autonomous agent started successfully", status });
  } catch (error) {
    console.error("[AgentController] startAgent error:", error);
    res.status(500).json({ message: "Failed to start agent", error: error.message });
  }
};

// 3. Stop Agent
export const stopAgent = async (req, res) => {
  try {
    const agentId = req.body.agentId || "test_series_agent";
    const status = await agentService.stopAgent(agentId);
    res.json({ message: "Autonomous agent stopped", status });
  } catch (error) {
    console.error("[AgentController] stopAgent error:", error);
    res.status(500).json({ message: "Failed to stop agent", error: error.message });
  }
};

// 4. Trigger Instant Single Step
export const triggerStep = async (req, res) => {
  try {
    const agentId = req.body.agentId || "test_series_agent";
    // Run asynchronously or await
    agentService.executeAgentStep(agentId).catch((e) => console.error(e));
    res.json({ message: "Agent step triggered. Check logs and queue for updates." });
  } catch (error) {
    console.error("[AgentController] triggerStep error:", error);
    res.status(500).json({ message: "Failed to trigger step", error: error.message });
  }
};

// 5. Update Agent Config
export const updateConfig = async (req, res) => {
  try {
    const agentId = req.body.agentId || "test_series_agent";
    const updated = await agentService.updateAgentConfig(agentId, req.body);
    res.json({ message: "Agent configuration updated", status: updated });
  } catch (error) {
    console.error("[AgentController] updateConfig error:", error);
    res.status(500).json({ message: "Failed to update config", error: error.message });
  }
};

// 6. Get Staged Tests
export const getStagedTests = async (req, res) => {
  try {
    const { status, page = 1, limit = 20, search } = req.query;
    const result = await agentService.getStagedTestSeries({ status, page, limit, search });
    res.json(result);
  } catch (error) {
    console.error("[AgentController] getStagedTests error:", error);
    res.status(500).json({ message: "Failed to fetch staged test series", error: error.message });
  }
};

// 7. Get Single Staged Test
export const getStagedTestById = async (req, res) => {
  try {
    const item = await AgentTestSeries.findById(req.params.id);
    if (!item) {
      return res.status(404).json({ message: "Staged test not found" });
    }
    res.json(item);
  } catch (error) {
    console.error("[AgentController] getStagedTestById error:", error);
    res.status(500).json({ message: "Failed to fetch test details", error: error.message });
  }
};

// 8. Approve Staged Test
export const approveTest = async (req, res) => {
  try {
    const approved = await agentService.approveAgentTest(req.params.id, req.user);
    res.json({ message: "Test series approved and published to main catalog", test: approved });
  } catch (error) {
    console.error("[AgentController] approveTest error:", error);
    res.status(500).json({ message: error.message || "Failed to approve test" });
  }
};

// 9. Reject Staged Test
export const rejectTest = async (req, res) => {
  try {
    const { reason } = req.body;
    const rejected = await agentService.rejectAgentTest(req.params.id, reason, req.user);
    res.json({ message: "Test series rejected", test: rejected });
  } catch (error) {
    console.error("[AgentController] rejectTest error:", error);
    res.status(500).json({ message: error.message || "Failed to reject test" });
  }
};

// 10. Approve All Pending
export const approveAll = async (req, res) => {
  try {
    const results = await agentService.approveAllPending(req.user);
    res.json({
      message: `Batch approved ${results.approved} tests into main catalog.`,
      results,
    });
  } catch (error) {
    console.error("[AgentController] approveAll error:", error);
    res.status(500).json({ message: error.message || "Failed to batch approve" });
  }
};

// 11. Delete Staged Test
export const deleteStagedTest = async (req, res) => {
  try {
    await AgentTestSeries.findByIdAndDelete(req.params.id);
    res.json({ message: "Staged test deleted successfully" });
  } catch (error) {
    console.error("[AgentController] deleteStagedTest error:", error);
    res.status(500).json({ message: "Failed to delete staged test", error: error.message });
  }
};
