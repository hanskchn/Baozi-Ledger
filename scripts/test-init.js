// 家庭记账本 · initUser 默认账本初始化幂等 契约测试（内存假数据库）
// 运行：node --test scripts/test-init.js
const { test } = require("node:test");
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

function reset() {
  const db = fakeCloud.database();
  db.collections = {};
  db._seq = 0;
  return db;
}

test("initUser 首次创建默认账本：仅一个家庭/成员/邀请并初始化分类账户", async () => {
  reset();
  openid = "fresh";
  const first = await m.main({ action: "initUser", profile: { nickName: "新用户" } });
  assert.equal(first.success, true);
  assert.ok(first.family && first.family.id, "应返回默认家庭");
  assert.ok(first.family.memberId, "应返回当前用户成员 memberId（记账表单依赖）");
  const db = fakeCloud.database();
  assert.equal(db._rows("families").length, 1);
  assert.equal(db._rows("family_members").filter((x) => x.status === "active").length, 1);
  assert.ok(db._rows("family_invites").length >= 1, "应初始化邀请码");
  assert.ok(db._rows("categories").length > 10, "应初始化默认分类");
  assert.ok(db._rows("accounts").length >= 5, "应初始化默认账户");
});

test("initUser 重复调用幂等：返回同一家庭，不重复创建", async () => {
  reset();
  openid = "fresh";
  const first = await m.main({ action: "initUser", profile: { nickName: "新用户" } });
  const second = await m.main({ action: "initUser", profile: { nickName: "新用户" } });
  assert.equal(second.success, true);
  assert.equal(second.family.id, first.family.id, "重复初始化应返回同一账本");
  assert.equal(second.family.memberId, first.family.memberId, "重复初始化应返回同一成员");
  const db = fakeCloud.database();
  assert.equal(db._rows("families").length, 1, "不应创建第二个家庭");
  assert.equal(db._rows("family_members").filter((x) => x.status === "active").length, 1, "不应创建第二条有效成员");
  assert.equal(db._rows("users").filter((x) => x.openid === "fresh").length, 1, "用户记录唯一");
});

test("initUser 第二个用户各自拥有独立默认账本", async () => {
  reset();
  openid = "freshA";
  const a = await m.main({ action: "initUser", profile: { nickName: "A" } });
  openid = "freshB";
  const b = await m.main({ action: "initUser", profile: { nickName: "B" } });
  assert.ok(a.family.id !== b.family.id);
  assert.ok(a.family.memberId && b.family.memberId, "两个用户均应返回各自成员 memberId");
  const db = fakeCloud.database();
  assert.equal(db._rows("families").length, 2);
  assert.equal(db._rows("family_members").filter((x) => x.status === "active").length, 2);
});
