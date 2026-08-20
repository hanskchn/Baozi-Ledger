// 家庭记账本 · 导出（多选 + 多 sheet + 5000 上限）契约测试
// 运行：node --test scripts/test-export.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("module");
const { makeCloud } = require("./fake-db");

let openid = "";
const originalLoad = Module._load;
const fakeCloud = makeCloud(() => openid);
fakeCloud.getWXContext = () => ({ OPENID: openid });
let lastUpload = null;
fakeCloud.uploadFile = (args) => {
  lastUpload = args;
  return Promise.resolve({ fileID: "cloud://test-bucket/" + (args.cloudPath || "x") });
};
fakeCloud.getTempFileURL = ({ fileList }) => Promise.resolve({ fileList: fileList.map((f) => ({ fileID: f.fileID, tempFileURL: "https://tmp.test/" + encodeURIComponent(f.fileID) })) });
fakeCloud.downloadFile = () => Promise.resolve({ fileContent: Buffer.from("stub") });
const fakeXlsx = {
  read() { return { SheetNames: ["stub"] }; },
  utils: {
    json_to_sheet(rows) { return { __rows: rows }; },
    book_new() { return { Sheets: {} }; },
    book_append_sheet(wb, ws, name) { wb.Sheets[name] = ws; return wb; }
  },
  write() { return Buffer.from("fake-xlsx"); }
};
Module._load = function (request, parent, isMain) {
  if (request === "wx-server-sdk") return fakeCloud;
  if (request === "xlsx") return fakeXlsx;
  return originalLoad.apply(this, arguments);
};
const m = require("../cloudfunctions/accountingFunctions/index.js");

function seed(opts = {}) {
  const db = fakeCloud.database();
  db.collections = {};
  db._seq = 0;
  db.collection("families").doc("famA").set({ data: { name: "家庭A", status: "active" } });
  db._rows("family_members").push(
    { _id: "m-admin", familyId: "famA", openid: "admin", nickName: "管理员", role: "admin", status: "active" },
    { _id: "m-member", familyId: "famA", openid: "member", nickName: "成员", role: "member", status: "active" }
  );
  // 默认 2 条账单：1 支出 + 1 收入
  const bills = [
    { _id: "b-exp", familyId: "famA", type: "expense", amount: 2000, date: "2026-08-01 12:00", category1: "餐饮", category2: "午餐", account: "现金", memberOpenid: "admin", memberId: "m-admin", member: "管理员", merchant: "", remark: "", deleted: false, version: 1 },
    { _id: "b-inc", familyId: "famA", type: "income", amount: 500000, date: "2026-08-15 18:00", category1: "工资", category2: "底薪", account: "招商银行卡", memberOpenid: "admin", memberId: "m-admin", member: "管理员", merchant: "", remark: "", deleted: false, version: 1 }
  ];
  if (opts.bills) bills.push(...opts.bills);
  db._rows("bills").push(...bills);
  return db;
}

const invoke = (event) => m.main(event);

test("exportBills 多选分类：只导入选中分类的账单", async () => {
  seed();
  openid = "admin";
  const result = await invoke({ action: "exportBills", familyId: "famA", categories: [{ name: "餐饮", type: "expense", level: "category1" }] });
  assert.equal(result.success, true);
  assert.equal(result.count, 1, "只导出餐饮支出");
  assert.equal(result.expenseCount, 1);
  assert.equal(result.incomeCount, 0);
});

test("exportBills 多选分类：支出 + 收入组合筛选", async () => {
  seed();
  openid = "admin";
  const result = await invoke({
    action: "exportBills",
    familyId: "famA",
    categories: [
      { name: "餐饮", type: "expense", level: "category1" },
      { name: "工资", type: "income", level: "category1" }
    ]
  });
  assert.equal(result.success, true);
  assert.equal(result.count, 2, "导出餐饮支出 + 工资收入 = 2 条");
  assert.equal(result.expenseCount, 1);
  assert.equal(result.incomeCount, 1);
});

test("exportBills 分类双向匹配：只传二级名也能命中（修复漏选）", async () => {
  // 用户在弹层点选的是叶子（二级），如"午餐"。账单 category1="餐饮", category2="午餐"，
  // 旧版按 level=category1 查 category1 字段会漏选；新版对每个 name 同时查 category1/category2。
  seed();
  openid = "admin";
  const result = await invoke({ action: "exportBills", familyId: "famA", categories: [{ name: "午餐", type: "expense" }] });
  assert.equal(result.success, true);
  assert.equal(result.count, 1, "二级名'午餐'应命中餐饮/午餐那条支出");
  assert.equal(result.expenseCount, 1);
});

test("exportBills 分类双向匹配：多个二级名组合（支出+收入叶子）", async () => {
  seed();
  openid = "admin";
  const result = await invoke({
    action: "exportBills",
    familyId: "famA",
    categories: [{ name: "午餐", type: "expense" }, { name: "底薪", type: "income" }]
  });
  assert.equal(result.success, true);
  assert.equal(result.count, 2, "午餐支出 + 底薪收入 = 2 条");
  assert.equal(result.expenseCount, 1);
  assert.equal(result.incomeCount, 1);
});

test("exportBills 分类双向匹配：一级名也能命中（兼容旧调用）", async () => {
  seed();
  openid = "admin";
  const result = await invoke({ action: "exportBills", familyId: "famA", categories: [{ name: "餐饮", type: "expense" }] });
  assert.equal(result.success, true);
  assert.equal(result.count, 1, "一级名'餐饮'同样命中");
});

test("exportBills 多选账户：按账户名数组过滤", async () => {
  seed();
  openid = "admin";
  const result = await invoke({ action: "exportBills", familyId: "famA", accounts: ["招商银行卡"] });
  assert.equal(result.success, true);
  assert.equal(result.count, 1, "只导出 招商银行卡 的账单");
  assert.equal(result.incomeCount, 1);
});

test("exportBills 多选成员：按 memberId 数组过滤", async () => {
  seed();
  openid = "admin";
  const result = await invoke({ action: "exportBills", familyId: "famA", memberIds: ["m-admin"] });
  assert.equal(result.success, true);
  assert.equal(result.count, 2, "管理员的 2 条账单");
});

test("exportBills 多选成员：空数组 → throw", async () => {
  seed();
  openid = "admin";
  const result = await invoke({ action: "exportBills", familyId: "famA", memberIds: [] });
  assert.equal(result.success, false);
  assert.match(result.message, /请至少选择 1 个成员/);
});

test("exportBills 多选账户：空数组 → throw", async () => {
  seed();
  openid = "admin";
  const result = await invoke({ action: "exportBills", familyId: "famA", accounts: [] });
  assert.equal(result.success, false);
  assert.match(result.message, /请至少选择 1 个账户/);
});

test("exportBills 不传 categories = 全选，不加分类过滤（含停用分类账单）", async () => {
  // 前端全选时不传 categories；云函数不应加 where.$or，应返回该账本所有未删除账单
  const db = seed();
  openid = "admin";
  // 追加一条"已停用分类"的账单（分类本身不在启用列表，但账单仍在）
  db._rows("bills").push({ _id: "b-disabled", familyId: "famA", type: "expense", amount: 999, date: "2026-08-02 12:00", category1: "停用分类", category2: "停用子项", account: "现金", memberOpenid: "admin", memberId: "m-admin", member: "管理员", merchant: "", remark: "", deleted: false, version: 1 });
  const result = await invoke({ action: "exportBills", familyId: "famA" });
  assert.equal(result.success, true);
  assert.equal(result.count, 3, "不传 categories 应返回全部 3 条（含停用分类账单）");
  assert.equal(result.expenseCount, 2);
  assert.equal(result.incomeCount, 1);
});

test("exportBills 多选分类：空数组 → throw", async () => {
  seed();
  openid = "admin";
  const result = await invoke({ action: "exportBills", familyId: "famA", categories: [] });
  assert.equal(result.success, false);
  assert.match(result.message, /请至少选择 1 个分类/);
});

test("exportBills 5000 条上限：超量 throw 候选 3 提示", async () => {
  const extra = [];
  for (let i = 0; i < 5001; i++) {
    extra.push({ _id: "b" + i, familyId: "famA", type: "expense", amount: 100, date: "2026-08-01 12:00", category1: "餐饮", category2: "午餐", account: "现金", memberOpenid: "admin", memberId: "m-admin", member: "管理员", merchant: "", remark: "", deleted: false, version: 1 });
  }
  seed({ bills: extra });
  openid = "admin";
  const result = await invoke({ action: "exportBills", familyId: "famA" });
  assert.equal(result.success, false);
  assert.match(result.message, /当前筛选匹配 5003 条/);
  assert.match(result.message, /单次最多 5000 条/);
  assert.match(result.message, /缩小时间范围/);
  assert.match(result.message, /减少选中的分类\/账户\/成员/);
});

test("exportBills 5000 条边界：正好 5000 条成功", async () => {
  const extra = [];
  for (let i = 0; i < 4998; i++) {
    extra.push({ _id: "b" + i, familyId: "famA", type: "expense", amount: 100, date: "2026-08-01 12:00", category1: "餐饮", category2: "午餐", account: "现金", memberOpenid: "admin", memberId: "m-admin", member: "管理员", merchant: "", remark: "", deleted: false, version: 1 });
  }
  seed({ bills: extra });
  openid = "admin";
  const result = await invoke({ action: "exportBills", familyId: "famA" });
  assert.equal(result.success, true);
  assert.equal(result.count, 5000);
});

test("exportBills 多 sheet：支出/收入分 2 sheet 上传", async () => {
  seed();
  openid = "admin";
  lastUpload = null;
  const result = await invoke({ action: "exportBills", familyId: "famA" });
  assert.equal(result.success, true);
  assert.equal(result.expenseCount, 1);
  assert.equal(result.incomeCount, 1);
  // 注：xlsx 是桩，不验证 sheet 内容（已由 fakeXlsx.book_append_sheet 接收）
  assert.ok(lastUpload);
  assert.match(lastUpload.cloudPath, /^exports\/famA-\d+\.xlsx$/);
});
