const { spawn } = require("child_process");
const path = require("path");

console.log("🚀 Starting all bots...\n");

// Start AI Bot
const aiBot = spawn("node", ["ai.js"], {
  stdio: "inherit",
  cwd: __dirname,
});

// Start Taklif Bot
const taklifBot = spawn("node", ["taklif.js"], {
  stdio: "inherit",
  cwd: __dirname,
});

// Handle AI Bot exit
aiBot.on("exit", (code) => {
  console.log(`\n❌ AI Bot exited with code ${code}`);
  process.exit(code);
});

// Handle Taklif Bot exit
taklifBot.on("exit", (code) => {
  console.log(`\n❌ Taklif Bot exited with code ${code}`);
  process.exit(code);
});

// Handle errors
aiBot.on("error", (error) => {
  console.error("❌ AI Bot error:", error);
});

taklifBot.on("error", (error) => {
  console.error("❌ Taklif Bot error:", error);
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n\n🛑 Shutting down all bots...");
  aiBot.kill("SIGINT");
  taklifBot.kill("SIGINT");
  setTimeout(() => {
    process.exit(0);
  }, 1000);
});

console.log("✅ Both bots are running!");
console.log("Press Ctrl+C to stop all bots\n");
