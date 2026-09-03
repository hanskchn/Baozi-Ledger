// 家庭记账本 · 记账偏好缓存合并纯逻辑测试（U7 互踩回归）
// 运行：node --test scripts/test-preferences.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mergePreferences } = require("../miniprogram/utils/preferences.js");

test("本地已有偏好时，服务端旧值不覆盖（U7 互踩回归）", () => {
  const local = { expenseCategory: { category1: "餐饮", category2: "午餐" }, incomeCategory: { category1: "红包", category2: "拼手气" }, account: "微信" };
  const server = { expenseCategory: { category1: "居住", category2: "其他" }, incomeCategory: null, account: "银行卡" };
  assert.deepEqual(mergePreferences(local, server), {
    expenseCategory: { category1: "餐饮", category2: "午餐" },
    incomeCategory: { category1: "红包", category2: "拼手气" },
    account: "微信"
  });
});

test("本地无偏好时用服务端兜底", () => {
  const server = { expenseCategory: { category1: "餐饮", category2: "早餐" }, incomeCategory: null, account: "现金" };
  assert.deepEqual(mergePreferences(null, server), { expenseCategory: { category1: "餐饮", category2: "早餐" }, incomeCategory: null, account: "现金" });
  assert.deepEqual(mergePreferences({}, server), { expenseCategory: { category1: "餐饮", category2: "早餐" }, incomeCategory: null, account: "现金" });
});

test("字段级合并：本地缺失字段才取服务端", () => {
  const local = { expenseCategory: { category1: "交通", category2: "打车" }, incomeCategory: null, account: "支付宝" };
  const server = { expenseCategory: null, incomeCategory: { category1: "工资", category2: "底薪" }, account: "银行卡" };
  assert.deepEqual(mergePreferences(local, server), {
    expenseCategory: { category1: "交通", category2: "打车" },
    incomeCategory: { category1: "工资", category2: "底薪" },
    account: "支付宝"
  });
});

test("merge 幂等：合并结果再与服务端合并不漂移", () => {
  const local = { expenseCategory: { category1: "购物", category2: "美妆" }, incomeCategory: null, account: "微信" };
  const server = { expenseCategory: { category1: "居住", category2: "水电" }, incomeCategory: { category1: "红包", category2: "拼手气" }, account: "银行卡" };
  const once = mergePreferences(local, server);
  assert.deepEqual(mergePreferences(once, server), once);
});

test("空/非法输入安全返回全 null", () => {
  assert.deepEqual(mergePreferences(null, null), { expenseCategory: null, incomeCategory: null, account: null });
  assert.deepEqual(mergePreferences(undefined, "bad"), { expenseCategory: null, incomeCategory: null, account: null });
});
