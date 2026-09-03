// 家庭记账本 · accountingFunctions 权限/并发/隔离 契约测试（内存假数据库）
// 运行：node --test scripts/test-contract.js
const { test, before } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("module");
const { makeCloud } = require("./fake-db");

let openid = "";
let db;
const originalLoad = Module._load;
const fakeCloud = makeCloud(() => openid);
fakeCloud.getWXContext = () => ({ OPENID: openid });
const uploadedFiles = [];
fakeCloud.uploadFile = ({ cloudPath, fileContent }) => {
  uploadedFiles.push({ cloudPath, fileContent });
  return Promise.resolve({ fileID: "exports/" + cloudPath.split("/").pop() });
};
fakeCloud.getTempFileURL = ({ fileList }) => Promise.resolve({ fileList: fileList.map((fileID) => ({ fileID, tempFileURL: "https://example.com/" + fileID })) });
const fakeXlsx = {
  read: () => ({}),
  utils: {
    json_to_sheet: () => ({}),
    book_new: () => ({ Sheets: {}, SheetNames: [] }),
    book_append_sheet: (wb, sheet, name) => { wb.Sheets[name] = sheet; wb.SheetNames.push(name); },
    sheet_to_json: () => []
  },
  write: () => Buffer.from("xlsx-stub")
};
Module._load = function (request, parent, isMain) {
  if (request === "wx-server-sdk") return fakeCloud;
  if (request === "xlsx") return fakeXlsx;
  return originalLoad.apply(this, arguments);
};
const m = require("../cloudfunctions/accountingFunctions/index.js");

function seed() {
  db = fakeCloud.database();
  db.collections = {};
  db._seq = 0;
  const famA = { _id: "famA", name: "家庭A", status: "active" };
  const famB = { _id: "famB", name: "家庭B", status: "active" };
  db._rows("families").push(
    famA, famB
  );
  db._rows("family_members").push(
    { _id: "m-admin", familyId: "famA", openid: "admin", nickName: "管理员", role: "admin", status: "active" },
    { _id: "m-member", familyId: "famA", openid: "member", nickName: "成员", role: "member", status: "active" },
    { _id: "m-outsider", familyId: "famB", openid: "outsider", nickName: "外人", role: "member", status: "active" }
  );
  db._rows("categories").push(
    { _id: "c-eat", familyId: "famA", name: "餐饮", type: "expense", parentId: null, enabled: true },
    { _id: "c-lunch", familyId: "famA", name: "午餐", type: "expense", parentId: "c-eat", enabled: true },
    { _id: "c-salary", familyId: "famA", name: "工资", type: "income", parentId: null, enabled: true },
    { _id: "c-base", familyId: "famA", name: "底薪", type: "income", parentId: "c-salary", enabled: true }
  );
  db._rows("accounts").push(
    { _id: "acc-cash", familyId: "famA", name: "现金", enabled: true }
  );
  db._rows("bills").push(
    { _id: "bill-member", familyId: "famA", type: "expense", amount: 1000, category1: "餐饮", category1Icon: "🍜", category2: "午餐", category2Icon: "🍱", account: "现金", date: "2026-08-13 12:00", memberOpenid: "member", memberId: "m-member", member: "成员", creatorOpenId: "member", deleted: false, version: 1 },
    { _id: "bill-admin", familyId: "famA", type: "expense", amount: 2000, category1: "餐饮", category1Icon: "🍜", category2: "午餐", category2Icon: "🍱", account: "现金", date: "2026-08-13 12:00", memberOpenid: "admin", memberId: "m-admin", member: "管理员", creatorOpenId: "admin", deleted: false, version: 1 },
    { _id: "bill-famb", familyId: "famB", type: "expense", amount: 3000, category1: "x", category1Icon: "x", category2: "y", category2Icon: "y", account: "a", date: "2026-08-13 12:00", memberOpenid: "outsider", memberId: "m-outsider", member: "外人", creatorOpenId: "outsider", deleted: false, version: 1 }
  );
}

const invoke = (event) => m.main(event);

before(() => { seed(); });

test("createBill 普通成员只能为自己记账（管理员代记被拒）", async () => {
  seed();
  openid = "member";
  const result = await invoke({ action: "createBill", familyId: "famA", type: "expense", amount: "1.00", category1: "餐饮", category2: "午餐", date: "2026-08-13 12:00", account: "现金", memberId: "m-admin" });
  assert.equal(result.success, false);
  assert.match(result.message, /普通成员只能为自己记账/);
});

test("createBill 成员为自己记账成功", async () => {
  seed();
  openid = "member";
  const result = await invoke({ action: "createBill", familyId: "famA", type: "expense", amount: "1.00", category1: "餐饮", category2: "午餐", date: "2026-08-13 12:00", account: "现金", memberId: "m-member" });
  assert.equal(result.success, true);
  assert.ok(result.billId);
});

test("updateBill 普通成员无权编辑他人账单", async () => {
  seed();
  openid = "member";
  const result = await invoke({ action: "updateBill", familyId: "famA", billId: "bill-admin", version: 1, amount: "9.00" });
  assert.equal(result.success, false);
  assert.match(result.message, /无权编辑该账单/);
});

test("updateBill 版本冲突拒绝覆盖", async () => {
  seed();
  openid = "admin";
  // 版本应为 1，传入错误版本
  const result = await invoke({ action: "updateBill", familyId: "famA", billId: "bill-admin", version: 5, amount: "9.00" });
  assert.equal(result.success, false);
  assert.match(result.message, /账单已被修改/);
});

test("updateBill 管理员可编辑任意账单并自增版本", async () => {
  seed();
  openid = "admin";
  const result = await invoke({ action: "updateBill", familyId: "famA", billId: "bill-member", version: 1, amount: "9.00" });
  assert.equal(result.success, true);
  assert.equal(result.version, 2);
  const bill = db._rows("bills").find((b) => b._id === "bill-member");
  assert.equal(bill.amount, 900);
  assert.equal(bill.version, 2);
});

test("deleteBill 普通成员只能删除自己的账单", async () => {
  seed();
  openid = "member";
  const own = await invoke({ action: "deleteBill", familyId: "famA", billId: "bill-member", version: 1 });
  assert.equal(own.success, true);
  seed();
  openid = "member";
  const other = await invoke({ action: "deleteBill", familyId: "famA", billId: "bill-admin", version: 1 });
  assert.equal(other.success, false);
  assert.match(other.message, /无权删除该账单/);
});

test("getBill 跨账本隔离：成员不能读取其他账本账单", async () => {
  seed();
  openid = "member";
  const result = await invoke({ action: "getBill", familyId: "famB", billId: "bill-famb" });
  assert.equal(result.success, false);
  assert.match(result.message, /你不是该家庭成员|账单不存在/);
});

test("非成员被拒绝写入（伪造 familyId）", async () => {
  seed();
  openid = "outsider";
  const result = await invoke({ action: "createBill", familyId: "famA", type: "expense", amount: "1.00", category1: "餐饮", category2: "午餐", date: "2026-08-13 12:00", account: "现金", memberId: "m-member" });
  assert.equal(result.success, false);
  assert.match(result.message, /你不是该家庭成员/);
});

test("createCategory 仅管理员（普通成员被拒）", async () => {
  seed();
  openid = "member";
  const result = await invoke({ action: "createCategory", familyId: "famA", type: "expense", name: "新分类", icon: "❓" });
  assert.equal(result.success, false);
  assert.match(result.message, /只有管理员/);
});

test("已解散账本成员被拒写", async () => {
  seed();
  db._rows("families").find((f) => f._id === "famA").status = "dissolved";
  openid = "member";
  const result = await invoke({ action: "createBill", familyId: "famA", type: "expense", amount: "1.00", category1: "餐饮", category2: "午餐", date: "2026-08-13 12:00", account: "现金", memberId: "m-member" });
  assert.equal(result.success, false);
  assert.match(result.message, /你不是该家庭成员/);
});

test("listBills 默认按日期倒序分页返回", async () => {
  seed();
  openid = "member";
  const dates = ["2026-08-14 09:00", "2026-08-15 09:00", "2026-08-16 09:00", "2026-08-17 09:00"];
  dates.forEach((date, i) => {
    db._rows("bills").push({
      _id: "bill-page" + i, familyId: "famA", type: "expense", amount: (i + 1) * 100,
      category1: "餐饮", category1Icon: "🍜", category2: "午餐", category2Icon: "🍱",
      account: "现金", date, memberOpenid: "member", memberId: "m-member", member: "成员",
      creatorOpenId: "member", deleted: false, version: 1
    });
  });
  const page1 = await invoke({ action: "listBills", familyId: "famA", limit: 2, offset: 0 });
  assert.equal(page1.success, true);
  assert.equal(page1.bills.length, 2);
  assert.equal(page1.bills[0].date, "2026-08-17 09:00");
  assert.equal(page1.bills[1].date, "2026-08-16 09:00");
  const page2 = await invoke({ action: "listBills", familyId: "famA", limit: 2, offset: 2 });
  assert.equal(page2.success, true);
  assert.equal(page2.bills.length, 2);
  assert.equal(page2.bills[0].date, "2026-08-15 09:00");
  assert.equal(page2.bills[1].date, "2026-08-14 09:00");
});

test("listBills 跨账本非成员被拒", async () => {
  seed();
  openid = "outsider";
  const result = await invoke({ action: "listBills", familyId: "famA", limit: 20, offset: 0 });
  assert.equal(result.success, false);
  assert.match(result.message, /你不是该家庭成员/);
});

test("listBills 支持多选分类、账户、成员和类型", async () => {
  seed();
  openid = "member";
  db._rows("accounts").push({ _id: "acc-bank", familyId: "famA", name: "银行卡", enabled: true });
  const baseBill = { familyId: "famA", category1Icon: "📝", category2Icon: "📝", date: "2026-08-13 12:00", creatorOpenId: "member", deleted: false, version: 1 };
  db._rows("bills").push(
    { _id: "multi-lunch-cash", ...baseBill, type: "expense", amount: 1000, category1: "餐饮", category2: "午餐", account: "现金", memberOpenid: "member", memberId: "m-member", member: "成员" },
    { _id: "multi-salary-bank", ...baseBill, type: "income", amount: 2000, category1: "工资", category2: "底薪", account: "银行卡", memberOpenid: "admin", memberId: "m-admin", member: "管理员" },
    { _id: "multi-lunch-bank", ...baseBill, type: "expense", amount: 3000, category1: "餐饮", category2: "午餐", account: "银行卡", memberOpenid: "admin", memberId: "m-admin", member: "管理员" }
  );

  const byCategory = await invoke({ action: "listBills", familyId: "famA", categories: [{ name: "午餐", type: "expense" }], limit: 20, offset: 0 });
  assert.equal(byCategory.success, true);
  assert.equal(byCategory.bills.some((bill) => bill._id === "multi-salary-bank"), false);
  assert.equal(byCategory.bills.filter((bill) => bill._id.startsWith("multi-")).length, 2);

  const byAccount = await invoke({ action: "listBills", familyId: "famA", accounts: ["银行卡"], limit: 20, offset: 0 });
  assert.deepEqual(byAccount.bills.map((bill) => bill._id).sort(), ["multi-lunch-bank", "multi-salary-bank"]);

  const byMember = await invoke({ action: "listBills", familyId: "famA", memberIds: ["m-admin"], limit: 20, offset: 0 });
  assert.deepEqual(byMember.bills.map((bill) => bill._id).sort(), ["bill-admin", "multi-lunch-bank", "multi-salary-bank"]);

  const byType = await invoke({ action: "listBills", familyId: "famA", types: ["income"], limit: 20, offset: 0 });
  assert.deepEqual(byType.bills.map((bill) => bill._id), ["multi-salary-bank"]);
});

test("listBills 多选条件为空数组时拒绝", async () => {
  seed();
  openid = "member";
  const result = await invoke({ action: "listBills", familyId: "famA", types: [], accounts: [], memberIds: [], categories: [], limit: 20, offset: 0 });
  assert.equal(result.success, false);
  assert.match(result.message, /请至少选择/);
});

test("getStats 月度聚合：支出/收入/结余与分类排行", async () => {
  seed();
  openid = "member";
  db._rows("bills").push({
    _id: "bill-inc", familyId: "famA", type: "income", amount: 5000,
    category1: "工资", category1Icon: "💰", category2: "底薪", category2Icon: "💵",
    account: "现金", date: "2026-08-13 12:00", memberOpenid: "member", memberId: "m-member", member: "成员",
    creatorOpenId: "member", deleted: false, version: 1
  });
  const result = await invoke({ action: "getStats", familyId: "famA", month: "2026-08" });
  assert.equal(result.success, true);
  assert.equal(result.totalExpense, 30.0);
  assert.equal(result.totalIncome, 50.0);
  assert.equal(result.balance, 20.0);
  assert.equal(result.expenseCategoryStats[0].name, "午餐");
  assert.equal(result.expenseCategoryStats[0].amount, 30.0);
});

test("getStats 当前月默认排除未来账单", async () => {
  seed();
  openid = "member";
  db._rows("bills").push({
    _id: "bill-future", familyId: "famA", type: "expense", amount: 9999,
    category1: "餐饮", category1Icon: "🍜", category2: "午餐", category2Icon: "🍱",
    account: "现金", date: "2099-08-20 12:00", memberOpenid: "member", memberId: "m-member", member: "成员",
    creatorOpenId: "member", deleted: false, version: 1
  });
  const result = await invoke({ action: "getStats", familyId: "famA", month: "2026-08" });


test("getStats allTime 不过滤日期", async () => {
  seed();
  openid = "member";
  db._rows("bills").push({
    _id: "bill-historic", familyId: "famA", type: "expense", amount: 1234,
    category1: "餐饮", category1Icon: "🍜", category2: "午餐", category2Icon: "🍱",
    account: "现金", date: "2020-01-15 12:00", memberOpenid: "member", memberId: "m-member", member: "成员",
    creatorOpenId: "member", deleted: false, version: 1
  });
  const result = await invoke({ action: "getStats", familyId: "famA", allTime: true });
  assert.equal(result.success, true);
  assert.ok(result.totalExpense >= 12.34, "全部时间应包含 2020 年的历史账单");
  // 总额应等于 dailyTrend 之和（拆分 aggregate 后保持一致）
  const trendTotal = (result.dailyTrend || []).reduce((s, x) => s + Number(x.expense || 0) + Number(x.income || 0), 0);
  assert.equal(Number(result.totalExpense) + Number(result.totalIncome), trendTotal, "分类/日期两条 aggregate 的总额必须一致");
  // 分类排行之和也应等于总额
  const categoryTotal = (result.expenseCategoryStats || []).reduce((s, x) => s + Number(x.amount || 0), 0)
    + (result.incomeCategoryStats || []).reduce((s, x) => s + Number(x.amount || 0), 0);
  assert.equal(categoryTotal, Number(result.totalExpense) + Number(result.totalIncome), "分类聚合总额必须等于总额");
});
  assert.equal(result.success, true);
  assert.equal(result.totalExpense, 30.0);
});

test("searchBills 覆盖全部账单并匹配备注/商家", async () => {
  seed();
  openid = "member";
  db._rows("bills").push({
    _id: "bill-hist", familyId: "famA", type: "expense", amount: 8888,
    category1: "购物", category1Icon: "🛒", category2: "日用品", category2Icon: "🧴",
    account: "现金", date: "2026-06-01 12:00", memberOpenid: "member", memberId: "m-member", member: "成员",
    creatorOpenId: "member", deleted: false, version: 1, remark: "超市购物"
  });
  const result = await invoke({ action: "searchBills", familyId: "famA", keyword: "超市" });
  assert.equal(result.success, true);
  assert.ok(result.bills.some((b) => b._id === "bill-hist"), "历史账单应被搜索到");
});

test("exportBills 仅管理员可导出且生成下载链接", async () => {
  seed();
  openid = "member";
  const denied = await invoke({ action: "exportBills", familyId: "famA" });
  assert.equal(denied.success, false);
  assert.match(denied.message, /只有管理员/);
  seed();
  openid = "admin";
  const result = await invoke({ action: "exportBills", familyId: "famA" });
  assert.equal(result.success, true);
  assert.equal(result.count, 2);
  assert.ok(result.fileID && result.fileID.length > 0);
});

test("exportBills 支持类型筛选", async () => {
  seed();
  openid = "admin";
  const result = await invoke({ action: "exportBills", familyId: "famA", type: "income" });
  assert.equal(result.success, true);
  assert.equal(result.count, 0);
});

test("预算：保存/读取/删除与权限限制", async () => {
  seed();
  openid = "member";
  const denied = await invoke({ action: "saveBudget", familyId: "famA", month: "2026-08", amount: "5000" });
  assert.equal(denied.success, false);
  assert.match(denied.message, /只有管理员/);
  seed();
  openid = "admin";
  const saved = await invoke({ action: "saveBudget", familyId: "famA", month: "2026-08", amount: "5000" });
  assert.equal(saved.success, true);
  const got = await invoke({ action: "getBudget", familyId: "famA", month: "2026-08" });
  assert.equal(got.success, true);
  assert.equal(got.budget.amount, 500000);
  const del = await invoke({ action: "deleteBudget", familyId: "famA", month: "2026-08" });
  assert.equal(del.success, true);
  const after = await invoke({ action: "getBudget", familyId: "famA", month: "2026-08" });
  assert.equal(after.budget, null);
});

test("listOperationLogs 仅管理员可读", async () => {
  seed();
  openid = "member";
  const denied = await invoke({ action: "listOperationLogs", familyId: "famA" });
  assert.equal(denied.success, false);
  assert.match(denied.message, /只有管理员/);
  seed();
  openid = "admin";
  const result = await invoke({ action: "listOperationLogs", familyId: "famA" });
  assert.equal(result.success, true);
  assert.ok(Array.isArray(result.logs));
});

// 锁死 fake-db 的 aggregate() / .and() 链式桩，避免未来回归
test("fake-db aggregate() 链式：match + group + sum", () => {
  const { makeCloud } = require("./fake-db");
  const cloud = makeCloud(() => "tester");
  const db = cloud.database();
  db._rows("bills").push(
    { _id: "b1", amount: 100, type: "expense", category2: "午餐", date: "2026-08-13 12:00" },
    { _id: "b2", amount: 200, type: "expense", category2: "午餐", date: "2026-08-13 18:00" },
    { _id: "b3", amount: 500, type: "income", category2: "工资", date: "2026-08-15 09:00" }
  );
  return db.collection("bills").aggregate()
    .match({ type: "expense" })
    .group({ _id: "$category2", amount: db.command.aggregate.sum("$amount") })
    .end()
    .then((res) => {
      assert.equal(res.list.length, 1);
      assert.equal(res.list[0]._id, "午餐");
      assert.equal(res.list[0].amount, 300);
    });
});

test("fake-db aggregate() 支持 substr 表达式", () => {
  const { makeCloud } = require("./fake-db");
  const cloud = makeCloud(() => "tester");
  const db = cloud.database();
  db._rows("bills").push(
    { _id: "b1", amount: 100, type: "expense", date: "2026-08-13 12:00" },
    { _id: "b2", amount: 200, type: "expense", date: "2026-08-14 12:00" }
  );
  return db.collection("bills").aggregate()
    .group({
      _id: { day: db.command.aggregate.substr(["$date", 0, 10]) },
      amount: db.command.aggregate.sum("$amount")
    })
    .end()
    .then((res) => {
      assert.equal(res.list.length, 2);
      const days = res.list.map((r) => r._id.day).sort();
      assert.deepEqual(days, ["2026-08-13", "2026-08-14"]);
    });
});

test("fake-db and() 支持链式（gte().and().and()）", () => {
  const { matchValue } = require("./fake-db");
  const cmd = require("./fake-db").makeCloud(() => "x").command;
  const cond = cmd.gte("2026-08-01").and(cmd.lt("2026-09-01")).and(cmd.lte("2026-08-31 23:59"));
  assert.equal(matchValue("2026-08-13 12:00", cond), true);
  assert.equal(matchValue("2026-09-01 00:00", cond), false);
});

test("saveBillPreferences/read 在历史随机 id 文档并存时仍收敛到确定性主档", async () => {
  seed();
  openid = "admin";
  // 历史遗留：随机 id 文档持有旧值，且与新格式并存
  db._rows("bill_preferences").push(
    { _id: "legacy-random", familyId: "famA", openid: "admin", expenseCategory: { category1: "居住", category2: "其他" }, incomeCategory: null, account: "银行卡" }
  );
  const saved = await invoke({ action: "saveBillPreferences", familyId: "famA", expenseCategory: { category1: "餐饮", category2: "午餐" }, incomeCategory: { category1: "红包", category2: "拼手气" }, account: "微信" });
  assert.equal(saved.success, true);
  const read = await invoke({ action: "getBillPreferences", familyId: "famA" });
  assert.deepEqual(read.preferences, {
    expenseCategory: { category1: "餐饮", category2: "午餐" },
    incomeCategory: { category1: "红包", category2: "拼手气" },
    account: "微信"
  });
});

test("getBillPreferences 无主档时从历史随机 id 文档迁移并读取", async () => {
  seed();
  openid = "member";
  db._rows("bill_preferences").push(
    { _id: "legacy-old", familyId: "famA", openid: "member", expenseCategory: null, incomeCategory: { category1: "工资", category2: "底薪" }, account: "零钱" }
  );
  const read = await invoke({ action: "getBillPreferences", familyId: "famA" });
  assert.equal(read.success, true);
  assert.deepEqual(read.preferences, {
    expenseCategory: null,
    incomeCategory: { category1: "工资", category2: "底薪" },
    account: "零钱"
  });
  // 迁移后主档已建立：再保存一次应写同一主档
  const saved = await invoke({ action: "saveBillPreferences", familyId: "famA", incomeCategory: { category1: "红包", category2: "拼手气" }, account: "微信" });
  assert.equal(saved.success, true);
  const again = await invoke({ action: "getBillPreferences", familyId: "famA" });
  assert.deepEqual(again.preferences, {
    expenseCategory: null,
    incomeCategory: { category1: "红包", category2: "拼手气" },
    account: "微信"
  });
});
