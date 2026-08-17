// 家庭记账本 · 导入（preview/confirm/rollback）契约测试（内存假数据库 + xlsx 桩）
// 运行：node --test scripts/test-import.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("module");
const { makeCloud } = require("./fake-db");

let openid = "";
let stubRows = [];
let sheetNames = ["支出"];
const originalLoad = Module._load;
const fakeCloud = makeCloud(() => openid);
fakeCloud.getWXContext = () => ({ OPENID: openid });
fakeCloud.downloadFile = () => Promise.resolve({ fileContent: Buffer.from("stub") });
const fakeXlsx = {
  read() { return { SheetNames: sheetNames, Sheets: Object.fromEntries(sheetNames.map((n) => [n, {}])) }; },
  utils: { sheet_to_json() { return stubRows; } }
};
Module._load = function (request, parent, isMain) {
  if (request === "wx-server-sdk") return fakeCloud;
  if (request === "xlsx") return fakeXlsx;
  return originalLoad.apply(this, arguments);
};
const m = require("../cloudfunctions/accountingFunctions/index.js");

function seed() {
  const db = fakeCloud.database();
  db.collections = {};
  db._seq = 0;
  db.collection("families").doc("famA").set({ data: { name: "家庭A", status: "active" } });
  db._rows("family_members").push(
    { _id: "m-admin", familyId: "famA", openid: "admin", nickName: "管理员", role: "admin", status: "active" },
    { _id: "m-member", familyId: "famA", openid: "member", nickName: "成员", role: "member", status: "active" }
  );
  return db;
}

const invoke = (event) => m.main(event);
const row = (over = {}) => Object.assign({
  交易类型: "支出", 日期: "2026-08-01 12:00", 一级分类: "餐饮", 二级分类: "午餐",
  "支出账户/收入账户": "现金", 金额: "20.00", 成员: "成员", 商家: "食堂", 备注: "午饭"
}, over);

test("previewImport 成功并给出成员映射", async () => {
  seed(); openid = "admin"; stubRows = [row()];
  const result = await invoke({ action: "previewImport", familyId: "famA", fileID: "file1" });
  assert.equal(result.success, true);
  assert.equal(result.total, 1);
  assert.ok(result.memberMappings.some((x) => x.sourceName === "成员" && x.matched === true));
});

test("previewImport 拒绝无效日期/金额", async () => {
  seed(); openid = "admin";
  stubRows = [row({ 金额: "abc" })];
  const result = await invoke({ action: "previewImport", familyId: "famA", fileID: "file1" });
  assert.equal(result.success, false);
  assert.match(result.message, /日期或金额无效/);
});

test("confirmImport 非管理员被拒", async () => {
  seed(); openid = "member"; stubRows = [row()];
  const result = await invoke({ action: "confirmImport", familyId: "famA", fileID: "file1" });
  assert.equal(result.success, false);
  assert.match(result.message, /只有管理员/);
});

test("confirmImport 成功并自动创建缺失分类/账户", async () => {
  seed(); openid = "admin"; stubRows = [row()];
  const result = await invoke({ action: "confirmImport", familyId: "famA", fileID: "file1" });
  assert.equal(result.success, true);
  assert.equal(result.imported, 1);
  const db = fakeCloud.database();
  const bills = db._rows("bills").filter((b) => b.familyId === "famA" && !b.deleted);
  assert.equal(bills.length, 1);
  assert.equal(bills[0].amount, 2000);
  assert.ok(db._rows("categories").some((c) => c.name === "餐饮"), "应自动创建一级分类");
  assert.ok(db._rows("accounts").some((a) => a.name === "现金"), "应自动创建账户");
});

test("confirmImport 重复导入按指纹跳过（去重）", async () => {
  seed(); openid = "admin"; stubRows = [row()];
  await invoke({ action: "confirmImport", familyId: "famA", fileID: "file1" });
  const again = await invoke({ action: "confirmImport", familyId: "famA", fileID: "file1" });
  assert.equal(again.success, true);
  assert.equal(again.imported, 0);
  const db = fakeCloud.database();
  assert.equal(db._rows("bills").filter((b) => b.familyId === "famA" && !b.deleted).length, 1);
});

test("rollbackImport 仅删除该批次并清理自动创建的分类/账户", async () => {
  seed(); openid = "admin"; stubRows = [row()];
  const imported = await invoke({ action: "confirmImport", familyId: "famA", fileID: "file1" });
  assert.ok(imported.success);
  const rollback = await invoke({ action: "rollbackImport", familyId: "famA", batchId: imported.batchId });
  assert.equal(rollback.success, true);
  assert.equal(rollback.removed, 1);
  const db = fakeCloud.database();
  assert.equal(db._rows("bills").filter((b) => b.familyId === "famA" && !b.deleted).length, 0);
  assert.equal(db._rows("categories").filter((c) => c.createdByImportBatchId === imported.batchId).length, 0);
  assert.equal(db._rows("accounts").filter((a) => a.createdByImportBatchId === imported.batchId).length, 0);
});

test("confirmImport 中途失败保留 batchId 与已导入数供回滚", async () => {
  seed(); openid = "admin";
  stubRows = [row(), row({ 金额: "30.00", 备注: "第二笔" })];
  const db = fakeCloud.database();
  const origCollection = db.collection.bind(db);
  let billAdds = 0;
  db.collection = (name) => {
    const chain = origCollection(name);
    if (name === "bills") {
      const origAdd = chain.add.bind(chain);
      chain.add = async (arg) => {
        billAdds += 1;
        if (billAdds === 2) { const e = new Error("模拟数据库中断"); e.code = -1; throw e; }
        return origAdd(arg);
      };
    }
    return chain;
  };
  const result = await invoke({ action: "confirmImport", familyId: "famA", fileID: "file1" });
  assert.equal(result.success, false);
  assert.ok(result.batchId, "中途失败应保留 batchId");
  assert.equal(result.imported, 1, "应报告已写入的账单数");
  const activeBills = db._rows("bills").filter((b) => b.familyId === "famA" && !b.deleted);
  assert.equal(activeBills.length, 1, "应只写入成功的那条");
  const rollback = await invoke({ action: "rollbackImport", familyId: "famA", batchId: result.batchId });
  assert.equal(rollback.success, true);
  assert.equal(rollback.removed, 1, "半导入批次应可回滚");
});
