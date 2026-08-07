import fs from "fs";
import readline from "readline";

const logPath = "C:\\Users\\priya\\.gemini\\antigravity\\brain\\c933197c-c475-4ad5-a3d5-bcb7835625f2\\.system_generated\\logs\\transcript.jsonl";

async function parseLogs() {
  const fileStream = fs.createReadStream(logPath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  console.log("Searching transcript for August payments details...");
  for await (const line of rl) {
    if (line.toLowerCase().includes("remove") || line.toLowerCase().includes("deleted") || line.toLowerCase().includes("payments")) {
      const obj = JSON.parse(line);
      // Let's print any content or output that contains list of payments or student details
      if (obj.content && (obj.content.includes("payment") || obj.content.includes("delete") || obj.content.includes("Tiwari"))) {
        console.log("--- FOUND CONTENT ---");
        console.log(obj.content.substring(0, 1500));
      }
      if (obj.tool_calls) {
        for (const tc of obj.tool_calls) {
          if (tc.args && JSON.stringify(tc.args).includes("payments")) {
            console.log("--- FOUND TOOL CALL ---");
            console.log(tc.name, JSON.stringify(tc.args).substring(0, 1000));
          }
        }
      }
    }
  }
}

parseLogs();
