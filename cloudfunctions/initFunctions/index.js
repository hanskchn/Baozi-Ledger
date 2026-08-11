const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const EXPENSE_CATEGORIES = [
  { name: "食品酒水", icon: "🍜", children: [
    { name: "早餐", icon: "🥣" }, { name: "午餐", icon: "🍱" }, { name: "晚餐", icon: "🍲" }, { name: "夜宵", icon: "🍢" },
    { name: "水果蔬菜", icon: "🥬" }, { name: "零食", icon: "🍫" }, { name: "饮料", icon: "🧃" }, { name: "酒水", icon: "🍺" },
    { name: "超市购物", icon: "🛒" }, { name: "外卖", icon: "🛵" }
  ]},
  { name: "交流通讯", icon: "📱", children: [
    { name: "话费", icon: "📞" }, { name: "上网费", icon: "📶" }, { name: "邮寄快递", icon: "📦" }
  ]},
  { name: "居家物业", icon: "🏠", children: [
    { name: "房租房贷", icon: "🏠" }, { name: "水电煤气", icon: "💡" }, { name: "物业管理", icon: "🧹" },
    { name: "日常用品", icon: "🧴" }, { name: "家具家电", icon: "🛋️" }
  ]},
  { name: "行车交通", icon: "🚗", children: [
    { name: "打车租车", icon: "🚕" }, { name: "公交地铁", icon: "🚇" }, { name: "加油", icon: "⛽" },
    { name: "停车费", icon: "🅿️" }, { name: "维修保养", icon: "🔧" }, { name: "高速过路", icon: "🛣️" }, { name: "机票火车", icon: "🚄" }
  ]},
  { name: "休闲娱乐", icon: "🎮", children: [
    { name: "电影演出", icon: "🎬" }, { name: "咖啡奶茶", icon: "☕" }, { name: "运动健身", icon: "🏃" },
    { name: "旅游度假", icon: "🏖️" }, { name: "聚餐聚会", icon: "🍻" }, { name: "游戏", icon: "🎮" }, { name: "KTV", icon: "🎤" }
  ]},
  { name: "人情交际", icon: "🎁", children: [
    { name: "礼物", icon: "🎁" }, { name: "红包份子", icon: "🧧" }, { name: "请客", icon: "🍽️" }
  ]},
  { name: "医疗健康", icon: "💊", children: [
    { name: "门诊挂号", icon: "🏥" }, { name: "药品", icon: "💊" }, { name: "体检", icon: "🩺" }
  ]},
  { name: "服饰美容", icon: "👗", children: [
    { name: "衣服鞋帽", icon: "👕" }, { name: "护肤化妆", icon: "💄" }, { name: "美发美容", icon: "💇" }
  ]},
  { name: "进修学习", icon: "📚", children: [
    { name: "书籍", icon: "📖" }, { name: "培训课程", icon: "🎓" }, { name: "学习用品", icon: "✏️" }
  ]},
  { name: "数码电器", icon: "💻", children: [
    { name: "手机电脑", icon: "💻" }, { name: "数码配件", icon: "🔌" }
  ]},
  { name: "母婴亲子", icon: "👶", children: [
    { name: "奶粉尿裤", icon: "🍼" }, { name: "玩具", icon: "🧸" }, { name: "早教", icon: "🎨" }
  ]},
  { name: "宠物", icon: "🐶", children: [
    { name: "宠物食品", icon: "🦴" }, { name: "宠物医疗", icon: "🐾" }
  ]},
  { name: "金融保险", icon: "🏦", children: [
    { name: "保险费", icon: "🛡️" }, { name: "银行手续费", icon: "🏧" }
  ]},
  { name: "其他支出", icon: "❓", children: [
    { name: "其他", icon: "❓" }
  ]}
];

const INCOME_CATEGORIES = [
  { name: "职业收入", icon: "💼", children: [
    { name: "工资", icon: "💰" }, { name: "奖金", icon: "🎉" }, { name: "兼职收入", icon: "💪" }
  ]},
  { name: "投资理财", icon: "📈", children: [
    { name: "利息", icon: "🏦" }, { name: "股票基金", icon: "📊" }, { name: "理财收益", icon: "💵" }
  ]},
  { name: "礼金收入", icon: "🎁", children: [
    { name: "红包", icon: "🧧" }, { name: "礼金", icon: "💝" }
  ]},
  { name: "其他收入", icon: "❓", children: [
    { name: "其他", icon: "❓" }
  ]}
];

const DEFAULT_ACCOUNTS = ["现金", "银行卡", "微信支付", "支付宝"];

module.exports = async (event, context) => {
  // 确保集合存在
  const COLLECTIONS = ["users", "families", "family_members", "family_invites", "categories", "accounts", "bills", "budgets"];
  for (const name of COLLECTIONS) {
    try {
      await db.createCollection(name);
    } catch (e) {
      console.log(`${name} 集合已存在`);
    }
  }
  
  // 检查是否已初始化
  const existing = await db.collection("categories").count();
  if (existing.total > 0) {
    return { success: true, message: "数据库已初始化" };
  }
  
  let createdCount = 0;
  
  // 创建支出分类
  for (const cat1 of EXPENSE_CATEGORIES) {
    const result = await db.collection("categories").add({
      data: { name: cat1.name, icon: cat1.icon, type: "expense", parentId: null, createTime: new Date() }
    });
    createdCount++;
    
    for (const child of cat1.children) {
      await db.collection("categories").add({
        data: { name: child.name, icon: child.icon, type: "expense", parentId: result._id, createTime: new Date() }
      });
      createdCount++;
    }
  }
  
  // 创建收入分类
  for (const cat1 of INCOME_CATEGORIES) {
    const result = await db.collection("categories").add({
      data: { name: cat1.name, icon: cat1.icon, type: "income", parentId: null, createTime: new Date() }
    });
    createdCount++;
    
    for (const child of cat1.children) {
      await db.collection("categories").add({
        data: { name: child.name, icon: child.icon, type: "income", parentId: result._id, createTime: new Date() }
      });
      createdCount++;
    }
  }
  
  // 创建默认账户
  for (const name of DEFAULT_ACCOUNTS) {
    await db.collection("accounts").add({ data: { name, createTime: new Date() } });
  }
  
  return { success: true, message: `初始化完成：${createdCount} 个分类，${DEFAULT_ACCOUNTS.length} 个账户` };
};
