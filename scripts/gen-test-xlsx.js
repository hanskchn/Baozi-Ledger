#!/usr/bin/env node
// 生成 Phase 9 联调用的测试 xlsx（随手记导出格式）
// 用法：node scripts/gen-test-xlsx.js [输出文件路径]
//   默认输出到 /tmp/test-suijiji.xlsx
// Sheet 1: 支出（约 60 条）
// Sheet 2: 收入（约 20 条）
// 字段：日期、交易类型、一级分类、二级分类、支出账户/收入账户、金额、成员、商家、备注
const path = require("path");
const XLSX = require(path.join(__dirname, "..", "cloudfunctions", "accountingFunctions", "node_modules", "xlsx"));

const out = process.argv[2] || "/tmp/test-suijiji.xlsx";

// 随机日期：在过去 60 天内
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = (arr) => arr[rand(0, arr.length - 1)];
const pad = (n) => String(n).padStart(2, "0");
const dateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
const futureDateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

const today = new Date();

// === 支出分类 ===
const expenseCats = [
  ["餐饮", "早餐"], ["餐饮", "午餐"], ["餐饮", "晚餐"], ["餐饮", "夜宵"],
  ["餐饮", "水果蔬菜"], ["餐饮", "饮料"], ["餐饮", "零食"], ["餐饮", "外卖"],
  ["交通", "公交地铁"], ["交通", "打车"], ["交通", "加油"], ["交通", "停车费"],
  ["购物", "日用品"], ["购物", "服饰"], ["购物", "电子产品"],
  ["居住", "房租"], ["居住", "水电煤"], ["居住", "物业费"],
  ["娱乐", "电影"], ["娱乐", "游戏"], ["娱乐", "聚餐"],
  ["医疗", "药品"], ["医疗", "门诊挂号"],
  ["通讯", "话费"], ["通讯", "网费"],
  ["人情", "红包"], ["人情", "送礼"],
  ["教育", "书籍"], ["教育", "培训"]
];

// === 收入分类 ===
const incomeCats = [
  ["工资", "底薪"], ["工资", "绩效"], ["工资", "加班费"],
  ["奖金", "年终奖"], ["奖金", "项目奖"],
  ["兼职", "临时兼职"],
  ["理财", "利息"], ["理财", "基金"],
  ["红包", "收到红包"]
];

const members = ["老公", "老婆", "孩子"];
const expenseAccounts = ["现金", "支付宝", "微信", "招商银行卡"];
const incomeAccounts = ["招商银行卡", "支付宝"];
const merchants = ["美团", "京东", "淘宝", "全家便利店", "盒马", "公司食堂", "星巴克", "肯德基", "麦当劳", "中石化", "国网电力", "中国移动", "中国联通"];
const expenseRemarks = ["工作日午餐", "周末聚餐", "出差打车", "日常生活用品", "", "续费", "促销活动", ""];
const incomeRemarks = ["月度工资", "项目奖金", "", "理财收益", "", "节日红包"];

// === 生成支出数据 ===
const expenses = [];
for (let i = 0; i < 60; i++) {
  const days = rand(0, 60);
  const d = new Date(today.getTime() - days * 86400000);
  d.setHours(rand(7, 22), rand(0, 59));
  const [c1, c2] = pick(expenseCats);
  expenses.push({
    "日期": dateStr(d),
    "交易类型": "支出",
    "一级分类": c1,
    "二级分类": c2,
    "支出账户/收入账户": pick(expenseAccounts),
    "金额": (Math.random() * 200 + 5).toFixed(2),
    "成员": pick(members),
    "商家": pick(merchants),
    "项目分类": "",
    "项目": "",
    "备注": pick(expenseRemarks)
  });
}

// === 加 1 笔未来日期（验证排除逻辑）===
const future = new Date(today.getTime() + 2 * 86400000);
future.setHours(12, 0);
expenses.push({
  "日期": futureDateStr(future),
  "交易类型": "支出",
  "一级分类": "餐饮",
  "二级分类": "午餐",
  "支出账户/收入账户": "现金",
  "金额": "99.99",
  "成员": "老公",
  "商家": "未来测试商家",
  "项目分类": "",
  "项目": "",
  "备注": "未来日期账单-验证是否被排除"
});

// === 加 1 笔重复（同日同分类同金额-验证去重）===
expenses.push({ ...expenses[0], "备注": "重复测试-验证去重" });

// === 生成收入数据 ===
const incomes = [];
for (let i = 0; i < 20; i++) {
  const days = rand(0, 60);
  const d = new Date(today.getTime() - days * 86400000);
  d.setHours(rand(9, 18), rand(0, 59));
  const [c1, c2] = pick(incomeCats);
  incomes.push({
    "日期": dateStr(d),
    "交易类型": "收入",
    "一级分类": c1,
    "二级分类": c2,
    "支出账户/收入账户": pick(incomeAccounts),
    "金额": (Math.random() * 8000 + 500).toFixed(2),
    "成员": pick(members),
    "商家": "",
    "项目分类": "",
    "项目": "",
    "备注": pick(incomeRemarks)
  });
}

// === 写 xlsx ===
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(expenses), "支出");
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(incomes), "收入");
XLSX.writeFile(wb, out);

console.log("✓ 测试 xlsx 已生成");
console.log("  路径:", out);
console.log("  支出:", expenses.length, "条");
console.log("  收入:", incomes.length, "条");
console.log("  日期范围:", expenses[expenses.length - 1]["日期"], "~", expenses[0]["日期"]);
console.log("  未来日期账单:", 1, "条（" + futureDateStr(future) + "）");
console.log("  重复账单:", 1, "条（验证去重）");
console.log("");
console.log("下一步：在小程序 → 我的 → 数据导入 → 选这个文件");
