// 家庭记账本 · 云函数纯逻辑单元测试（无需云端环境）
// 运行：node --test scripts/test-pure.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("module");

// 用桩替代云端依赖，使云函数模块可在本地加载
const originalLoad = Module._load;
const fakeCloud = {
  DYNAMIC_CURRENT_ENV: "test",
  init() {},
  database() { return {}; },
  getWXContext() { return { OPENID: "openid-test" }; },
  command: { gte: (x) => ({ gte: x }), lte: (x) => ({ lte: x }), in: (x) => ({ in: x }), and: (...args) => args },
  getTempFileURL() {},
  downloadFile() {}
};
Module._load = function (request, parent, isMain) {
  if (request === "wx-server-sdk") return fakeCloud;
  if (request === "xlsx") return { read: () => ({}) };
  return originalLoad.apply(this, arguments);
};

const m = require("../cloudfunctions/accountingFunctions/index.js");
const T = m.testUtils;

test("parseAmountCents 合法金额", () => {
  assert.equal(T.parseAmountCents("1.23"), 123);
  assert.equal(T.parseAmountCents("0.01"), 1);
  assert.equal(T.parseAmountCents("9"), 900);
  assert.equal(T.parseAmountCents("9999999.99"), 999999999);
  assert.equal(T.parseAmountCents(5), 500);
});

test("parseAmountCents 拒绝非法/越界/零金额", () => {
  for (const bad of ["", "abc", "1.234", "-5", "0", "0.00", "9999999.999", "10000000"]) {
    assert.throws(() => T.parseAmountCents(bad), undefined, `应拒绝：${bad}`);
  }
});

test("parseOptionalAmountCents 允许空值与 0", () => {
  assert.equal(T.parseOptionalAmountCents("", "金额"), null);
  assert.equal(T.parseOptionalAmountCents(undefined, "金额"), null);
  assert.equal(T.parseOptionalAmountCents("0", "金额"), 0);
  assert.equal(T.parseOptionalAmountCents("12.5", "金额"), 1250);
  assert.throws(() => T.parseOptionalAmountCents("12.345", "金额"));
});

test("validateDateTime 合法时间", () => {
  assert.equal(T.validateDateTime("2026-02-28 23:59"), "2026-02-28 23:59");
  assert.equal(T.validateDateTime("2026-12-31 00:00"), "2026-12-31 00:00");
});

test("validateDateTime 拒绝非法日期与时间", () => {
  for (const bad of ["2026-02-30 10:00", "2026-13-01 10:00", "2026-02-28 25:00", "2026-02-28 10:60", "2026/02/28 10:00", "2026-02-28", "2026-02-28 1000"]) {
    assert.throws(() => T.validateDateTime(bad), undefined, `应拒绝：${bad}`);
  }
});

test("getMonthBounds 月份边界（含跨年）", () => {
  assert.deepEqual(T.getMonthBounds("2026-02"), { start: "2026-02-01 00:00", end: "2026-03-01 00:00" });
  assert.deepEqual(T.getMonthBounds("2026-12"), { start: "2026-12-01 00:00", end: "2027-01-01 00:00" });
  assert.throws(() => T.getMonthBounds("2026-13"));
  assert.throws(() => T.getMonthBounds("2026"));
});

test("getShanghaiDate 上海时区跨日", () => {
  // UTC 2026-08-12 18:00 = 上海 2026-08-13 02:00
  const d = new Date(Date.UTC(2026, 7, 12, 18, 0));
  assert.equal(T.getShanghaiDate(d), "2026-08-13");
  // UTC 2026-08-12 15:59 = 上海 2026-08-12 23:59
  const e = new Date(Date.UTC(2026, 7, 12, 15, 59));
  assert.equal(T.getShanghaiDate(e), "2026-08-12");
});

test("normalizeText 去除首尾空格并截断", () => {
  assert.equal(T.normalizeText("  你好  ", 10), "你好");
  assert.equal(T.normalizeText("一二三四五六", 3), "一二三四五六".slice(0, 3));
});

test("normalizeName 不区分大小写并去空格", () => {
  assert.equal(T.normalizeName("  Alice  "), "alice");
  assert.equal(T.normalizeName("张三"), "张三");
});

test("getStableDocumentId 确定性且长度稳定", () => {
  assert.equal(T.getStableDocumentId("a", "b"), T.getStableDocumentId("a", "b"));
  assert.notEqual(T.getStableDocumentId("a", "b"), T.getStableDocumentId("a", "c"));
  assert.equal(T.getStableDocumentId("a", "b").length, 24);
});

test("compareMembership 优先 active -> admin -> 稳定 ID", () => {
  const stableId = T.getStableMembershipId("fam", "u1");
  const base = { familyId: "fam", openid: "u1", _id: stableId, role: "member", status: "active", joinedAt: 100 };
  const active = { ...base };
  const inactive = { ...base, status: "cancelled" };
  const admin = { ...base, role: "admin" };
  const randomId = { ...base, _id: "random" };
  // 排序后 active 应在 inactive 之前（返回负表示 left 优先）
  assert.ok(T.compareMembership(active, inactive) < 0);
  assert.ok(T.compareMembership(admin, active) < 0);
  assert.ok(T.compareMembership(randomId, active) > 0);
});

test("resolveImportedMember 唯一昵称匹配 / 重复归管理员 / 未匹配", () => {
  const fallback = { nickName: "管理员", openid: "o-admin" };
  const members = [
    { nickName: "小明", openid: "o1" },
    { nickName: "小红", openid: "o2" }
  ];
  assert.deepEqual(T.resolveImportedMember(members, "小明", fallback), { member: members[0], matched: true, ambiguous: false });
  const ambiguous = T.resolveImportedMember([...members, { nickName: "小明", openid: "o3" }], "小明", fallback);
  assert.equal(ambiguous.matched, false);
  assert.equal(ambiguous.ambiguous, true);
  assert.equal(ambiguous.member, fallback);
  const none = T.resolveImportedMember(members, "不存在", fallback);
  assert.equal(none.matched, false);
  assert.equal(none.ambiguous, false);
  assert.equal(none.member, fallback);
});
