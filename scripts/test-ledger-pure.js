// 家庭记账本 · ledgerFunctions 纯逻辑单元测试（无需云端环境）
// 运行：node --test scripts/test-ledger-pure.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("module");

const originalLoad = Module._load;
const fakeCloud = {
  DYNAMIC_CURRENT_ENV: "test",
  init() {},
  database() { return { command: {} }; },
  getWXContext() { return { OPENID: "openid-test" }; },
  getTempFileURL() {},
  downloadFile() {}
};
Module._load = function (request, parent, isMain) {
  if (request === "wx-server-sdk") return fakeCloud;
  return originalLoad.apply(this, arguments);
};

const m = require("../cloudfunctions/ledgerFunctions/index.js");
const T = m.testUtils;

test("getStableUserId / getStableMembershipId 确定性且长度稳定", () => {
  assert.equal(T.getStableUserId("openid-a"), T.getStableUserId("openid-a"));
  assert.notEqual(T.getStableUserId("openid-a"), T.getStableUserId("openid-b"));
  assert.equal(T.getStableUserId("openid-a").length, 24);
  assert.equal(T.getStableMembershipId("fam", "u"), T.getStableMembershipId("fam", "u"));
  assert.notEqual(T.getStableMembershipId("fam", "u"), T.getStableMembershipId("fam2", "u"));
});

test("normalizeName 去空格并转小写", () => {
  assert.equal(T.normalizeName("  Alice  "), "alice");
  assert.equal(T.normalizeName("张三"), "张三");
});

test("computeDefaultFamilyName 无重名时使用默认名", () => {
  assert.equal(T.computeDefaultFamilyName([]), "我的家庭账本");
  assert.equal(T.computeDefaultFamilyName(new Set()), "我的家庭账本");
});

test("computeDefaultFamilyName 依次递增后缀且忽略大小写", () => {
  assert.equal(T.computeDefaultFamilyName(["我的家庭账本"]), "我的家庭账本 2");
  assert.equal(T.computeDefaultFamilyName(["我的家庭账本", "我的家庭账本 2"]), "我的家庭账本 3");
  // 大小写不敏感、首尾空格忽略
  assert.equal(T.computeDefaultFamilyName(["  我的家庭账本  "]), "我的家庭账本 2");
  assert.equal(T.computeDefaultFamilyName(["我的家庭账本", "我的家庭账本 2", "我的家庭账本 3"]), "我的家庭账本 4");
});

test("generateInviteCode 格式正确且排除易混淆字符", () => {
  const pattern = /^[A-HJ-NP-Z2-9]{8}$/;
  for (let i = 0; i < 200; i += 1) {
    const code = T.generateInviteCode();
    assert.match(code, pattern, `非法邀请码：${code}`);
    assert.equal(code.length, 8);
  }
});

test("compareMembership 排序优先级", () => {
  const stableId = T.getStableMembershipId("fam", "u1");
  const base = { familyId: "fam", openid: "u1", _id: stableId, role: "member", status: "active", joinedAt: 100 };
  const active = { ...base };
  const inactive = { ...base, status: "cancelled" };
  const admin = { ...base, role: "admin" };
  const randomId = { ...base, _id: "random" };
  assert.ok(T.compareMembership(active, inactive) < 0);
  assert.ok(T.compareMembership(admin, active) < 0);
  assert.ok(T.compareMembership(randomId, active) > 0);
});

test("sanitizeAvatarUrl 仅允许 cloud/https 且限长", () => {
  assert.equal(T.sanitizeAvatarUrl("https://cdn.example.com/a.png"), "https://cdn.example.com/a.png");
  assert.equal(T.sanitizeAvatarUrl("cloud://bucket-env/avatar/a.png"), "cloud://bucket-env/avatar/a.png");
  assert.equal(T.sanitizeAvatarUrl(""), "");
  assert.equal(T.sanitizeAvatarUrl(undefined), "");
  assert.equal(T.sanitizeAvatarUrl("  https://img.example.com/x.png  "), "https://img.example.com/x.png");
  assert.equal(T.sanitizeAvatarUrl("javascript:alert(1)"), "");
  assert.equal(T.sanitizeAvatarUrl("http://cdn.example.com/a.png"), "");
  assert.equal(T.sanitizeAvatarUrl("data:image/png;base64,xxxx"), "");
  assert.equal(T.sanitizeAvatarUrl("a".repeat(513)), "");
});

test("invite 限流：每分钟 12 次内放行，第 13 次拒绝", async () => {
  const { FakeDB } = require("./fake-db");
  const rateDb = new FakeDB();
  await rateDb.createCollection("rate_limits");
  for (let i = 0; i < 12; i += 1) {
    await T.assertInviteRateLimit({ dbOverride: rateDb });
  }
  await assert.rejects(() => T.assertInviteRateLimit({ dbOverride: rateDb }), /操作过于频繁/);
});

test("isTimerTrigger 防伪造：无身份定时任务放行、用户请求拒绝", () => {
  assert.equal(T.isTimerTrigger({ TriggerName: "dailyReminder" }, ""), true);
  assert.equal(T.isTimerTrigger({ TriggerName: "dailyPurge" }, ""), true);
  assert.equal(T.isTimerTrigger({ TriggerName: "dailyReminder" }, "openid-user"), false);
  assert.equal(T.isTimerTrigger({ TriggerName: "dailyReminder", action: "verifyInvite" }, ""), false);
  assert.equal(T.isTimerTrigger({ TriggerName: "dailyReminder", type: "verifyInvite" }, ""), false);
  assert.equal(T.isTimerTrigger({ action: "verifyInvite" }, ""), false);
  assert.equal(T.isTimerTrigger({ type: "verifyInvite", TriggerName: "x" }, "openid-user"), false);
  assert.equal(T.isTimerTrigger(null, ""), false);
});

test("toClientErrorMessage 仅暴露业务中文", () => {
  assert.equal(T.toClientErrorMessage(new Error("请输入邀请码")), "请输入邀请码");
  assert.equal(T.toClientErrorMessage(new Error("该家庭已解散")), "该家庭已解散");
  assert.equal(T.toClientErrorMessage(new Error("connection reset by peer")), "服务器开小差了，请稍后重试");
  assert.equal(T.toClientErrorMessage(new Error("请求超时 timeout")), "服务器开小差了，请稍后重试");
  assert.equal(T.toClientErrorMessage(new Error()), "服务器错误");
  const exposed = new Error("额度已用完");
  exposed.expose = true;
  assert.equal(T.toClientErrorMessage(exposed), "额度已用完");
});
