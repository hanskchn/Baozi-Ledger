// 家庭记账本 · ledgerFunctions 邀请/成员/管理员 契约测试（内存假数据库）
// 运行：node --test scripts/test-ledger-contract.js
const { test, before } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("module");
const { makeCloud } = require("./fake-db");

let openid = "";
const originalLoad = Module._load;
const fakeCloud = makeCloud(() => openid);
fakeCloud.getWXContext = () => ({ OPENID: openid });
Module._load = function (request, parent, isMain) {
  if (request === "wx-server-sdk") return fakeCloud;
  if (request === "xlsx") return { read: () => ({}) };
  return originalLoad.apply(this, arguments);
};
const m = require("../cloudfunctions/ledgerFunctions/index.js");
const T = m.testUtils;

const FUTURE = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
const PAST = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

function seed({ members = 1, inviteExpiresAt = FUTURE } = {}) {
  const db = fakeCloud.database();
  db.collections = {};
  db._seq = 0;
  db.collection("families").doc("famA").set({ data: { name: "家庭A", adminOpenid: "admin", status: "active", activeMemberCount: 0, membershipRevision: 1 } });
  db.collection("families").doc("famA").set({ data: { name: "家庭A", adminOpenid: "admin", status: "active", activeMemberCount: 0, membershipRevision: 1 } });
  db._rows("family_members").push({ _id: "m-admin", familyId: "famA", openid: "admin", nickName: "管理员", role: "admin", status: "active", joinedAt: new Date() });
  if (members >= 1) db._rows("family_members").push({ _id: "m-member", familyId: "famA", openid: "member", nickName: "成员", role: "member", status: "active", joinedAt: new Date() });
  for (let i = 2; i < members; i += 1) {
    db._rows("family_members").push({ _id: "m-extra-" + i, familyId: "famA", openid: "extra" + i, nickName: "成员" + i, role: "member", status: "active", joinedAt: new Date() });
  }
  db.collection("family_invites").add({ data: { familyId: "famA", code: "ABCD2345", status: "active", createdAt: new Date(), expiresAt: inviteExpiresAt } });
  return db;
}

const invoke = (event) => m.main(event);

// 注销意图需服务端 users 文档（目标1 安全语义：forceLastFamily 只认服务端意图）
const seedUsers = async (db, openid) => {
  await db.collection("users").doc(T.getStableUserId(openid)).set({ data: { openid, nickName: "测试用户" } });
};

// 给管理员再造一个账本，用于“非唯一账本”场景
const seedSecondFamily = (db) => {
  db.collection("families").doc("famB").set({ data: { name: "家庭B", adminOpenid: "admin", status: "active", activeMemberCount: 0, membershipRevision: 1 } });
  db._rows("family_members").push({ _id: "m-admin-b", familyId: "famB", openid: "admin", nickName: "管理员", role: "admin", status: "active", joinedAt: new Date() });
};

before(() => { seed(); });

test("transferAdmin 管理员不能转让给自己", async () => {
  seed({ members: 1 });
  openid = "admin";
  const result = await invoke({ action: "transferAdmin", familyId: "famA", memberId: "m-admin" });
  assert.equal(result.success, false);
  assert.match(result.message, /请选择其他普通成员/);
});

test("transferAdmin 成功：唯一管理员且 adminOpenid 更新", async () => {
  seed({ members: 1 });
  openid = "admin";
  const result = await invoke({ action: "transferAdmin", familyId: "famA", memberId: "m-member" });
  assert.equal(result.success, true);
  const db = fakeCloud.database();
  const family = db._rows("families").find((f) => f._id === "famA");
  assert.equal(family.adminOpenid, "member");
  const admins = db._rows("family_members").filter((x) => x.status === "active" && x.role === "admin");
  assert.equal(admins.length, 1);
  assert.equal(admins[0].openid, "member");
  const oldAdmin = db._rows("family_members").find((x) => x._id === "m-admin");
  assert.equal(oldAdmin.role, "member");
});

test("transferAdmin 非管理员被拒", async () => {
  seed({ members: 1 });
  openid = "member";
  const result = await invoke({ action: "transferAdmin", familyId: "famA", memberId: "m-admin" });
  assert.equal(result.success, false);
  assert.match(result.message, /只有管理员/);
});

test("confirmJoinFamily 已是成员则幂等不新增", async () => {
  seed({ members: 1 });
  openid = "member";
  const before = fakeCloud.database()._rows("family_members").filter((x) => x.openid === "member" && x.status === "active").length;
  const result = await invoke({ action: "confirmJoinFamily", code: "ABCD2345", profile: { nickName: "成员" } });
  assert.equal(result.success, true);
  assert.equal(result.alreadyMember, true);
  assert.ok(result.family && result.family.memberId, "已加入成员也应返回 memberId（记账表单依赖）");
  const after = fakeCloud.database()._rows("family_members").filter((x) => x.openid === "member" && x.status === "active").length;
  assert.equal(after, before);
});

test("confirmJoinFamily 新成员加入成功且为普通成员", async () => {
  seed({ members: 1 });
  openid = "newbie";
  const result = await invoke({ action: "confirmJoinFamily", code: "ABCD2345", profile: { nickName: "新成员" } });
  assert.equal(result.success, true);
  assert.equal(result.alreadyMember, false);
  assert.ok(result.family && result.family.memberId, "新加入成员应返回 memberId（记账表单依赖）");
  const rec = fakeCloud.database()._rows("family_members").find((x) => x.openid === "newbie");
  assert.ok(rec);
  assert.equal(rec.role, "member");
  assert.equal(rec.status, "active");
});

test("getFamilyDetail 返回 family.memberId（前端记账/切换账本依赖）", async () => {
  seed({ members: 1 });
  openid = "admin";
  const result = await invoke({ action: "getFamilyDetail", familyId: "famA" });
  assert.equal(result.success, true);
  assert.ok(result.family && result.family.memberId, "账本详情必须包含当前用户成员 memberId");
  assert.equal(result.family.memberId, "m-admin");
  const members = result.members || [];
  assert.ok(members.some((item) => item.memberId === "m-admin"), "成员列表应包含当前用户");
});

test("confirmJoinFamily 人数上限：第 51 位被拒", async () => {
  seed({ members: 50 }); // admin + 49 = 50 active
  openid = "extra51";
  const result = await invoke({ action: "confirmJoinFamily", code: "ABCD2345", profile: { nickName: "第51人" } });
  assert.equal(result.success, false);
  assert.match(result.message, /成员已达上限/);
});

test("confirmJoinFamily 过期邀请被拒", async () => {
  seed({ members: 1, inviteExpiresAt: PAST });
  openid = "newbie";
  const result = await invoke({ action: "confirmJoinFamily", code: "ABCD2345", profile: { nickName: "新成员" } });
  assert.equal(result.success, false);
  assert.match(result.message, /邀请码无效或已过期|邀请码无效/);
});

test("createInvite 仅管理员", async () => {
  seed({ members: 1 });
  openid = "member";
  const result = await invoke({ action: "createInvite", familyId: "famA" });
  assert.equal(result.success, false);
  assert.match(result.message, /只有管理员/);
});

test("leaveFamily 唯一账本的管理员不能退出", async () => {
  seed({ members: 1 });
  openid = "admin";
  const result = await invoke({ action: "leaveFamily", familyId: "famA" });
  assert.equal(result.success, false);
  assert.match(result.message, /你至少需要保留一个账本/);
});

test("leaveFamily 管理员有多个账本时不能直接退出", async () => {
  const db = seed({ members: 1 });
  seedSecondFamily(db);
  openid = "admin";
  const result = await invoke({ action: "leaveFamily", familyId: "famA" });
  assert.equal(result.success, false);
  assert.match(result.message, /管理员请先转让管理权/);
});

test("dissolveFamily 唯一账本无注销意图时被拒", async () => {
  seed({ members: 0 });
  openid = "admin";
  const result = await invoke({ action: "dissolveFamily", familyId: "famA" });
  assert.equal(result.success, false);
  assert.match(result.message, /你至少需要保留一个账本/);
});

test("dissolveFamily 唯一账本配注销意图可解散并收敛状态", async () => {
  const db = seed({ members: 0 });
  await seedUsers(db, "admin");
  openid = "admin";
  const begin = await invoke({ action: "beginAccountCancellation" });
  assert.equal(begin.success, true);
  const result = await invoke({ action: "dissolveFamily", familyId: "famA", forceLastFamily: true });
  assert.equal(result.success, true);
  assert.equal(result.alreadyDissolved, false);
  const family = db._rows("families").find((f) => f._id === "famA");
  assert.equal(family.status, "dissolved");
  assert.equal(family.activeMemberCount, 0);
  const admin = db._rows("family_members").find((member) => member._id === "m-admin");
  assert.equal(admin.status, "dissolved");
  const invite = db._rows("family_invites").find((i) => i.code === "ABCD2345");
  assert.equal(invite.status, "revoked");
});

test("dissolveFamily 非唯一账本可直接解散且有成员在场也整家收敛", async () => {
  const db = seed({ members: 1 });
  seedSecondFamily(db);
  openid = "admin";
  const result = await invoke({ action: "dissolveFamily", familyId: "famA" });
  assert.equal(result.success, true);
  const member = db._rows("family_members").find((x) => x._id === "m-member");
  assert.equal(member.status, "dissolved");
});

test("dissolveFamily 已解散幂等返回", async () => {
  const db = seed({ members: 0 });
  await seedUsers(db, "admin");
  openid = "admin";
  await invoke({ action: "beginAccountCancellation" });
  await invoke({ action: "dissolveFamily", familyId: "famA", forceLastFamily: true });
  const again = await invoke({ action: "dissolveFamily", familyId: "famA", forceLastFamily: true });
  assert.equal(again.success, true);
  assert.equal(again.alreadyDissolved, true);
});
test("collectReminderSubscribers 分批拉取超单批上限不截断", async () => {
  const db = seed();
  for (let i = 0; i < 1200; i += 1) {
    db._rows("reminder_subscriptions").push({ _id: "rem-" + i, openid: "sub" + i, enabled: true, remindHour: 9, grantedCount: 2, sentCount: 0 });
  }
  const { subs, truncated } = await T.collectReminderSubscribers({ enabled: true, remindHour: 9 }, { batchSize: 250 });
  assert.equal(subs.length, 1200);
  assert.equal(truncated, false);
});

test("collectReminderSubscribers 超过硬上限标记截断", async () => {
  const db = seed();
  for (let i = 0; i < 300; i += 1) {
    db._rows("reminder_subscriptions").push({ _id: "rem-cap-" + i, openid: "cap" + i, enabled: true, remindHour: 9, grantedCount: 2, sentCount: 0 });
  }
  const { subs, truncated } = await T.collectReminderSubscribers({ enabled: true, remindHour: 9 }, { batchSize: 100, hardCap: 250 });
  assert.equal(subs.length, 250);
  assert.equal(truncated, true);
});

test("sendDailyReminders 并发投递：sent/skippedNoQuota/skippedRecorded 计数正确", async () => {
  const db = seed();
  fakeCloud.openapi = { subscribeMessage: { send: async () => ({}) } };
  const now = new Date("2026-09-03T01:00:00.000Z"); // 北京时间 09:00
  db._rows("reminder_subscriptions").push(
    { _id: "rem-sent", openid: "admin", enabled: true, remindHour: 9, grantedCount: 5, sentCount: 0, familyId: "famA" },
    { _id: "rem-quota", openid: "outsider", enabled: true, remindHour: 9, grantedCount: 1, sentCount: 1 },
    { _id: "rem-recorded", openid: "member", enabled: true, remindHour: 9, grantedCount: 5, sentCount: 0, familyId: "famA" }
  );
  db._rows("bills").push({ _id: "b-today", familyId: "famA", memberOpenid: "member", deleted: false, date: "2026-09-03 08:00", amount: 1000 });
  const result = await T.sendDailyReminders(now);
  assert.equal(result.success, true);
  assert.equal(result.slot, 9);
  assert.equal(result.sent, 1, "有额度且今日未记账的用户应发送");
  assert.equal(result.skippedNoQuota, 1, "额度耗尽的用户应跳过");
  assert.equal(result.skippedRecorded, 1, "今日已记账的用户应跳过");
  assert.equal(result.failed, 0);
  const sentDoc = db._rows("reminder_subscriptions").find((r) => r._id === "rem-sent");
  assert.equal(sentDoc.sentCount, 1, "发送成功后应累计 sentCount");
  assert.equal(sentDoc.lastError, "");
});

test("sendDailyReminders 43101 失败时暂停对应订阅并置暂停原因", async () => {
  seed();
  fakeCloud.openapi = { subscribeMessage: { send: async () => { const err = new Error("subscribeMessage.send:fail"); err.errCode = 43101; throw err; } } };
  const db = fakeCloud.database();
  db._rows("reminder_subscriptions").push({ _id: "rem-pause", openid: "admin", enabled: true, remindHour: 9, grantedCount: 5, sentCount: 0, familyId: "famA" });
  const now = new Date("2026-09-03T01:00:00.000Z");
  const result = await T.sendDailyReminders(now);
  assert.equal(result.failed, 1);
  const doc = db._rows("reminder_subscriptions").find((r) => r._id === "rem-pause");
  assert.equal(doc.enabled, false);
  assert.equal(doc.pausedReason, "no_quota");
});
