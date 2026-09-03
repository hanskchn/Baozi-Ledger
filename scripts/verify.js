// 家庭记账本 · 可重复静态验收脚本
// 运行：node scripts/verify.js
// 覆盖发布级验收 4.6 的代码质量项与静态回归：语法、前端不直连数据库、无 openid 泄露、WXML 配平、
// 下拉刷新配置配对、git 空白检查。
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const failures = [];
const ok = (label) => console.log("  ✔ " + label);
const fail = (label, detail) => { failures.push(label); console.log("  ✘ " + label + (detail ? " — " + detail : "")); };

function listFiles(dir, ext) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      if (name === "node_modules" || name === ".git") continue;
      out.push(...listFiles(full, ext));
    } else if (name.endsWith(ext)) {
      out.push(full);
    }
  }
  return out;
}

console.log("[1/13] JS 语法检查 (node --check)");
const allJs = [
  ...listFiles(path.join(ROOT, "miniprogram"), ".js"),
  ...listFiles(path.join(ROOT, "cloudfunctions"), ".js")
].filter((f) => !f.includes(path.sep + "node_modules" + path.sep));
let syntaxOk = true;
for (const f of allJs) {
  try {
    execFileSync(process.execPath, ["--check", f], { stdio: "pipe" });
  } catch (e) {
    syntaxOk = false;
    fail(path.relative(ROOT, f), (e.stderr || "").toString().split("\n")[0]);
    break;
  }
}
if (syntaxOk) ok(`${allJs.length} 个文件通过`);

console.log("[2/13] 前端不直接操作云数据库");
const frontendJs = listFiles(path.join(ROOT, "miniprogram"), ".js").filter((f) => !f.includes("ec-canvas"));
let directDb = [];
for (const f of frontendJs) {
  const src = fs.readFileSync(f, "utf8");
  if (/(wx\.cloud\.database|\b\.collection\()/.test(src)) directDb.push(path.relative(ROOT, f));
}
if (directDb.length === 0) ok("无 wx.cloud.database / .collection(");
else fail("发现前端直连数据库", directDb.join(", "));

console.log("[3/13] 前端无 openid / 敏感成员字段残留");
const sensitive = /openid|creatorOpenId|memberOpenid|operatorOpenId|data-openid/;
const frontendFiles = [
  ...listFiles(path.join(ROOT, "miniprogram"), ".js"),
  ...listFiles(path.join(ROOT, "miniprogram"), ".wxml")
].filter((f) => !f.includes("ec-canvas"));
let leaks = [];
for (const f of frontendFiles) {
  const src = fs.readFileSync(f, "utf8");
  if (sensitive.test(src)) leaks.push(path.relative(ROOT, f));
}
if (leaks.length === 0) ok("无敏感字段残留");
else fail("发现敏感字段", leaks.join(", "));

console.log("[4/13] WXML 标签配平 (view)");
let wxmlBad = [];
for (const f of listFiles(path.join(ROOT, "miniprogram"), ".wxml")) {
  const src = fs.readFileSync(f, "utf8");
  const open = (src.match(/<view/g) || []).length;
  const close = (src.match(/<\/view>/g) || []).length;
  if (open !== close) wxmlBad.push(path.relative(ROOT, f) + ` (open=${open}, close=${close})`);
}
if (wxmlBad.length === 0) ok("全部 WXML view 标签配平");
else fail("WXML 标签不配平", wxmlBad.join(", "));

console.log("[5/13] WXML 规范（wx:for 带 wx:key，事件处理器存在）");
function readFile(p){ return fs.readFileSync(p, "utf8"); }
const wxmlFiles = listFiles(path.join(ROOT, "miniprogram"), ".wxml");
const wxmlIssues = [];
for (const wxml of wxmlFiles) {
  const wsrc = readFile(wxml);
  const tagRe = /<\w+\b([^>]*?)>/g;
  let tm;
  while ((tm = tagRe.exec(wsrc))) {
    if (tm[1].includes("wx:for") && !tm[1].includes("wx:key")) {
      wxmlIssues.push(path.relative(ROOT, wxml) + ": wx:for 缺少 wx:key");
    }
  }
  const js = wxml.replace(/\.wxml$/, ".js");
  if (!fs.existsSync(js)) { wxmlIssues.push(path.relative(ROOT, wxml) + ": 缺少同名 .js"); continue; }
  const jsrc = readFile(js);
  const handlerRe = /\b(?:bind|catch)[a-z]+="([A-Za-z_$][\w$]*)"/g;
  let hm;
  while ((hm = handlerRe.exec(wsrc))) {
    if (!new RegExp("\\b" + hm[1].replace(/[$]/g, "\\$&") + "\\s*(\\(|:)").test(jsrc)) {
      wxmlIssues.push(path.relative(ROOT, wxml) + ": 未定义处理器 " + hm[1]);
    }
  }
}
if (wxmlIssues.length === 0) ok("全部 WXML wx:for 带 wx:key 且事件处理器已定义");
else fail("WXML 规范问题", wxmlIssues.slice(0, 8).join("; "));

console.log("[6/13] 页面下拉刷新配置（onPullDownRefresh ↔ enablePullDownRefresh）");
const pageDirs = fs.readdirSync(path.join(ROOT, "miniprogram", "pages"));
const refreshIssues = [];
for (const dir of pageDirs) {
  const jsPath = path.join(ROOT, "miniprogram", "pages", dir, "index.js");
  const jsonPath = path.join(ROOT, "miniprogram", "pages", dir, "index.json");
  if (!fs.existsSync(jsPath) || !fs.existsSync(jsonPath)) continue;
  const hasHandler = /\bonPullDownRefresh\s*\(/.test(fs.readFileSync(jsPath, "utf8"));
  let enabled = false;
  try { enabled = JSON.parse(fs.readFileSync(jsonPath, "utf8")).enablePullDownRefresh === true; }
  catch (error) { refreshIssues.push("pages/" + dir + "/index.json 解析失败"); continue; }
  if (hasHandler && !enabled) refreshIssues.push("pages/" + dir + "/index.js 定义 onPullDownRefresh 但 index.json 未开启 enablePullDownRefresh");
  if (!hasHandler && enabled) refreshIssues.push("pages/" + dir + "/index.json 开启 enablePullDownRefresh 但未定义 onPullDownRefresh 处理器");
}
if (refreshIssues.length === 0) ok("全部页面 onPullDownRefresh 处理器与 enablePullDownRefresh 配置配对");
else fail("下拉刷新配置不一致", refreshIssues.join("; "));

console.log("[7/13] 视觉系统一致性（无非收入语义的绿色强调色）");
function toHsl(hex) {
  const n = parseInt(hex.slice(1), 16);
  let r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h, s, l };
}
const approvedGreens = new Set(["#4CAF50", "#16885F", "#E8F5E9"]);
const colorFiles = listFiles(path.join(ROOT, "miniprogram"), ".wxss");
const colorFlags = [];
for (const f of colorFiles) {
  const src = fs.readFileSync(f, "utf8");
  const colorRe = /#[0-9A-Fa-f]{6}/g;
  let mm;
  while ((mm = colorRe.exec(src))) {
    const hex = mm[0].toUpperCase();
    if (approvedGreens.has(hex)) continue;
    const hsl = toHsl(hex);
    if (hsl.h >= 80 && hsl.h <= 170 && hsl.s > 0.3 && hsl.l >= 0.2 && hsl.l <= 0.85) {
      colorFlags.push(path.relative(ROOT, f) + " " + mm[0]);
    }
  }
}
if (colorFlags.length === 0) ok("全部 WXSS 色彩符合暖橙体系（绿色仅收入语义）");
else fail("发现非收入语义的绿色强调色", colorFlags.slice(0, 8).join(", "));

console.log("[8/13] 前端 action ↔ 云函数 handler 契约一致性");
function extractHandlerMap(src) {
  const start = src.search(/const\s+(?:HANDLERS|handlers)\s*=\s*\{/);
  if (start < 0) return [];
  const end = src.indexOf("};", start);
  const block = src.slice(start, end);
  return (block.match(/^\s*,?\s*[A-Za-z]+,?$/gm) || []).map((x) => x.replace(/[\s,]/g, "")).filter(Boolean);
}
function collectCloudHandlers(fnPath) {
  const src = fs.readFileSync(fnPath, "utf8");
  if (fnPath.includes("accountingFunctions") || fnPath.includes("feedbackFunctions")) {
    return extractHandlerMap(src);
  }
  if (fnPath.includes("resetTestData")) {
    const actions = [];
    const re = /event\.action\s*(?:===|!==)\s*"([A-Za-z.]+)"/g;
    let mm;
    while ((mm = re.exec(src))) actions.push(mm[1]);
    return actions;
  }
  return (src.match(/case "[A-Za-z.]*":/g) || []).map((x) => x.replace(/case "|":/g, ""));
}
const handlers = new Set();
for (const dir of ["ledgerFunctions", "accountingFunctions", "feedbackFunctions", "resetTestData"]) {
  const p = path.join(ROOT, "cloudfunctions", dir, "index.js");
  if (fs.existsSync(p)) collectCloudHandlers(p).forEach((h) => handlers.add(h));
}
const frontend = [
  ...listFiles(path.join(ROOT, "miniprogram"), ".js"),
  ...listFiles(path.join(ROOT, "miniprogram"), ".wxml")
].filter((f) => !f.includes("ec-canvas"));
const actionRe = /(?:action:\s*|this\.(?:call|callFunction|callLedger)\()"([A-Za-z.]+)"/g;
const called = new Set();
for (const f of frontend) {
  const src = fs.readFileSync(f, "utf8");
  let m;
  while ((m = actionRe.exec(src))) called.add(m[1]);
  // 条件式传动作（仅此两处：启用/停用分类、账户）
  if (src.indexOf('? "deleteCategory" : "setCategoryEnabled"') !== -1) { called.add("deleteCategory"); called.add("setCategoryEnabled"); }
  if (src.indexOf('? "deleteAccount" : "setAccountEnabled"') !== -1) { called.add("deleteAccount"); called.add("setAccountEnabled"); }
}
const missing = Array.from(called).filter((name) => !handlers.has(name)).sort();
if (missing.length === 0) ok(called.size + " 个前端 action 均有对应云端 handler");
else fail("存在无对应 handler 的前端 action", missing.join(", "));

console.log("[9/13] 主包体积 < 2MB");
function dirBytes(dir) {
  let total = 0;
  if (!fs.existsSync(dir)) return 0;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) total += dirBytes(full);
    else total += stat.size;
  }
  return total;
}
const mainBytes = dirBytes(path.join(ROOT, "miniprogram"));
const limitBytes = 2 * 1024 * 1024;
if (mainBytes < limitBytes) ok("主包 " + Math.round(mainBytes / 1024) + " KB < 2MB");
else fail("主包体积超限", Math.round(mainBytes / 1024) + " KB >= 2MB");

console.log("[10/13] 品牌资源完整性（brand.js 引用图片存在且透明）");
const brandCfg = require(path.join(ROOT, "miniprogram", "utils", "brand.js"));
const pngSig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
const brandRefs = [brandCfg.logo, brandCfg.emptyBills, brandCfg.welcome, brandCfg.searchEmpty, brandCfg.importEmpty, brandCfg.importDone, brandCfg.networkError].filter(Boolean);
const brandIssues = [];
for (const rel of brandRefs) {
  const full = path.join(ROOT, "miniprogram", rel.replace(/^\//, ""));
  if (!fs.existsSync(full)) { brandIssues.push(rel + " 不存在"); continue; }
  const buf = fs.readFileSync(full);
  if (!buf.subarray(0, 8).equals(pngSig)) { brandIssues.push(rel + " 非 PNG"); continue; }
  const colorType = buf[25];
  if (colorType !== 6 && colorType !== 4) brandIssues.push(rel + " 无透明通道(colorType=" + colorType + ")");
}
if (brandIssues.length === 0) ok(brandRefs.length + " 张品牌资源均存在且为透明 PNG");
else fail("品牌资源问题", brandIssues.join("; "));

console.log("[11/13] 静态图片路径有效性（WXML image src + tabBar 图标）");
const imgIssues = [];
const staticImgRe = /<image\b[^>]*\bsrc="([^"{]*?)"/g;
for (const f of listFiles(path.join(ROOT, "miniprogram"), ".wxml")) {
  const src = fs.readFileSync(f, "utf8");
  let im;
  while ((im = staticImgRe.exec(src))) {
    const rel = im[1];
    if (!rel || /^https?:|^data:|^{{/.test(rel)) continue;
    if (!fs.existsSync(path.join(ROOT, "miniprogram", rel.replace(/^\//, "")))) {
      imgIssues.push(path.relative(ROOT, f) + " -> " + rel + " 不存在");
    }
  }
}
try {
  const appCfg = JSON.parse(fs.readFileSync(path.join(ROOT, "miniprogram", "app.json"), "utf8"));
  const tabs = (appCfg.tabBar && appCfg.tabBar.list) || [];
  for (const t of tabs) {
    for (const k of ["iconPath", "selectedIconPath"]) {
      const rel = t[k];
      if (rel && !fs.existsSync(path.join(ROOT, "miniprogram", rel.replace(/^\//, "")))) {
        imgIssues.push("tabBar " + k + " -> " + rel + " 不存在");
      }
    }
  }
} catch (e) { imgIssues.push("app.json 解析失败: " + e.message); }
if (imgIssues.length === 0) ok("WXML 静态图片与 tabBar 图标路径均有效");
else fail("图片路径无效", imgIssues.slice(0, 8).join("; "));

console.log("[12/13] git 空白检查 (git diff --check)");
try {
  execFileSync("git", ["diff", "--check"], { cwd: ROOT, stdio: "pipe" });
  ok("无空白错误");
} catch (e) {
  fail("git diff --check 存在空白错误", (e.stderr || "").toString().split("\n").filter(Boolean).slice(0, 3).join(" | "));
}

console.log("[13/13] 开发者白名单一致性（feedback / resetTestData / ledger 提醒调试）");
const developerLists = [];
for (const file of allJs) {
  const src = fs.readFileSync(file, "utf8");
  const match = src.match(/const (?:DEVELOPER_OPENIDS|REMINDER_DEBUG_DEVELOPER_OPENIDS)\s*=\s*(\[[^\]]*\])/);
  if (match) developerLists.push({ file: path.relative(ROOT, file), list: match[1].replace(/\s+/g, "") });
}
if (developerLists.length < 2) {
  fail("未找到开发者白名单定义", "应至少包含 feedback / resetTestData / ledger 三处");
} else {
  const first = developerLists[0].list;
  const mismatch = developerLists.filter((item) => item.list !== first).map((item) => item.file);
  if (mismatch.length) {
    fail("开发者白名单不一致，换号需三处同步", developerLists.map((item) => item.file + "=" + item.list).join("; "));
  } else {
    ok("开发者白名单 " + developerLists.length + " 处一致");
  }
}

console.log("");
if (failures.length === 0) {
  console.log("✅ 静态验收全部通过");
  process.exit(0);
} else {
  console.log(`❌ 发现 ${failures.length} 项未通过`);
  process.exit(1);
}
