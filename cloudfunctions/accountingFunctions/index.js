const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const COLLECTIONS = ["categories", "accounts", "bills", "budgets", "family_members", "bill_preferences"];

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

const getFamilyMember = async (familyId, openid = getOpenid()) => {
  const result = await db.collection("family_members").where({
    familyId,
    openid,
    status: "active"
  }).limit(1).get();
  return result.data[0] || null;
};

const requireMember = async (familyId) => {
  const member = await getFamilyMember(familyId);
  if (!member) throw new Error("你不是该家庭成员");
  return member;
};

const listCategories = async (event) => {
  const { familyId, type } = event;
  await requireMember(familyId);
  const result = await db.collection("categories").where({
    familyId,
    type
  }).orderBy("createTime", "asc").get();
  const active = result.data.filter((item) => item.enabled !== false);
  const parents = active.filter((item) => !item.parentId);
  const categories = parents.map((parent) => ({
    id: parent._id,
    name: parent.name,
    icon: parent.icon,
    children: active.filter((item) => item.parentId === parent._id).map((item) => ({ id: item._id, name: item.name, icon: item.icon }))
  })).filter((item) => item.children.length > 0);
  return { success: true, categories };
};

const listAccounts = async (event) => {
  const { familyId } = event;
  await requireMember(familyId);
  const result = await db.collection("accounts").where({ familyId }).orderBy("createTime", "asc").get();
  return { success: true, accounts: result.data.filter((item) => item.enabled !== false) };
};

const listMembers = async (event) => {
  const { familyId, type } = event;
  await requireMember(familyId);
  const result = await db.collection("family_members").where({ familyId, status: "active" }).get();
  return { success: true, members: result.data };
};

const getBillPreferences = async (event) => {
  await requireMember(event.familyId);
  const result = await db.collection("bill_preferences").where({ familyId: event.familyId, openid: getOpenid() }).limit(1).get();
  return { success: true, preferences: result.data[0] || null };
};

const saveBillPreferences = async (event) => {
  await requireMember(event.familyId);
  const openid = getOpenid();
  const existing = await db.collection("bill_preferences").where({ familyId: event.familyId, openid }).limit(1).get();
  const data = {
    familyId: event.familyId,
    openid,
    expenseCategory: event.expenseCategory || null,
    incomeCategory: event.incomeCategory || null,
    account: event.account || "现金",
    updatedAt: new Date()
  };
  if (existing.data[0]) {
    try {
      await db.collection("bill_preferences").doc(existing.data[0]._id).update({ data });
    } catch (error) {
      // 兼容旧数据或已失效文档，更新失败时重建偏好记录，不阻断记账。
      console.warn("更新记账偏好失败，改为重建", error);
      await db.collection("bill_preferences").add({ data: { ...data, createdAt: new Date() } });
    }
  } else {
    await db.collection("bill_preferences").add({ data: { ...data, createdAt: new Date() } });
  }
  return { success: true };
};

const createBill = async (event) => {
  const { familyId, type, amount, category1, category1Icon, category2, category2Icon, date, account, member, remark, merchant } = event;
  
  if (!familyId || !["expense", "income"].includes(type) || !amount || !category1 || !category2 || !date || !account || !member) {
    throw new Error("请填写完整信息");
  }
  
  const memberInfo = await requireMember(familyId);
  const amountText = String(amount).trim();
  if (!/^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/.test(amountText)) throw new Error("金额格式不正确");
  const amountCents = Math.round(Number(amountText) * 100);
  if (amountCents <= 0 || amountCents > 999999999) throw new Error("金额需在 0.01 到 9,999,999.99 之间");
  const targetMember = await getFamilyMember(familyId, member);
  if (!targetMember) throw new Error("账单成员无效");
  if (memberInfo.role !== "admin" && member !== memberInfo.openid) throw new Error("普通成员只能为自己记账");
  const parentResult = await db.collection("categories").where({ familyId, name: category1, type }).get();
  const parent = parentResult.data.find((item) => !item.parentId);
  if (!parent || parent.enabled === false) throw new Error("一级分类无效");
  const childResult = await db.collection("categories").where({ familyId, name: category2, type, parentId: parent._id }).limit(1).get();
  if (!childResult.data[0] || childResult.data[0].enabled === false) throw new Error("二级分类无效");
  const accountResult = await db.collection("accounts").where({ familyId, name: account }).limit(1).get();
  if (!accountResult.data[0] || accountResult.data[0].enabled === false) throw new Error("账户无效");
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(String(date))) throw new Error("日期格式不正确");
  const now = new Date();
  
  const result = await db.collection("bills").add({
    data: {
      familyId,
      type,
      amount: amountCents,
      category1,
      category1Icon,
      category2,
      category2Icon,
      date,
      account,
      memberOpenid: member,
      member: targetMember.nickName,
      creatorOpenId: memberInfo.openid,
      remark: String(remark || "").trim().slice(0, 200),
      merchant: String(merchant || "").trim().slice(0, 50),
      deleted: false,
      version: 1,
      createdAt: now,
      updatedAt: now
    }
  });
  
  return { success: true, billId: result._id };
};

const listBills = async (event) => {
  const { familyId, month, category, member, account } = event;
  await requireMember(familyId);
  
  const where = { familyId, deleted: false };
  
  if (month) {
    const [year, mon] = month.split("-");
    where.date = db.command.gte(`${year}-${mon}-01`).and(db.command.lte(`${year}-${mon}-31`));
  }
  if (category) where.category2 = category;
  if (member) where.memberOpenid = member;
  if (account) where.account = account;
  
  const result = await db.collection("bills").where(where)
    .orderBy("date", "desc")
    .limit(100)
    .get();
  
  return { success: true, bills: result.data };
};

const getStats = async (event) => {
  const { familyId, month } = event;
  await requireMember(familyId);
  
  const [year, mon] = month.split("-");
  const start = `${year}-${mon}-01`;
  const end = `${year}-${mon}-31`;
  
  const bills = await db.collection("bills").where({
    familyId,
    deleted: false,
    date: db.command.gte(start).and(db.command.lte(end))
  }).get();
  
  let totalExpense = 0;
  let totalIncome = 0;
  const categoryStats = {};
  const dailyStats = {};
  
  bills.data.forEach((bill) => {
    const amount = bill.amount / 100;
    if (bill.type === "expense") {
      totalExpense += amount;
      if (!categoryStats[bill.category2]) {
        categoryStats[bill.category2] = { name: bill.category2, icon: bill.category2Icon, amount: 0 };
      }
      categoryStats[bill.category2].amount += amount;
    } else {
      totalIncome += amount;
    }
    
    const dateKey = bill.date.substring(0, 10);
    if (!dailyStats[dateKey]) {
      dailyStats[dateKey] = { date: dateKey, expense: 0, income: 0 };
    }
    if (bill.type === "expense") {
      dailyStats[dateKey].expense += amount;
    } else {
      dailyStats[dateKey].income += amount;
    }
  });
  
  const dailyTrend = Object.values(dailyStats).sort((a, b) => a.date.localeCompare(b.date));
  const categoryList = Object.values(categoryStats).sort((a, b) => b.amount - a.amount);
  
  return {
    success: true,
    totalExpense,
    totalIncome,
    balance: totalIncome - totalExpense,
    categoryStats: categoryList,
    dailyTrend
  };
};

const BUILD_VERSION = "2026-08-10-p0-v5";

const main = async (event = {}) => {
  await ensureCollections();
  const action = String(event.action || event.type || "").trim();
  const handlers = {
    listCategories,
    listAccounts,
    listMembers,
    getBillPreferences,
    saveBillPreferences,
    createBill,
    listBills,
    getStats
  };
  const handler = handlers[action];
  if (!handler) {
    return {
      ...fail("未知操作", "UNKNOWN_ACTION"),
      buildVersion: BUILD_VERSION,
      receivedType: action,
      receivedTypeLength: action.length
    };
  }
  const result = await handler(event);
  return { ...result, buildVersion: BUILD_VERSION };
};

exports.main = async (event) => {
  try {
    return await main(event);
  } catch (error) {
    console.error(error);
    return fail(error.message || "服务器错误", "SERVER_ERROR");
  }
};
