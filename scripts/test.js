// 家庭记账本 · 全部纯逻辑单元测试入口
// 运行：node scripts/test.js
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const files = ["test-pure.js", "test-ledger-pure.js", "test-contract.js", "test-ledger-contract.js", "test-init.js", "test-import.js"].map((f) => path.join(__dirname, f));
try {
  execFileSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
} catch (e) {
  process.exit(1);
}
