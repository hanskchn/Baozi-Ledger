const cloud = require("wx-server-sdk");

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

const DEFAULT_ACCOUNTS = ["现金", "微信", "支付宝", "银行卡", "信用卡", "其他"];

const BASELINE_EXPENSE_CATEGORIES = [
  { name: "餐饮", icon: "🍜", children: ["家常菜", "外卖", "快餐", "零食", "水果", "聚餐", "咖啡", "其他"] },
  { name: "交通", icon: "🚗", children: ["公交地铁", "打车", "停车", "加油", "共享单车", "其他"] },
  { name: "购物", icon: "🛒", children: ["日用品", "服饰", "电子产品", "食品", "美妆", "其他"] },
  { name: "居住", icon: "🏠", children: ["房租", "水电煤", "物业费", "装修", "维修", "其他"] },
  { name: "娱乐", icon: "🎮", children: ["影视", "游戏", "旅游", "运动", "社交", "其他"] },
  { name: "医疗", icon: "💊", children: ["药品", "体检", "挂号", "牙科", "其他"] },
  { name: "教育", icon: "📚", children: ["学费", "培训", "书籍", "资料", "其他"] },
  { name: "人情", icon: "🎁", children: ["红包", "送礼", "请客", "随份子", "其他"] },
  { name: "通讯", icon: "📱", children: ["话费", "网费", "会员订阅", "其他"] },
  { name: "其他", icon: "❓", children: ["其他支出"] }
].map((item) => ({ ...item, children: item.children.map((name) => ({ name, icon: item.icon })) }));

const BASELINE_INCOME_CATEGORIES = [
  { name: "工资", icon: "💰", children: ["底薪", "绩效", "加班费", "其他"] },
  { name: "奖金", icon: "🎉", children: ["年终奖", "季度奖", "项目奖", "其他"] },
  { name: "兼职", icon: "💼", children: ["临时兼职", "长期兼职", "其他"] },
  { name: "理财", icon: "📈", children: ["利息", "基金", "股票", "其他"] },
  { name: "红包", icon: "🧧", children: ["收到红包", "拼手气", "其他"] },
  { name: "其他", icon: "❓", children: ["其他收入"] }
].map((item) => ({ ...item, children: item.children.map((name) => ({ name, icon: item.icon })) }));

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const command = db.command;
const COLLECTIONS = [
  "users",
  "families",
  "family_members",
  "family_invites",
  "categories",
  "accounts",
  "bills",
  "budgets"
];

const getOpenid = () => cloud.getWXContext().OPENID;

const fail = (message, errorCode = "BAD_REQUEST") => ({
  success: false,
  errorCode,
  message
});

const ensureCollections = async () => {
  await Promise.all(COLLECTIONS.map(async (name) => {
    try {
      await db.createCollection(name);
    } catch (error) {
      console.warn(`集合 ${name} 可能已存在`, error);
    }
  }));
};

const getUser = async (openid) => {
  const result = await db.collection("users").where({ openid }).limit(1).get();
  return result.data[0] || null;
};

const ensureUser = async (profile = {}) => {
  const openid = getOpenid();
  const existing = await getUser(openid);
  const now = new Date();
  const userData = {
    openid,
    nickName: String(profile.nickName || existing?.nickName || "微信用户").slice(0, 32),
    avatarUrl: String(profile.avatarUrl || existing?.avatarUrl || ""),
    updatedAt: now
  };
  if (existing) {
    await db.collection("users").doc(existing._id).update({ data: userData });
    return { ...existing, ...userData };
  }
  const result = await db.collection("users").add({ data: { ...userData, createdAt: now } });
  return { _id: result._id, ...userData, createdAt: now };
};

const getActiveMember = async (familyId, openid) => {
  const result = await db.collection("family_members").where({
    familyId,
    openid,
    status: "active"
  }).limit(1).get();
  return result.data[0] || null;
};

const requireAdmin = async (familyId, openid = getOpenid()) => {
  const member = await getActiveMember(familyId, openid);
  if (!member) throw new Error("你不是该家庭成员");
  if (member.role !== "admin") throw new Error("只有管理员可以执行此操作");
  return member;
};

const getFamily = async (familyId) => {
  const result = await db.collection("families").doc(familyId).get();
  return result.data;
};

const getFamilyOrNull = async (familyId) => {
  if (!familyId) return null;
  try {
    return await getFamily(familyId);
  } catch (error) {
    const message = String(error.message || error).toLowerCase();
    if (message.includes("does not exist") || message.includes("not exist") || message.includes("document.get:fail")) return null;
    throw error;
  }
};

const getValidMemberships = async (openid) => {
  const result = await db.collection("family_members").where({ openid, status: "active" }).get();
  const valid = [];
  for (const member of result.data) {
    const family = await getFamilyOrNull(member.familyId);
    if (family) {
      valid.push({ member, family });
    } else {
      await db.collection("family_members").doc(member._id).update({
        data: { status: "invalid", updatedAt: new Date() }
      });
    }
  }
  return valid;
};

const createInviteCode = async () => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    let code = "";
    for (let index = 0; index < 8; index += 1) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    const existing = await db.collection("family_invites").where({ code, status: "active" }).limit(1).get();
    if (!existing.data.length) return code;
  }
  throw new Error("邀请码生成失败，请重试");
};

const initUser = async (event) => {
  const user = await ensureUser(event.profile);
  const memberships = await getValidMemberships(user.openid);
  let family;
  if (memberships.length) {
    const preferred = memberships.find((item) => item.member.familyId === event.currentFamilyId) || memberships[0];
    await ensureFamilySeedData(preferred.family._id);
    family = { id: preferred.family._id, name: preferred.family.name, role: preferred.member.role, created: false };
  } else {
    family = await createDefaultFamily(user);
  }
  return { success: true, user, family };
};

const listFamilies = async () => {
  const openid = getOpenid();
  const memberships = await getValidMemberships(openid);
  const families = await Promise.all(memberships.map(async ({ member, family }) => {
    const countResult = await db.collection("family_members").where({ familyId: family._id, status: "active" }).count();
    return {
      id: family._id,
      name: family.name,
      memberCount: countResult.total,
      role: member.role,
      createdAt: family.createdAt
    };
  }));
  return { success: true, families };
};

const createFamily = async (event) => {
  const name = String(event.name || "").trim();
  if (!name || name.length > 30) throw new Error("账本名称需为 1 到 30 个字符");
  const user = await ensureUser(event.profile);
  const now = new Date();
  const familyResult = await db.collection("families").add({
    data: {
      name,
      adminOpenid: user.openid,
      createdAt: now,
      updatedAt: now
    }
  });
  await db.collection("family_members").add({
    data: {
      familyId: familyResult._id,
      openid: user.openid,
      nickName: user.nickName,
      avatarUrl: user.avatarUrl,
      role: "admin",
      status: "active",
      joinedAt: now,
      updatedAt: now
    }
  });
  await initFamilyCategoriesAndAccounts(familyResult._id);
  return { success: true, family: { id: familyResult._id, name, role: "admin" } };
};

const initFamilyCategoriesAndAccounts = async (familyId) => {
  const now = new Date();
  const categories = [...BASELINE_EXPENSE_CATEGORIES.map((item) => ({ ...item, type: "expense" })), ...BASELINE_INCOME_CATEGORIES.map((item) => ({ ...item, type: "income" }))];
  const existingCategories = await db.collection("categories").where({ familyId }).limit(1).get();
  const existingAccounts = await db.collection("accounts").where({ familyId }).limit(1).get();
  if (!existingCategories.data.length) {
    for (const category of categories) {
      const result = await db.collection("categories").add({ data: { familyId, name: category.name, icon: category.icon, type: category.type, parentId: null, enabled: true, createTime: now, updatedAt: now } });
      for (const child of category.children) {
        await db.collection("categories").add({ data: { familyId, name: child.name, icon: child.icon, type: category.type, parentId: result._id, enabled: true, createTime: now, updatedAt: now } });
      }
    }
  }
  if (!existingAccounts.data.length) {
    for (const name of DEFAULT_ACCOUNTS) {
      await db.collection("accounts").add({ data: { familyId, name, enabled: true, createTime: now, updatedAt: now } });
    }
  }
};

const getFamilyDetail = async (event) => {
  const member = await getActiveMember(event.familyId, getOpenid());
  if (!member) throw new Error("你不是该家庭成员");
  const family = await getFamily(event.familyId);
  const members = await db.collection("family_members").where({ familyId: event.familyId, status: "active" }).get();
  return {
    success: true,
    family: { id: family._id, name: family.name, role: member.role },
    role: member.role,
    members: members.data.map((item) => ({
      openid: item.openid,
      nickName: item.nickName,
      avatarUrl: item.avatarUrl,
      role: item.role,
      joinedAt: item.joinedAt
    }))
  };
};

const createInvite = async (event) => {
  await requireAdmin(event.familyId);
  const code = await createInviteCode();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  await db.collection("family_invites").add({
    data: { familyId: event.familyId, code, status: "active", createdBy: getOpenid(), createdAt: now, expiresAt }
  });
  return { success: true, code, expiresAt };
};

const joinFamily = async (event) => {
  const code = String(event.code || "").trim().toUpperCase();
  if (!code) throw new Error("请输入邀请码");
  const inviteResult = await db.collection("family_invites").where({ code, status: "active" }).limit(1).get();
  const invite = inviteResult.data[0];
  if (!invite || new Date(invite.expiresAt).getTime() < Date.now()) throw new Error("邀请码无效或已过期");
  const user = await ensureUser(event.profile);
  const existing = await db.collection("family_members").where({ familyId: invite.familyId, openid: user.openid }).limit(1).get();
  const now = new Date();
  if (existing.data[0]) {
    await db.collection("family_members").doc(existing.data[0]._id).update({ data: { status: "active", joinedAt: now, updatedAt: now } });
  } else {
    await db.collection("family_members").add({ data: { familyId: invite.familyId, openid: user.openid, nickName: user.nickName, avatarUrl: user.avatarUrl, role: "member", status: "active", joinedAt: now, updatedAt: now } });
  }
  const family = await getFamily(invite.familyId);
  return { success: true, family: { id: family._id, name: family.name } };
};

const removeMember = async (event) => {
  await requireAdmin(event.familyId);
  if (event.openid === getOpenid()) throw new Error("管理员不能移除自己");
  const member = await getActiveMember(event.familyId, event.openid);
  if (!member) throw new Error("成员不存在");
  await db.collection("family_members").doc(member._id).update({ data: { status: "left", leftAt: new Date(), updatedAt: new Date() } });
  return { success: true };
};

const transferAdmin = async (event) => {
  await requireAdmin(event.familyId);
  const target = await getActiveMember(event.familyId, event.openid);
  if (!target) throw new Error("目标成员不存在");
  const now = new Date();
  await db.collection("family_members").where({ familyId: event.familyId, openid: getOpenid(), status: "active" }).update({ data: { role: "member", updatedAt: now } });
  await db.collection("family_members").doc(target._id).update({ data: { role: "admin", updatedAt: now } });
  await db.collection("families").doc(event.familyId).update({ data: { adminOpenid: event.openid, updatedAt: now } });
  return { success: true };
};

const resetFamilyData = async (event) => {
  await requireAdmin(event.familyId);
  
  // 删除当前家庭的分类和账户数据
  await db.collection("categories").where({ familyId: event.familyId }).remove();
  await db.collection("accounts").where({ familyId: event.familyId }).remove();
  
  // 重新初始化分类和账户
  await initFamilyCategoriesAndAccounts(event.familyId);
  
  return { success: true, message: "分类和账户已重置" };
};

const main = async (event) => {
  await ensureCollections();
  switch (event.action || event.type) {
    case "initUser": return await initUser(event);
    case "listFamilies": return await listFamilies();
    case "createFamily": return await createFamily(event);
    case "getFamilyDetail": return await getFamilyDetail(event);
    case "createInvite": return await createInvite(event);
    case "joinFamily": return await joinFamily(event);
    case "removeMember": return await removeMember(event);
    case "transferAdmin": return await transferAdmin(event);
    case "resetFamilyData": return await resetFamilyData(event);
    default: return fail("未知操作", "UNKNOWN_ACTION");
  }
};

exports.main = async (event) => {
  try {
    return await main(event);
  } catch (error) {
    console.error(error);
    return fail(error.message || "服务器错误", "SERVER_ERROR");
  }
};
const ensureFamilySeedData = async (familyId) => {
  const categoryCount = await db.collection("categories").where({ familyId }).count();
  const accountCount = await db.collection("accounts").where({ familyId }).count();
  if (categoryCount.total === 0 || accountCount.total === 0) await initFamilyCategoriesAndAccounts(familyId);
  const family = await getFamily(familyId);
  if (family.adminOpenid === getOpenid()) {
    const inviteResult = await db.collection("family_invites").where({ familyId, status: "active" }).limit(1).get();
    const activeInvite = inviteResult.data.find((item) => new Date(item.expiresAt).getTime() > Date.now());
    if (!activeInvite) {
      const now = new Date();
      const code = await createInviteCode();
      await db.collection("family_invites").add({ data: { familyId, code, status: "active", createdBy: getOpenid(), createdAt: now, expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000) } });
    }
  }
};

const createDefaultFamily = async (user) => {
  const members = await db.collection("family_members").where({ openid: user.openid, status: "active" }).get();
  const usedNames = new Set();
  for (const item of members.data) {
    const family = await getFamily(item.familyId);
    if (family && family.name) usedNames.add(String(family.name).trim().toLowerCase());
  }
  let name = "我的家庭账本";
  let suffix = 2;
  while (usedNames.has(name.toLowerCase())) name = `我的家庭账本 ${suffix++}`;
  const now = new Date();
  const familyResult = await db.collection("families").add({ data: { name, adminOpenid: user.openid, createdAt: now, updatedAt: now } });
  await db.collection("family_members").add({ data: { familyId: familyResult._id, openid: user.openid, nickName: user.nickName, avatarUrl: user.avatarUrl, role: "admin", status: "active", joinedAt: now, updatedAt: now } });
  await initFamilyCategoriesAndAccounts(familyResult._id);
  const code = await createInviteCode();
  await db.collection("family_invites").add({ data: { familyId: familyResult._id, code, status: "active", createdBy: user.openid, createdAt: now, expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000) } });
  return { id: familyResult._id, name, role: "admin", created: true };
};
