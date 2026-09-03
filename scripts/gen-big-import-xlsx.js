#!/usr/bin/env node
// 生成“导入大文件压力测试”xlsx（目标 2 · P4 分批导入验证）
// 用法：node scripts/gen-big-import-xlsx.js [输出路径]
//   默认输出 /Users/kunhou/Desktop/家庭记账本_测试导入_1900行.xlsx
// 内容：支出 1700 条 + 收入 200 条，共 1900 行（分 10 批 × 200 导入）；
//       末尾内嵌 6 条无效行（金额非法/日期非法/空分类/0 金额/超长商家/超长备注）验证跳过统计。
const path = require("path");
const XLSX = require(path.join(__dirname, "..", "cloudfunctions", "accountingFunctions", "node_modules", "xlsx"));

const out = process.argv[2] || "/Users/kunhou/Desktop/家庭记账本测试导入1900行.xlsx";

const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = (arr) => arr[rand(0, arr.length - 1)];
const pad = (n) => String(n).padStart(2, "0");
const dateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
// 只生成过去 2 年内的账单，避免未来日期账单落进默认“本月”视图看不到
const pastDate = () => {
  const start = new Date("2024-01-01T00:00:00+08:00").getTime();
  const end = Date.now() - 24 * 3600 * 1000;
  return new Date(start + Math.floor(Math.random() * (end - start)));
};

const expenseCats = [
  ["餐饮", "早餐"], ["餐饮", "午餐"], ["餐饮", "晚餐"], ["餐饮", "夜宵"], ["餐饮", "零食"], ["餐饮", "水果"], ["餐饮", "外卖"],
  ["交通", "公交地铁"], ["交通", "打车"], ["交通", "加油"], ["交通", "停车费"], ["交通", "高速费"],
  ["购物", "日用品"], ["购物", "服饰"], ["购物", "美妆"], ["购物", "电子产品"],
  ["居住", "水电费"], ["居住", "物业费"], ["居住", "维修"],
  ["娱乐", "电影"], ["娱乐", "游戏"], ["娱乐", "聚会"],
  ["医疗", "药品"], ["医疗", "体检"],
  ["通讯", "话费"], ["通讯", "网费"],
  ["人情", "份子钱"], ["人情", "礼金"],
  ["餐饮", "团建"], ["购物", "超市"], ["其他", "其他支出"]
];
const incomeCats = [
  ["工资", "底薪"], ["工资", "绩效"], ["工资", "加班费"],
  ["奖金", "季度奖"], ["奖金", "年终奖"],
  ["兼职", "临时兼职"], ["兼职", "长期兼职"],
  ["理财", "利息"], ["理财", "基金"],
  ["红包", "收到红包"], ["红包", "拼手气"],
  ["其他", "其他收入"]
];
const accounts = ["微信", "支付宝", "银行卡", "现金", "零钱"];
const merchants = ["美团", "京东", "淘宝", "拼多多", "全家便利店", "盒马鲜生", "公司食堂", "星巴克", "肯德基", "麦当劳", "中石化", "国网电力", "中国移动", "中国联通", "滴滴出行", "地铁扫码", "永辉超市", "蜜雪冰城", "瑞幸咖啡", "海底捞"];
const expenseRemarks = ["工作日午餐", "周末聚餐", "加班打车", "通勤地铁", "日常生活用品", "手机充值", "电费缴纳", "看电影", "买书", "体检挂号", "", "新房采购", "超市采购", "聚餐AA", "宠物用品", ""];
const incomeRemarks = ["月度工资", "绩效发放", "加班补贴", "项目奖金", "年终奖金", "理财收益", "基金赎回", "节日红包", "兼职收入", ""];

const makeRow = (type, c1, c2, remark) => ({
  日期: dateStr(pastDate()),
  交易类型: type,
  一级分类: c1,
  二级分类: c2,
  "支出账户/收入账户": pick(accounts),
  金额: (Math.random() * (type === "收入" ? 8000 : 2000) + (type === "收入" ? 100 : 1)).toFixed(2),
  成员: Math.random() < 0.1 ? "管理员" : "",
  商家: type === "收入" ? "" : pick(merchants),
  项目分类: "",
  项目: "",
  备注: remark
});

const expenseRows = [];
for (let i = 0; i < 1700; i += 1) {
  const [c1, c2] = pick(expenseCats);
  expenseRows.push(makeRow("支出", c1, c2, pick(expenseRemarks)));
}
const incomeRows = [];
for (let i = 0; i < 200; i += 1) {
  const [c1, c2] = pick(incomeCats);
  incomeRows.push(makeRow("收入", c1, c2, pick(incomeRemarks)));
}

// 无效行（验证跳过统计）：金额非法 / 金额 0 / 日期非法 / 一级分类空 / 商家超长 / 备注超长
expenseRows.push({ 日期: "2024-01-01 12:00", 交易类型: "支出", 一级分类: "餐饮", 二级分类: "早餐", "支出账户/收入账户": "现金", 金额: "abc", 成员: "", 商家: "", 备注: "金额非法" });
expenseRows.push({ 日期: "2024-01-01 12:00", 交易类型: "支出", 一级分类: "餐饮", 二级分类: "早餐", "支出账户/收入账户": "现金", 金额: "0.00", 成员: "", 商家: "", 备注: "金额为0" });
expenseRows.push({ 日期: "2024-13-01 12:00", 交易类型: "支出", 一级分类: "餐饮", 二级分类: "早餐", "支出账户/收入账户": "现金", 金额: "8.00", 成员: "", 商家: "", 备注: "日期非法" });
expenseRows.push({ 日期: "2024-01-01 12:00", 交易类型: "支出", 一级分类: "", 二级分类: "早餐", "支出账户/收入账户": "现金", 金额: "8.00", 成员: "", 商家: "", 备注: "一级分类为空" });
expenseRows.push({ 日期: "2024-01-01 12:00", 交易类型: "支出", 一级分类: "餐饮", 二级分类: "早餐", "支出账户/收入账户": "现金", 金额: "8.00", 成员: "", 商家: "超长商家".repeat(20), 备注: "商家超长" });
expenseRows.push({ 日期: "2024-01-01 12:00", 交易类型: "支出", 一级分类: "餐饮", 二级分类: "早餐", "支出账户/收入账户": "现金", 金额: "8.00", 成员: "", 商家: "", 备注: "很长的备注".repeat(40) });

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(expenseRows), "支出");
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(incomeRows), "收入");
XLSX.writeFile(wb, out);

console.log("✓ 大文件测试 xlsx 已生成:");
console.log("  路径:", out);
console.log("  支出:", expenseRows.length, "条（含无效 6 条）");
console.log("  收入:", incomeRows.length, "条");
console.log("  合计:", expenseRows.length + incomeRows.length, "行（分批 10 次 × 200）");
console.log("  实际应导入:", expenseRows.length + incomeRows.length - 6, "条，跳过 6 条");
