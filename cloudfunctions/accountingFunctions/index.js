const cloud = require("wx-server-sdk");
const XLSX = require("xlsx");
const crypto = require("crypto");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const COLLECTIONS = ["categories", "accounts", "bills", "budgets", "family_members", "bill_preferences", "operation_logs"];
let collectionsReadyPromise;
const FAMILY_MEMBER_QUERY_LIMIT = 100;

// 内存缓存：账本内极少变更的元数据（成员/分类/账户），TTL 30s 减少冷启动 + Tab 切换的 DB roundtrip。
// 仅在云函数单实例内有效；不同实例冷启动仍会查一次，但对连续点击/切 Tab 场景能完全避开数据库。
const MEM_CACHE_TTL_MS = 30 * 1000;
const memCache = new Map();
const memCacheGet = (key) => {
  const hit = memCache.get(key);
  if (!hit) return null;
  if (hit.expireAt < Date.now()) { memCache.delete(key); return null; }
  return hit.value;
};
const memCacheSet = (key, value, ttl = MEM_CACHE_TTL_MS) => memCache.set(key, { value, expireAt: Date.now() + ttl });
const memCacheDel = (prefix) => {
  for (const key of memCache.keys()) if (key.startsWith(prefix)) memCache.delete(key);
};

const getOpenid = () => cloud.getWXContext().OPENID;
const normalizeName = (value) => String(value || "").trim().toLocaleLowerCase();
const getStableDocumentId = (...parts) => crypto.createHash("sha256").update(parts.map((item) => String(item || "")).join("\u0000")).digest("hex").slice(0, 24);
const getStableMembershipId = (familyId, openid) => getStableDocumentId("member", familyId, openid);
const compareMembership = (left, right) => {
  const rank = (member) => [
    member.status === "active" ? 0 : 1,
    member.role === "admin" ? 0 : 1,
    member._id === getStableMembershipId(member.familyId, member.openid) ? 0 : 1,
    -new Date(member.joinedAt || 0).getTime(),
    String(member._id || "")
  ];
  const a = rank(left);
  const b = rank(right);
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] < b[index]) return -1;
    if (a[index] > b[index]) return 1;
  }
  return 0;
};
const padDatePart = (value) => String(value).padStart(2, "0");
const getShanghaiDate = (date = new Date()) => {
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return shifted.getUTCFullYear() + "-" + padDatePart(shifted.getUTCMonth() + 1) + "-" + padDatePart(shifted.getUTCDate());
};
const BILL_AMOUNT_PATTERN = /^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/;
const MAX_BILL_AMOUNT_CENTS = 999999999;
const normalizeText = (value, maxLength) => String(value || "").trim().slice(0, maxLength);
const parseAmountCents = (value, label = "金额") => {
  const text = String(value === undefined || value === null ? "" : value).trim();
  if (!BILL_AMOUNT_PATTERN.test(text)) throw new Error(label + "格式不正确");
  const cents = Math.round(Number(text) * 100);
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > MAX_BILL_AMOUNT_CENTS) throw new Error(label + "需在 0.01 到 9,999,999.99 之间");
  return cents;
};
const parseOptionalAmountCents = (value, label) => {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value).trim();
  if (!BILL_AMOUNT_PATTERN.test(text)) throw new Error(label + "格式不正确");
  const cents = Math.round(Number(text) * 100);
  if (!Number.isSafeInteger(cents) || cents < 0 || cents > MAX_BILL_AMOUNT_CENTS) throw new Error(label + "超出范围");
  return cents;
};
const validateDateTime = (value) => {
  const text = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(text)) throw new Error("日期格式不正确");
  const [datePart, timePart] = text.split(" " );
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);
  const check = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day || hour > 23 || minute > 59) throw new Error("日期格式不正确");
  return text;
};
const getMonthBounds = (month) => {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month)) throw new Error("统计月份无效");
  const [year, value] = month.split("-").map(Number);
  const nextMonth = value === 12 ? 1 : value + 1;
  const nextYear = value === 12 ? year + 1 : year;
  return { start: month + "-01 00:00", end: nextYear + "-" + padDatePart(nextMonth) + "-01 00:00" };
};

const fail = (message, errorCode = "BAD_REQUEST") => ({
  success: false,
  errorCode,
  message
});

const ensureCollections = async () => {
  if (!collectionsReadyPromise) {
    collectionsReadyPromise = Promise.all(COLLECTIONS.map(async (name) => {
      try {
        await db.createCollection(name);
      } catch (error) {
        console.warn(`集合 ${name} 可能已存在`, error);
      }
    }));
  }
  return collectionsReadyPromise;
};

const getFamilyMember = async (familyId, openid = getOpenid()) => {
  if (!familyId) return null;
  let family;
  try {
    family = await db.collection("families").doc(familyId).get();
  } catch (error) {
    return null;
  }
  if (!family.data || family.data.status === "dissolved") return null;
  const result = await db.collection("family_members").where({
    familyId,
    openid,
    status: "active"
  }).limit(20).get();
  return result.data.sort(compareMembership)[0] || null;
};
const getFamilyMemberById = async (familyId, memberId) => {
  if (!memberId) return null;
  const result = await db.collection("family_members").where({ familyId, _id: memberId, status: "active" }).limit(1).get();
  return result.data[0] || null;
};
const getFamilyMemberRecordById = async (familyId, memberId) => {
  if (!memberId) return null;
  const result = await db.collection("family_members").where({ familyId, _id: memberId }).limit(1).get();
  return result.data[0] || null;
};
const getFamilyMemberRecordByOpenid = async (familyId, openid) => {
  if (!familyId || !openid) return null;
  const result = await db.collection("family_members").where({ familyId, openid }).limit(20).get();
  return result.data.sort(compareMembership)[0] || null;
};
const getFamilyMembers = async (familyId, status) => {
  const where = { familyId };
  if (status) where.status = status;
  // 一个账本最多 50 名成员，显式 100 条避免云数据库默认 20 条截断。
  const result = await db.collection("family_members").where(where).limit(FAMILY_MEMBER_QUERY_LIMIT).get();
  const byOpenid = new Map();
  result.data.forEach((member) => {
    const current = byOpenid.get(member.openid);
    if (!current || compareMembership(member, current) < 0) byOpenid.set(member.openid, member);
  });
  return Array.from(byOpenid.values());
};
const resolveActiveMember = async (familyId, memberId, legacyOpenid) => {
  const byId = await getFamilyMemberById(familyId, memberId);
  if (byId) return byId;
  // 兼容旧版本客户端，但不再向客户端返回 openid。
  return legacyOpenid ? getFamilyMember(familyId, legacyOpenid) : null;
};
const resolveMemberOpenidForFilter = async (familyId, memberId) => {
  if (!memberId) return "";
  const member = await getFamilyMemberRecordById(familyId, memberId);
  if (!member) throw new Error("成员筛选条件无效");
  return member.openid;
};

const getAllBills = async (where) => {
  const bills = [];
  let offset = 0;
  while (true) {
    const page = await db.collection("bills").where(where).orderBy("date", "desc").skip(offset).limit(100).get();
    bills.push(...page.data);
    if (page.data.length < 100) return bills;
    offset += page.data.length;
  }
};

const anonymizeCancelledBillMembers = async (familyId, bills) => {
  // 注销成员集合 + memberId 映射缓存 30s：listBills / searchBills / getBill 频繁调用时避免重复查 family_members。
  // members 的写操作都在 ledgerFunctions，accountingFunctions 不会修改 members，因此 30s TTL 内不会读到陈旧数据。
  const cacheKey = `anonymize:${familyId}`;
  let cached = memCacheGet(cacheKey);
  if (!cached) {
    const members = await getFamilyMembers(familyId);
    cached = {
      cancelledOpenids: members.filter((item) => item.status === "cancelled").map((item) => item.openid),
      memberIds: members.map((item) => [item.openid, item._id])
    };
    memCacheSet(cacheKey, cached, 30 * 1000);
  }
  const cancelledOpenids = new Set(cached.cancelledOpenids);
  const memberIds = new Map(cached.memberIds);
  return bills.map((bill) => {
    const visible = cancelledOpenids.has(bill.memberOpenid)
      ? { ...bill, member: "已注销用户", memberAvatarUrl: "", memberId: bill.memberId || memberIds.get(bill.memberOpenid) || "" }
      : { ...bill, memberId: bill.memberId || memberIds.get(bill.memberOpenid) || "" };
    // openid 只用于云端权限和筛选，不向小程序返回，避免把身份标识暴露到客户端。
    const { creatorOpenId, memberOpenid, deletedBy, importFingerprint, ...safeBill } = visible;
    return safeBill;
  });
};

// 返回给客户端的账单字段白名单；显式投影避免云数据库隐式返回的 familyId/importBatchId 等冗余字段。
// exportBills 内部已经按 xlsx 表头重命名字段，不走这个函数。
const projectBill = (bill) => {
  if (!bill) return bill;
  return {
    _id: bill._id,
    type: bill.type,
    amount: bill.amount,
    category1: bill.category1,
    category1Icon: bill.category1Icon,
    category2: bill.category2,
    category2Icon: bill.category2Icon,
    date: bill.date,
    account: bill.account,
    member: bill.member,
    memberId: bill.memberId,
    memberAvatarUrl: bill.memberAvatarUrl,
    remark: bill.remark,
    merchant: bill.merchant,
    version: bill.version,
    canOperate: bill.canOperate
  };
};

const toClientBillPreferences = (preferences) => {
  if (!preferences) return null;
  return {
    expenseCategory: preferences.expenseCategory || null,
    incomeCategory: preferences.incomeCategory || null,
    account: preferences.account || "现金"
  };
};

const validateBillReferences = async (familyId, type, category1, category2, account, date) => {
  if (!["expense", "income"].includes(type)) throw new Error("账单类型无效");
  if (!category1 || !category2 || !account) throw new Error("请填写完整且有效的账单信息");
  validateDateTime(date);
  const parentResult = await db.collection("categories").where({ familyId, name: category1, type }).get();
  const parent = parentResult.data.find((item) => !item.parentId);
  if (!parent || parent.enabled === false) throw new Error("一级分类无效");
  const childResult = await db.collection("categories").where({ familyId, name: category2, type, parentId: parent._id }).limit(1).get();
  if (!childResult.data[0] || childResult.data[0].enabled === false) throw new Error("二级分类无效");
  const accountResult = await db.collection("accounts").where({ familyId, name: account }).limit(1).get();
  if (!accountResult.data[0] || accountResult.data[0].enabled === false) throw new Error("账户无效");
  return { parent, child: childResult.data[0], account: accountResult.data[0] };
};

const getTransactionMember = async (transaction, familyId, openid = getOpenid()) => {
  let family;
  try {
    family = (await transaction.collection("families").doc(familyId).get()).data;
  } catch (error) {
    return null;
  }
  if (!family || family.status === "dissolved") return null;
  const result = await transaction.collection("family_members").where({ familyId, openid, status: "active" }).limit(20).get();
  return result.data.sort(compareMembership)[0] || null;
};

const getTransactionMemberById = async (transaction, familyId, memberId, requireActive = false) => {
  if (!memberId) return null;
  try {
    const member = (await transaction.collection("family_members").doc(memberId).get()).data;
    if (!member || member.familyId !== familyId || (requireActive && member.status !== "active")) return null;
    return member;
  } catch (error) {
    return null;
  }
};

const validateBillReferencesInTransaction = async (transaction, familyId, type, category1, category2, account, date) => {
  if (!["expense", "income"].includes(type)) throw new Error("账单类型无效");
  if (!category1 || !category2 || !account) throw new Error("请填写完整且有效的账单信息");
  validateDateTime(date);
  const parentResult = await transaction.collection("categories").where({ familyId, name: category1, type }).limit(20).get();
  const parent = parentResult.data.find((item) => !item.parentId);
  if (!parent || parent.enabled === false) throw new Error("一级分类无效");
  const childResult = await transaction.collection("categories").where({ familyId, name: category2, type, parentId: parent._id }).limit(1).get();
  const child = childResult.data[0];
  if (!child || child.enabled === false) throw new Error("二级分类无效");
  const accountResult = await transaction.collection("accounts").where({ familyId, name: account }).limit(1).get();
  const resolvedAccount = accountResult.data[0];
  if (!resolvedAccount || resolvedAccount.enabled === false) throw new Error("账户无效");
  return { parent, child, account: resolvedAccount };
};

const addOperationLogInTransaction = (transaction, familyId, action, targetId, summary = {}) => transaction.collection("operation_logs").add({
  data: { familyId, action, targetId, operatorOpenId: getOpenid(), summary, createdAt: new Date() }
});

const requireMember = async (familyId) => {
  const member = await getFamilyMember(familyId);
  if (!member) throw new Error("你不是该家庭成员");
  return member;
};

const requireAdmin = async (familyId) => {
  const member = await requireMember(familyId);
  if (member.role !== "admin") throw new Error("只有管理员可以执行此操作");
  return member;
};

const listCategories = async (event) => {
  const { familyId, type } = event;
  await requireMember(familyId);
  const cacheKey = `categories:${familyId}:${type || "all"}`;
  const cached = memCacheGet(cacheKey);
  if (cached) return { success: true, categories: cached, cached: true };
  const where = { familyId };
  if (type) where.type = type;
  const result = await db.collection("categories").where(where).orderBy("createTime", "asc").get();
  const active = result.data.filter((item) => item.enabled !== false);
  const parents = active.filter((item) => !item.parentId);
  const categories = parents.map((parent) => ({
    id: parent._id,
    name: parent.name,
    icon: parent.icon,
    type: parent.type,
    children: active.filter((item) => item.parentId === parent._id).map((item) => ({ id: item._id, name: item.name, icon: item.icon }))
  })).filter((item) => item.children.length > 0);
  memCacheSet(cacheKey, categories);
  return { success: true, categories };
};

const listAccounts = async (event) => {
  const { familyId } = event;
  await requireMember(familyId);
  const cacheKey = `accounts:${familyId}`;
  const cached = memCacheGet(cacheKey);
  if (cached) return { success: true, accounts: cached, cached: true };
  const result = await db.collection("accounts").where({ familyId }).orderBy("createTime", "asc").get();
  const accounts = result.data.filter((item) => item.enabled !== false);
  memCacheSet(cacheKey, accounts);
  return { success: true, accounts };
};

const listAllAccounts = async (event) => {
  await requireAdmin(event.familyId);
  const result = await db.collection("accounts").where({ familyId: event.familyId }).orderBy("createTime", "asc").get();
  return { success: true, accounts: result.data };
};

const listAllCategories = async (event) => {
  await requireAdmin(event.familyId);
  const result = await db.collection("categories").where({ familyId: event.familyId, type: event.type }).orderBy("createTime", "asc").get();
  return { success: true, categories: result.data };
};

const createCategory = async (event) => {
  await requireAdmin(event.familyId);
  const name = String(event.name || "").trim();
  if (!name || name.length > 20 || !["expense", "income"].includes(event.type)) throw new Error("分类信息不完整");
  if (event.parentId) {
    const parent = await db.collection("categories").doc(event.parentId).get();
    if (!parent.data || parent.data.familyId !== event.familyId || parent.data.parentId || parent.data.type !== event.type || parent.data.enabled === false) throw new Error("一级分类无效或已停用");
  }
  const siblings = await db.collection("categories").where({ familyId: event.familyId, type: event.type, parentId: event.parentId || null }).get();
  if (siblings.data.some((item) => normalizeName(item.name) === normalizeName(name))) throw new Error("分类名称已存在");
  const now = new Date();
  const result = await db.collection("categories").add({ data: { familyId: event.familyId, type: event.type, name, icon: String(event.icon || "❓"), parentId: event.parentId || null, enabled: true, createTime: now, updatedAt: now } });
  memCacheDel(`categories:${event.familyId}`);
  await writeOperationLog(event.familyId, "category.create", result._id, { name });
  return { success: true, id: result._id };
};

const setCategoryEnabled = async (event) => {
  await requireAdmin(event.familyId);
  const category = (await db.collection("categories").doc(event.categoryId).get()).data;
  if (!category || category.familyId !== event.familyId) throw new Error("分类不存在");
  const enabled = event.enabled !== false;
  if (enabled && category.parentId) {
    const parent = (await db.collection("categories").doc(category.parentId).get()).data;
    if (!parent || parent.enabled === false) throw new Error("请先恢复一级分类");
  }
  if (!enabled && category.parentId) {
    const count = await db.collection("categories").where({ familyId: event.familyId, parentId: category.parentId, enabled: true }).count();
    if (count.total <= 1) throw new Error("一级分类至少保留一个可用二级分类");
  }
  const now = new Date();
  await db.collection("categories").doc(category._id).update({ data: { enabled, updatedAt: now } });
  if (!category.parentId && !enabled) {
    await db.collection("categories").where({ familyId: event.familyId, parentId: category._id }).update({ data: { enabled, updatedAt: now } });
  }
  memCacheDel(`categories:${event.familyId}`);
  await writeOperationLog(event.familyId, "category.toggle", category._id, { enabled });
  return { success: true };
};

const renameCategory = async (event) => {
  await requireAdmin(event.familyId);
  const category = (await db.collection("categories").doc(event.categoryId).get()).data;
  const name = String(event.name || "").trim();
  if (!category || category.familyId !== event.familyId || !name || name.length > 20) throw new Error("分类信息无效");
  const siblings = await db.collection("categories").where({ familyId: event.familyId, type: category.type, parentId: category.parentId || null }).get();
  if (siblings.data.some((item) => item._id !== category._id && normalizeName(item.name) === normalizeName(name))) throw new Error("分类名称已存在");
  const now = new Date();
  await db.collection("categories").doc(category._id).update({ data: { name, updatedAt: now } });
  const parentName = category.parentId
    ? (await db.collection("categories").doc(category.parentId).get()).data.name
    : null;
  const bills = await getAllBills({ familyId: event.familyId, deleted: false });
  const matchedBills = bills.filter((bill) => category.parentId
    ? bill.type === category.type && bill.category1 === parentName && bill.category2 === category.name
    : bill.type === category.type && bill.category1 === category.name);
  await Promise.all(matchedBills.map((bill) => db.collection("bills").doc(bill._id).update({
    data: category.parentId
      ? { category2: name, category2Icon: category.icon, updatedAt: now }
      : { category1: name, category1Icon: category.icon, updatedAt: now }
  })));
  memCacheDel(`categories:${event.familyId}`);
  await writeOperationLog(event.familyId, "category.rename", category._id, { from: category.name, name, affectedBills: matchedBills.length });
  return { success: true };
};

const createAccount = async (event) => {
  await requireAdmin(event.familyId);
  const name = String(event.name || "").trim();
  if (!name || name.length > 20) throw new Error("账户名称无效");
  const accounts = await db.collection("accounts").where({ familyId: event.familyId }).get();
  if (accounts.data.some((item) => normalizeName(item.name) === normalizeName(name))) throw new Error("账户名称已存在");
  const result = await db.collection("accounts").add({ data: { familyId: event.familyId, name, enabled: true, createTime: new Date(), updatedAt: new Date() } });
  memCacheDel(`accounts:${event.familyId}`);
  await writeOperationLog(event.familyId, "account.create", result._id, { name });
  return { success: true, id: result._id };
};

const setAccountEnabled = async (event) => {
  await requireAdmin(event.familyId);
  const account = (await db.collection("accounts").doc(event.accountId).get()).data;
  if (!account || account.familyId !== event.familyId) throw new Error("账户不存在");
  if (event.enabled === false) {
    const count = await db.collection("accounts").where({ familyId: event.familyId, enabled: true }).count();
    if (count.total <= 1) throw new Error("至少保留一个可用账户");
  }
  await db.collection("accounts").doc(account._id).update({ data: { enabled: event.enabled !== false, updatedAt: new Date() } });
  memCacheDel(`accounts:${event.familyId}`);
  await writeOperationLog(event.familyId, "account.toggle", account._id, { enabled: event.enabled !== false });
  return { success: true };
};

const deleteCategory = async (event) => {
  await requireAdmin(event.familyId);
  const category = (await db.collection("categories").doc(event.categoryId).get()).data;
  if (!category || category.familyId !== event.familyId) throw new Error("分类不存在");
  const bills = await getAllBills({ familyId: event.familyId, deleted: false });
  const parent = category.parentId ? (await db.collection("categories").doc(category.parentId).get()).data : null;
  const used = bills.some((bill) => category.parentId
    ? bill.type === category.type && bill.category1 === parent.name && bill.category2 === category.name
    : bill.type === category.type && bill.category1 === category.name);
  if (used) {
    await setCategoryEnabled({ ...event, enabled: false });
    return { success: true, disabled: true };
  }
  if (category.parentId) {
    const activeChildren = await db.collection("categories").where({ familyId: event.familyId, parentId: category.parentId, enabled: true }).count();
    if (category.enabled !== false && activeChildren.total <= 1) throw new Error("一级分类至少保留一个可用二级分类");
    await db.collection("categories").doc(category._id).remove();
  } else {
    const children = await db.collection("categories").where({ familyId: event.familyId, parentId: category._id }).get();
    await Promise.all(children.data.map((child) => db.collection("categories").doc(child._id).remove()));
    await db.collection("categories").doc(category._id).remove();
  }
  memCacheDel(`categories:${event.familyId}`);
  await writeOperationLog(event.familyId, "category.delete", category._id, { name: category.name });
  return { success: true, deleted: true };
};

const deleteAccount = async (event) => {
  await requireAdmin(event.familyId);
  const account = (await db.collection("accounts").doc(event.accountId).get()).data;
  if (!account || account.familyId !== event.familyId) throw new Error("账户不存在");
  const bills = await getAllBills({ familyId: event.familyId, deleted: false });
  if (bills.some((bill) => bill.account === account.name)) {
    await setAccountEnabled({ ...event, enabled: false });
    return { success: true, disabled: true };
  }
  if (account.enabled !== false) {
    const activeCount = await db.collection("accounts").where({ familyId: event.familyId, enabled: true }).count();
    if (activeCount.total <= 1) throw new Error("至少保留一个可用账户");
  }
  await db.collection("accounts").doc(account._id).remove();
  memCacheDel(`accounts:${event.familyId}`);
  await writeOperationLog(event.familyId, "account.delete", account._id, { name: account.name });
  return { success: true, deleted: true };
};

const renameAccount = async (event) => {
  await requireAdmin(event.familyId);
  const account = (await db.collection("accounts").doc(event.accountId).get()).data;
  const name = String(event.name || "").trim();
  if (!account || account.familyId !== event.familyId || !name || name.length > 20) throw new Error("账户信息无效");
  const accounts = await db.collection("accounts").where({ familyId: event.familyId }).get();
  if (accounts.data.some((item) => item._id !== account._id && normalizeName(item.name) === normalizeName(name))) throw new Error("账户名称已存在");
  const now = new Date();
  await db.collection("accounts").doc(account._id).update({ data: { name, updatedAt: now } });
  const bills = await getAllBills({ familyId: event.familyId, deleted: false });
  const matchedBills = bills.filter((bill) => bill.account === account.name);
  await Promise.all(matchedBills.map((bill) => db.collection("bills").doc(bill._id).update({ data: { account: name, updatedAt: now } })));
  memCacheDel(`accounts:${event.familyId}`);
  await writeOperationLog(event.familyId, "account.rename", account._id, { from: account.name, name, affectedBills: matchedBills.length });
  return { success: true };
};

const getBudget = async (event) => {
  await requireMember(event.familyId);
  const result = await db.collection("budgets").where({ familyId: event.familyId, month: event.month }).limit(1).get();
  return { success: true, budget: result.data[0] || null };
};

const saveBudget = async (event) => {
  await requireAdmin(event.familyId);
  const month = String(event.month || "");
  const amount = String(event.amount === undefined || event.amount === null ? "" : event.amount).trim();
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month) || !/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(amount) || Number(amount) < 0 || Number(amount) > 99999999.99) throw new Error("预算格式无效");
  const data = { familyId: event.familyId, month, amount: Math.round(Number(amount) * 100), updatedAt: new Date() };
  const existing = await db.collection("budgets").where({ familyId: event.familyId, month }).limit(1).get();
  if (existing.data[0]) await db.collection("budgets").doc(existing.data[0]._id).update({ data });
  else await db.collection("budgets").add({ data: { ...data, createdAt: new Date() } });
  await writeOperationLog(event.familyId, "budget.save", month, { amount: data.amount });
  return { success: true };
};

const deleteBudget = async (event) => {
  await requireAdmin(event.familyId);
  const month = String(event.month || "");
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("预算月份无效");
  const existing = await db.collection("budgets").where({ familyId: event.familyId, month }).limit(1).get();
  if (!existing.data[0]) throw new Error("预算不存在");
  await db.collection("budgets").doc(existing.data[0]._id).remove();
  await writeOperationLog(event.familyId, "budget.delete", month, {});
  return { success: true };
};

const searchBills = async (event) => {
  await requireMember(event.familyId);
  const keyword = String(event.keyword || "").trim();
  if (!keyword) return { success: true, bills: [] };
  const lower = keyword.toLowerCase();
  // 搜索必须覆盖当前账本的全部有效账单，不能因最近 100 条的截断漏掉历史记录。
  const visibleBills = (await anonymizeCancelledBillMembers(event.familyId, await getAllBills({ familyId: event.familyId, deleted: false }))).map(projectBill);
  const bills = visibleBills.filter((bill) => [bill.remark, bill.merchant, bill.category1, bill.category2, bill.member, bill.account, (bill.amount / 100).toFixed(2)].some((value) => String(value || "").toLowerCase().includes(lower)));
  return { success: true, bills: bills.slice(0, 20) };
};

const formatImportedDate = (value) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    // XLSX 读取的 Date 表示表格本地时间；使用 UTC 分量保持原表格日期，不再额外偏移。
    return value.getUTCFullYear() + "-" + String(value.getUTCMonth() + 1).padStart(2, "0") + "-" + String(value.getUTCDate()).padStart(2, "0") + " " + String(value.getUTCHours()).padStart(2, "0") + ":" + String(value.getUTCMinutes()).padStart(2, "0");
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.round(value * 86400000));
    // Excel 序列值代表账面本地日期，直接读取 UTC 分量，避免日期型数据被加 8 小时后错到次日。
    return date.getUTCFullYear() + "-" + String(date.getUTCMonth() + 1).padStart(2, "0") + "-" + String(date.getUTCDate()).padStart(2, "0") + " " + String(date.getUTCHours()).padStart(2, "0") + ":" + String(date.getUTCMinutes()).padStart(2, "0");
  }
  const text = String(value || "").trim().replace(/[\/.]/g, "-").replace(/T/, " ");
  const match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!match) return "";
  return match[1] + "-" + String(match[2]).padStart(2, "0") + "-" + String(match[3]).padStart(2, "0") + " " + String(match[4] || "00").padStart(2, "0") + ":" + String(match[5] || "00").padStart(2, "0").slice(0, 2);
};

const normalizeImportRows = (workbook) => {
  const rows = [];
  ["支出", "收入"].forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return;
    XLSX.utils.sheet_to_json(sheet, { defval: "" }).forEach((row, index) => {
      const rawDate = formatImportedDate(row["日期"]);
      rows.push({
        rowNumber: index + 2,
        type: String(row["交易类型"] || sheetName) === "收入" ? "income" : "expense",
        date: rawDate,
        category1: String(row["一级分类"] || "其他").trim(),
        category2: String(row["二级分类"] || "其他").trim(),
        account: String(row["支出账户/收入账户"] || row["账户"] || "现金").trim(),
        amount: String(row["金额"] || "").trim(),
        memberName: String(row["成员"] || "").trim(),
        merchant: String(row["商家"] || "").trim(),
        remark: String(row["备注"] || "").trim()
      });
    });
  });
  return rows;
};

const loadImportRows = async (fileID) => {
  if (!fileID) throw new Error("请选择导入文件");
  const downloaded = await cloud.downloadFile({ fileID });
  const workbook = XLSX.read(downloaded.fileContent, { type: "buffer" });
  if (!workbook.SheetNames.includes("支出") && !workbook.SheetNames.includes("收入")) throw new Error("文件需要包含支出或收入工作表");
  return normalizeImportRows(workbook);
};

const resolveImportedMember = (members, sourceName, fallbackMember) => {
  const normalized = normalizeName(sourceName);
  if (!normalized) return { member: fallbackMember, matched: false, ambiguous: false };
  const matches = members.filter((item) => normalizeName(item.nickName) === normalized);
  if (matches.length !== 1) {
    return { member: fallbackMember, matched: false, ambiguous: matches.length > 1 };
  }
  return { member: matches[0], matched: true, ambiguous: false };
};

const previewImport = async (event) => {
  const operator = await requireAdmin(event.familyId);
  const rows = await loadImportRows(event.fileID);
  const invalid = rows.find((row) => !/^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/.test(row.amount) || Number(row.amount) <= 0 || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(row.date));
  if (invalid) throw new Error("第 " + invalid.rowNumber + " 行日期或金额无效");
  const members = await getFamilyMembers(event.familyId, "active");
  const memberMappings = [...new Set(rows.map((row) => row.memberName).filter(Boolean))].map((sourceName) => {
    const resolved = resolveImportedMember(members, sourceName, operator);
    return { sourceName, targetName: resolved.member.nickName, matched: resolved.matched, ambiguous: resolved.ambiguous };
  });
  return { success: true, total: rows.length, rows: rows.slice(0, 30), memberMappings };
};

const confirmImport = async (event) => {
  const operator = await requireAdmin(event.familyId);
  const rows = await loadImportRows(event.fileID);
  if (!rows.length) throw new Error("导入文件没有可处理的账单");
  if (rows.length > 2000) throw new Error("单次最多导入 2000 条账单");
  const invalid = rows.find((row) => {
    try {
      parseAmountCents(row.amount);
      validateDateTime(row.date);
      return !row.category1 || !row.category2 || !row.account
        || row.category1.length > 20 || row.category2.length > 20 || row.account.length > 20
        || row.merchant.length > 50 || row.remark.length > 200;
    } catch (error) {
      return true;
    }
  });
  if (invalid) throw new Error("第 " + invalid.rowNumber + " 行字段、日期或金额无效");
  const batchId = "import_" + Date.now();
  const members = await getFamilyMembers(event.familyId, "active");
  let imported = 0;
  try {
    for (const row of rows) {
      if (!/^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/.test(row.amount) || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(row.date)) continue;
      const fingerprint = crypto.createHash("sha256").update(JSON.stringify([row.type, row.date, row.amount, row.category1, row.category2, row.account, row.memberName, row.merchant, row.remark])).digest("hex");
      const legacyFingerprint = [row.type, row.date, row.amount, row.category1, row.category2, row.remark].join("|");
      const duplicate = await db.collection("bills").where({ familyId: event.familyId, importFingerprint: db.command.in([fingerprint, legacyFingerprint]), deleted: false }).limit(1).get();
      if (duplicate.data.length) continue;
      let parent = (await db.collection("categories").where({ familyId: event.familyId, type: row.type, name: row.category1, parentId: null }).limit(1).get()).data[0];
      if (!parent) {
        const created = await db.collection("categories").add({ data: { familyId: event.familyId, type: row.type, name: row.category1, icon: "❓", parentId: null, enabled: true, createdByImportBatchId: batchId, createTime: new Date(), updatedAt: new Date() } });
        parent = { _id: created._id, icon: "❓" };
      }
      const childResult = await db.collection("categories").where({ familyId: event.familyId, type: row.type, name: row.category2, parentId: parent._id }).limit(1).get();
      let child = childResult.data[0];
      if (!child) {
        const created = await db.collection("categories").add({ data: { familyId: event.familyId, type: row.type, name: row.category2, icon: "❓", parentId: parent._id, enabled: true, createdByImportBatchId: batchId, createTime: new Date(), updatedAt: new Date() } });
        child = { _id: created._id, icon: "❓" };
      }
      const account = await db.collection("accounts").where({ familyId: event.familyId, name: row.account || "现金" }).limit(1).get();
      if (!account.data[0]) await db.collection("accounts").add({ data: { familyId: event.familyId, name: row.account || "现金", enabled: true, createdByImportBatchId: batchId, createTime: new Date(), updatedAt: new Date() } });
      const member = resolveImportedMember(members, row.memberName, operator).member;
      await db.collection("bills").add({ data: { familyId: event.familyId, type: row.type, amount: parseAmountCents(row.amount), category1: row.category1, category1Icon: parent.icon || "❓", category2: row.category2, category2Icon: child.icon || "❓", account: row.account || "现金", memberOpenid: member.openid, memberId: member._id, member: member.nickName, creatorOpenId: operator.openid, date: validateDateTime(row.date), merchant: normalizeText(row.merchant, 50), remark: normalizeText(row.remark, 200), deleted: false, version: 1, importBatchId: batchId, importFingerprint: fingerprint, createdAt: new Date(), updatedAt: new Date() } });
      imported += 1;
    }
  } catch (error) {
    // 保留 batchId，使中途失败后前端仍可对该批次发起回滚，避免半导入账单无法撤销。
    error.batchId = batchId;
    error.imported = imported;
    throw error;
  }
  memCacheDel(`categories:${event.familyId}`);
  memCacheDel(`accounts:${event.familyId}`);
  await writeOperationLog(event.familyId, "import.confirm", batchId, { imported, total: rows.length });
  return { success: true, imported, skipped: rows.length - imported, batchId };
};

const rollbackImport = async (event) => {
  await requireAdmin(event.familyId);
  const batchId = String(event.batchId || "");
  if (!batchId) throw new Error("导入批次无效");
  const result = await getAllBills({ familyId: event.familyId, importBatchId: batchId, deleted: false });
  const now = new Date();
  await Promise.all(result.map((bill) => db.collection("bills").doc(bill._id).update({ data: { deleted: true, deletedAt: now, deletedBy: getOpenid(), updatedAt: now, version: (bill.version || 1) + 1 } })));
  const activeBills = await getAllBills({ familyId: event.familyId, deleted: false });
  const createdCategories = await db.collection("categories").where({ familyId: event.familyId, createdByImportBatchId: batchId }).get();
  const createdAccounts = await db.collection("accounts").where({ familyId: event.familyId, createdByImportBatchId: batchId }).get();
  let removedCategories = 0;
  let removedAccounts = 0;
  const childCategories = createdCategories.data.filter((item) => item.parentId);
  for (const category of childCategories) {
    const parent = (await db.collection("categories").doc(category.parentId).get()).data;
    const isUsed = activeBills.some((bill) => bill.type === category.type && bill.category1 === parent?.name && bill.category2 === category.name);
    if (!isUsed) { await db.collection("categories").doc(category._id).remove(); removedCategories += 1; }
  }
  const parentCategories = createdCategories.data.filter((item) => !item.parentId);
  for (const category of parentCategories) {
    const children = await db.collection("categories").where({ familyId: event.familyId, parentId: category._id }).get();
    const isUsed = activeBills.some((bill) => bill.type === category.type && bill.category1 === category.name);
    if (!isUsed && children.data.length === 0) { await db.collection("categories").doc(category._id).remove(); removedCategories += 1; }
  }
  for (const account of createdAccounts.data) {
    if (!activeBills.some((bill) => bill.account === account.name)) { await db.collection("accounts").doc(account._id).remove(); removedAccounts += 1; }
  }
  memCacheDel(`categories:${event.familyId}`);
  memCacheDel(`accounts:${event.familyId}`);
  await writeOperationLog(event.familyId, "import.rollback", batchId, { count: result.length, removedCategories, removedAccounts });
  return { success: true, removed: result.length, removedCategories, removedAccounts };
};

const exportBills = async (event) => {
  await requireAdmin(event.familyId);
  const where = { familyId: event.familyId, deleted: false };
  if (event.dateStart || event.dateEnd) {
    const start = /^\d{4}-\d{2}-\d{2}$/.test(event.dateStart || "") ? event.dateStart + " 00:00" : "0000-01-01 00:00";
    const end = /^\d{4}-\d{2}-\d{2}$/.test(event.dateEnd || "") ? event.dateEnd + " 23:59" : "9999-12-31 23:59";
    if (start > end) throw new Error("导出日期范围无效");
    where.date = db.command.gte(start).and(db.command.lte(end));
  } else if (event.month && /^\d{4}-\d{2}$/.test(event.month)) {
    const bounds = getMonthBounds(event.month);
    where.date = db.command.gte(bounds.start).and(db.command.lt(bounds.end));
  }
  if (event.type && !["expense", "income"].includes(event.type)) throw new Error("导出账单类型无效");
  if (event.type) where.type = event.type;
  if (event.categoryLevel === "category1") where.category1 = event.category;
  else if (event.categoryLevel === "category2") where.category2 = event.category;
  else if (event.category) where.$or = [{ category1: event.category }, { category2: event.category }];
  if (event.memberId) {
    const memberOpenid = await resolveMemberOpenidForFilter(event.familyId, event.memberId);
    where.memberOpenid = memberOpenid;
  }
  if (event.account) where.account = event.account;
  const minAmount = parseOptionalAmountCents(event.minAmount, "最低金额");
  const maxAmount = parseOptionalAmountCents(event.maxAmount, "最高金额");
  if (minAmount !== null && maxAmount !== null && minAmount > maxAmount) throw new Error("导出金额范围无效");
  const exportBills = await anonymizeCancelledBillMembers(event.familyId, await getAllBills(where));
  const rows = exportBills.filter((bill) => (minAmount === null || bill.amount >= minAmount) && (maxAmount === null || bill.amount <= maxAmount)).map((bill) => ({ "日期": bill.date, "类型": bill.type === "expense" ? "支出" : "收入", "一级分类": bill.category1, "二级分类": bill.category2, "账户": bill.account, "金额": (bill.amount / 100).toFixed(2), "成员": bill.member, "商家": bill.merchant || "", "备注": bill.remark || "" }));
  const sheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "账单");
  const fileContent = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  const upload = await cloud.uploadFile({ cloudPath: "exports/" + event.familyId + "-" + Date.now() + ".xlsx", fileContent });
  const urls = await cloud.getTempFileURL({ fileList: [upload.fileID] });
  await writeOperationLog(event.familyId, "export.create", upload.fileID, { count: rows.length });
  return { success: true, count: rows.length, tempFileURL: urls.fileList[0]?.tempFileURL || "" };
};

const listOperationLogs = async (event) => {
  await requireAdmin(event.familyId);
  const where = { familyId: event.familyId };
  const groups = {
    bill: ["bill.create", "bill.update", "bill.delete"],
    import: ["import.confirm", "import.rollback", "export.create"],
    account: ["account.create", "account.rename", "account.toggle", "account.delete"],
    category: ["category.create", "category.rename", "category.toggle", "category.delete"],
    family: ["family.create", "family.rename", "family.dissolve", "invite.create", "invite.revoke", "member.join", "member.remove", "member.leave", "member.transfer_admin", "user.profile.update", "user.account.cancel"]
  };
  if (event.actionType) where.action = event.actionType;
  else if (event.actionGroup && groups[event.actionGroup]) where.action = db.command.in(groups[event.actionGroup]);
  if (event.operatorMemberId) {
    const operator = await getFamilyMemberRecordById(event.familyId, event.operatorMemberId);
    if (!operator) throw new Error("操作人筛选条件无效");
    where.operatorOpenId = operator.openid;
  }
  if (event.dateStart || event.dateEnd) {
    const start = /^\d{4}-\d{2}-\d{2}$/.test(event.dateStart || "") ? new Date(event.dateStart + "T00:00:00+08:00") : new Date(0);
    const end = /^\d{4}-\d{2}-\d{2}$/.test(event.dateEnd || "") ? new Date(event.dateEnd + "T23:59:59+08:00") : new Date(8640000000000000);
    if (start > end) throw new Error("日志日期范围无效");
    where.createdAt = db.command.gte(start).and(db.command.lte(end));
  }
  const result = await db.collection("operation_logs").where(where).orderBy("createdAt", "desc").skip(Math.max(0, Number(event.offset) || 0)).limit(20).get();
  const members = await getFamilyMembers(event.familyId);
  const membersByOpenid = new Map(members.map((item) => [item.openid, item]));
  const logs = result.data.map((item) => {
    const operator = membersByOpenid.get(item.operatorOpenId);
    // 遗留日志的 targetId 曾可能保存 openid，响应中不返回任何原始目标标识。
    const { operatorOpenId, targetId, familyId, ...safeLog } = item;
    return { ...safeLog, operatorMemberId: operator?._id || "", operatorName: operator?.nickName || "已注销用户" };
  });
  return { success: true, logs };
};

const listMembers = async (event) => {
  const { familyId } = event;
  await requireMember(familyId);
  const cacheKey = `members:${familyId}`;
  const cached = memCacheGet(cacheKey);
  if (cached) return { success: true, members: cached, cached: true };
  const members = await getFamilyMembers(familyId, "active");
  const payload = members.map((item) => ({ memberId: item._id, nickName: item.nickName, avatarUrl: item.avatarUrl, role: item.role, joinedAt: item.joinedAt }));
  memCacheSet(cacheKey, payload);
  return { success: true, members: payload };
};

const getBillPreferences = async (event) => {
  await requireMember(event.familyId);
  const result = await db.collection("bill_preferences").where({ familyId: event.familyId, openid: getOpenid() }).limit(1).get();
  return { success: true, preferences: toClientBillPreferences(result.data[0]) };
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
  const { familyId, type, amount, category1, category2, date, account, memberId, remark, merchant } = event;
  
  if (!familyId || !["expense", "income"].includes(type) || amount === undefined || amount === null || !category1 || !category2 || !date || !account || !memberId) {
    throw new Error("请填写完整信息");
  }
  
  const amountCents = parseAmountCents(amount);
  const now = new Date();
  const billId = await db.runTransaction(async (transaction) => {
    const memberInfo = await getTransactionMember(transaction, familyId);
    if (!memberInfo) throw new Error("你不是该家庭成员");
    const targetMember = await getTransactionMemberById(transaction, familyId, memberId, true);
    if (!targetMember) throw new Error("账单成员无效");
    if (memberInfo.role !== "admin" && targetMember.openid !== memberInfo.openid) throw new Error("普通成员只能为自己记账");
    const references = await validateBillReferencesInTransaction(transaction, familyId, type, category1, category2, account, date);
    const billData = {
      familyId,
      type,
      amount: amountCents,
      category1,
      category1Icon: references.parent.icon,
      category2,
      category2Icon: references.child.icon,
      date,
      account,
      memberOpenid: targetMember.openid,
      memberId: targetMember._id,
      member: targetMember.nickName,
      creatorOpenId: memberInfo.openid,
      remark: normalizeText(remark, 200),
      merchant: normalizeText(merchant, 50),
      deleted: false,
      version: 1,
      createdAt: now,
      updatedAt: now
    };
    const billResult = await transaction.collection("bills").add({ data: billData });
    return billResult._id;
  });
  // 操作日志挪到事务外：少一次事务内写入，commit 更快；失败仅 warning，不影响账单写入。
  await writeOperationLog(familyId, "bill.create", billId, { type, amount: amountCents }).catch(() => {});
  return { success: true, billId };
};

const writeOperationLog = async (familyId, action, targetId, summary = {}) => {
  try {
    await db.collection("operation_logs").add({ data: { familyId, action, targetId, operatorOpenId: getOpenid(), summary, createdAt: new Date() } });
  } catch (error) {
    console.warn("写入操作记录失败", error);
  }
};

const getBill = async (event) => {
  const currentMember = await requireMember(event.familyId);
  const result = await db.collection("bills").doc(event.billId).get();
  if (!result.data || result.data.familyId !== event.familyId || result.data.deleted) throw new Error("账单不存在");
  const canOperate = currentMember.role === "admin" || result.data.creatorOpenId === currentMember.openid;
  const [bill] = await anonymizeCancelledBillMembers(event.familyId, [result.data]);
  return { success: true, bill: { ...projectBill(bill), canOperate } };
};

const canOperateBill = (bill, member) => member.role === "admin" || bill.creatorOpenId === member.openid;

const updateBill = async (event) => {
  const version = Number(event.version);
  if (!Number.isInteger(version) || version < 1) throw new Error("账单版本无效，请刷新后重试");
  let loggedFields = [];
  const newVersion = await db.runTransaction(async (transaction) => {
    const member = await getTransactionMember(transaction, event.familyId);
    if (!member) throw new Error("你不是该家庭成员");
    const bill = (await transaction.collection("bills").doc(event.billId).get()).data;
    if (!bill || bill.familyId !== event.familyId || bill.deleted) throw new Error("账单不存在");
    if (!canOperateBill(bill, member)) throw new Error("无权编辑该账单");
    if (version !== Number(bill.version)) throw new Error("账单已被修改，请刷新后重试");
    const changes = {};
    ["type", "category1", "category2", "date", "account"].forEach((key) => {
      if (event[key] !== undefined) changes[key] = event[key];
    });
    if (event.remark !== undefined) changes.remark = normalizeText(event.remark, 200);
    if (event.merchant !== undefined) changes.merchant = normalizeText(event.merchant, 50);
    if (event.amount !== undefined) changes.amount = parseAmountCents(String(event.amount).trim());
    const requestedMemberId = event.memberId || "";
    const existingMember = bill.memberId
      ? await getTransactionMemberById(transaction, event.familyId, bill.memberId, false)
      : null;
    const legacyMember = existingMember || (bill.memberOpenid ? await getTransactionMember(transaction, event.familyId, bill.memberOpenid) : null);
    if (member.role !== "admin" && requestedMemberId && requestedMemberId !== legacyMember?._id) throw new Error("普通成员不能修改账单成员");
    if (member.role === "admin" && requestedMemberId) {
      const target = await getTransactionMemberById(transaction, event.familyId, requestedMemberId, true);
      if (!target) throw new Error("账单成员无效");
      changes.memberOpenid = target.openid;
      changes.memberId = target._id;
      changes.member = target.nickName;
    }
    const nextType = changes.type || bill.type;
    const nextCategory1 = changes.category1 || bill.category1;
    const nextCategory2 = changes.category2 || bill.category2;
    const nextAccount = changes.account || bill.account;
    const nextDate = changes.date || bill.date;
    const references = await validateBillReferencesInTransaction(transaction, event.familyId, nextType, nextCategory1, nextCategory2, nextAccount, nextDate);
    changes.category1Icon = references.parent.icon;
    changes.category2Icon = references.child.icon;
    changes.updatedAt = new Date();
    changes.version = version + 1;
    await transaction.collection("bills").doc(event.billId).update({ data: changes });
    loggedFields = Object.keys(changes).filter((key) => !["updatedAt", "version", "category1Icon", "category2Icon"].includes(key));
    return changes.version;
  });
  // 操作日志挪到事务外，失败仅 warning。
  await writeOperationLog(event.familyId, "bill.update", event.billId, { fields: loggedFields }).catch(() => {});
  return { success: true, version: newVersion };
};

const deleteBill = async (event) => {
  const version = Number(event.version);
  if (!Number.isInteger(version) || version < 1) throw new Error("账单版本无效，请刷新后重试");
  let logSummary = {};
  await db.runTransaction(async (transaction) => {
    const member = await getTransactionMember(transaction, event.familyId);
    if (!member) throw new Error("你不是该家庭成员");
    const bill = (await transaction.collection("bills").doc(event.billId).get()).data;
    if (!bill || bill.familyId !== event.familyId || bill.deleted) throw new Error("账单不存在");
    if (!canOperateBill(bill, member)) throw new Error("无权删除该账单");
    if (version !== Number(bill.version)) throw new Error("账单已被修改，请刷新后重试");
    const now = new Date();
    await transaction.collection("bills").doc(event.billId).update({ data: { deleted: true, deletedAt: now, deletedBy: member.openid, updatedAt: now, version: version + 1 } });
    logSummary = { type: bill.type, amount: bill.amount };
  });
  // 操作日志挪到事务外，失败仅 warning。
  await writeOperationLog(event.familyId, "bill.delete", event.billId, logSummary).catch(() => {});
  return { success: true };
};

const listBills = async (event) => {
  const { familyId, month, category, categoryLevel, memberId, account, type, dateStart, dateEnd, minAmount, maxAmount, merchant, remark } = event;
  const currentMember = await requireMember(familyId);
  const where = { familyId, deleted: false };
  if (dateStart || dateEnd) {
    const start = /^\d{4}-\d{2}-\d{2}$/.test(dateStart || "") ? dateStart + " 00:00" : "0000-01-01 00:00";
    const end = /^\d{4}-\d{2}-\d{2}$/.test(dateEnd || "") ? dateEnd + " 23:59" : "9999-12-31 23:59";
    if (start > end) throw new Error("日期范围无效");
    where.date = db.command.gte(start).and(db.command.lte(end));
  } else if (month) {
    const bounds = getMonthBounds(month);
    where.date = db.command.gte(bounds.start).and(db.command.lt(bounds.end));
  }
  if (categoryLevel === "category1") where.category1 = category;
  else if (categoryLevel === "category2") where.category2 = category;
  else if (category) where.$or = [{ category1: category }, { category2: category }];
  if (memberId) {
    const memberOpenid = await resolveMemberOpenidForFilter(familyId, memberId);
    where.memberOpenid = memberOpenid;
  }
  if (account) where.account = account;
  if (type && !["expense", "income"].includes(type)) throw new Error("账单类型无效");
  if (type) where.type = type;
  if (merchant) where.merchant = db.RegExp({ regexp: merchant, options: "i" });
  if (remark) where.remark = db.RegExp({ regexp: remark, options: "i" });
  const minimum = parseOptionalAmountCents(minAmount, "最低金额");
  const maximum = parseOptionalAmountCents(maxAmount, "最高金额");
  if (minimum !== null && maximum !== null && minimum > maximum) throw new Error("金额范围无效");
  if (minimum !== null) where.amount = db.command.gte(minimum);
  if (maximum !== null) where.amount = where.amount ? where.amount.and(db.command.lte(maximum)) : db.command.lte(maximum);
  const sort = ["dateDesc", "amountAsc", "amountDesc"].includes(event.sort) ? event.sort : "dateDesc";
  const orderField = sort.startsWith("amount") ? "amount" : "date";
  const orderDirection = sort === "amountAsc" ? "asc" : "desc";
  const result = await db.collection("bills").where(where)
    .orderBy(orderField, orderDirection)
    .skip(Math.max(0, Number(event.offset) || 0))
    .limit(Math.min(20, Math.max(1, Number(event.limit) || 20)))
    .get();

  // 管理员可操作所有；普通成员仅可操作自己创建的账单（creatorOpenId 不返回给前端，只给 canOperate 布尔）。
  // 需在 anonymizeCancelledBillMembers 之前计算，因为该函数内部会剥离 creatorOpenId。
  const isAdmin = currentMember.role === "admin";
  const bills = (await anonymizeCancelledBillMembers(
    familyId,
    result.data.map((bill) => ({ ...bill, canOperate: isAdmin || bill.creatorOpenId === currentMember.openid }))
  )).map(projectBill);
  return { success: true, bills };
};

const getStats = async (event) => {
  const { familyId, month, year, dateStart, dateEnd, memberId, account, category, includeFuture = false } = event;
  await requireMember(familyId);
  let bounds;
  if (/^\d{4}$/.test(String(year || ""))) {
    bounds = { start: year + "-01-01 00:00", end: String(Number(year) + 1) + "-01-01 00:00" };
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(String(dateStart || "")) || /^\d{4}-\d{2}-\d{2}$/.test(String(dateEnd || ""))) {
    bounds = {
      start: /^\d{4}-\d{2}-\d{2}$/.test(String(dateStart || "")) ? dateStart + " 00:00" : "0000-01-01 00:00",
      end: /^\d{4}-\d{2}-\d{2}$/.test(String(dateEnd || "")) ? dateEnd + " 23:59" : "9999-12-31 23:59"
    };
  } else {
    bounds = getMonthBounds(month);
  }
  if (bounds.start >= bounds.end) throw new Error("统计日期范围无效");
  const endsAtMonthBoundary = /-01 00:00$/.test(bounds.end);

  // 把日期范围 + 过滤条件全部下沉到 aggregate.match，让云数据库利用索引完成筛选与分组。
  // 避免旧实现 getAllBills 全量拉回 + 内存聚合，账单量大时从秒级降到毫秒级。
  const $ = db.command.aggregate;
  const match = { familyId, deleted: false };
  match.date = endsAtMonthBoundary
    ? db.command.gte(bounds.start).and(db.command.lt(bounds.end))
    : db.command.gte(bounds.start).and(db.command.lte(bounds.end));

  const today = getShanghaiDate();
  const futureCutoff = today + " 23:59";
  const explicitRangeIncludesFuture = /^\d{4}-\d{2}-\d{2}$/.test(String(dateEnd || "")) && dateEnd > today;
  const selectedPeriodStartsInFuture = bounds.start.substring(0, 10) > today;
  const applyFutureCutoff = !includeFuture && !explicitRangeIncludesFuture && !selectedPeriodStartsInFuture;
  if (applyFutureCutoff) {
    match.date = match.date.and(db.command.lte(futureCutoff));
  }
  if (account) match.account = account;
  if (category) match.$or = [{ category1: category }, { category2: category }];
  if (memberId) {
    const memberOpenid = await resolveMemberOpenidForFilter(familyId, memberId);
    if (memberOpenid) match.memberOpenid = memberOpenid;
  }

  const agg = await db.collection("bills").aggregate()
    .match(match)
    .group({
      _id: { type: "$type", category2: "$category2", category2Icon: "$category2Icon", date: $.substr(["$date", 0, 10]) },
      amount: $.sum("$amount")
    })
    .end();

  let totalExpenseCents = 0;
  let totalIncomeCents = 0;
  const expenseCategories = {};
  const incomeCategories = {};
  const dailyStats = {};

  (agg.list || []).forEach((row) => {
    const amount = Number(row.amount || 0);
    if (row._id.type === "expense") {
      totalExpenseCents += amount;
      if (!expenseCategories[row._id.category2]) {
        expenseCategories[row._id.category2] = { name: row._id.category2, icon: row._id.category2Icon, amount: 0 };
      }
      expenseCategories[row._id.category2].amount += amount;
    } else if (row._id.type === "income") {
      totalIncomeCents += amount;
      if (!incomeCategories[row._id.category2]) {
        incomeCategories[row._id.category2] = { name: row._id.category2, icon: row._id.category2Icon, amount: 0 };
      }
      incomeCategories[row._id.category2].amount += amount;
    }
    const dateKey = row._id.date;
    if (!dailyStats[dateKey]) dailyStats[dateKey] = { date: dateKey, expense: 0, income: 0 };
    if (row._id.type === "expense") dailyStats[dateKey].expense += amount;
    else if (row._id.type === "income") dailyStats[dateKey].income += amount;
  });

  const dailyTrend = Object.values(dailyStats).sort((a, b) => a.date.localeCompare(b.date));
  const expenseCategoryStats = Object.values(expenseCategories).map((item) => ({ ...item, amount: item.amount / 100 })).sort((a, b) => b.amount - a.amount);
  const incomeCategoryStats = Object.values(incomeCategories).map((item) => ({ ...item, amount: item.amount / 100 })).sort((a, b) => b.amount - a.amount);
  dailyTrend.forEach((item) => { item.expense /= 100; item.income /= 100; });

  return {
    success: true,
    totalExpense: totalExpenseCents / 100,
    totalIncome: totalIncomeCents / 100,
    balance: (totalIncomeCents - totalExpenseCents) / 100,
    categoryStats: expenseCategoryStats,
    expenseCategoryStats,
    incomeCategoryStats,
    dailyTrend
  };
};

// 首页专用：只返回 4 个数字，避免 getStats 把每日趋势/分类统计全量拉回来。
// 在数据库侧按 (type, date) 二元组聚合，单次扫描完成全部计算。
const getHomeSummary = async (event) => {
  const { familyId, month, dateStart, dateEnd, memberId, account, category, includeFuture = false } = event;
  await requireMember(familyId);
  let bounds;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(dateStart || "")) || /^\d{4}-\d{2}-\d{2}$/.test(String(dateEnd || ""))) {
    bounds = {
      start: /^\d{4}-\d{2}-\d{2}$/.test(String(dateStart || "")) ? dateStart + " 00:00" : "0000-01-01 00:00",
      end: /^\d{4}-\d{2}-\d{2}$/.test(String(dateEnd || "")) ? dateEnd + " 23:59" : "9999-12-31 23:59"
    };
  } else {
    bounds = getMonthBounds(month);
  }
  if (bounds.start >= bounds.end) throw new Error("统计日期范围无效");
  const endsAtMonthBoundary = /-01 00:00$/.test(bounds.end);

  const $ = db.command.aggregate;
  const match = { familyId, deleted: false };
  match.date = endsAtMonthBoundary
    ? db.command.gte(bounds.start).and(db.command.lt(bounds.end))
    : db.command.gte(bounds.start).and(db.command.lte(bounds.end));

  const today = getShanghaiDate();
  const futureCutoff = today + " 23:59";
  const explicitRangeIncludesFuture = /^\d{4}-\d{2}-\d{2}$/.test(String(dateEnd || "")) && dateEnd > today;
  const selectedPeriodStartsInFuture = bounds.start.substring(0, 10) > today;
  if (!includeFuture && !explicitRangeIncludesFuture && !selectedPeriodStartsInFuture) {
    match.date = match.date.and(db.command.lte(futureCutoff));
  }
  if (account) match.account = account;
  if (category) match.$or = [{ category1: category }, { category2: category }];
  if (memberId) {
    const memberOpenid = await resolveMemberOpenidForFilter(familyId, memberId);
    if (memberOpenid) match.memberOpenid = memberOpenid;
  }

  const agg = await db.collection("bills").aggregate()
    .match(match)
    .group({ _id: { type: "$type", date: $.substr(["$date", 0, 10]) }, amount: $.sum("$amount") })
    .end();

  let totalExpenseCents = 0;
  let totalIncomeCents = 0;
  let todayExpenseCents = 0;
  (agg.list || []).forEach((row) => {
    const amount = Number(row.amount || 0);
    if (row._id.type === "expense") {
      totalExpenseCents += amount;
      if (row._id.date === today) todayExpenseCents += amount;
    } else if (row._id.type === "income") {
      totalIncomeCents += amount;
    }
  });

  return {
    success: true,
    totalExpense: totalExpenseCents / 100,
    totalIncome: totalIncomeCents / 100,
    balance: (totalIncomeCents - totalExpenseCents) / 100,
    todayExpense: todayExpenseCents / 100
  };
};

const BUILD_VERSION = "2026-08-10-p0-v5";

const main = async (event = {}) => {
  await ensureCollections();
  const action = String(event.action || event.type || "").trim();
  const handlers = {
    listCategories,
    listAccounts,
    listAllAccounts,
    listAllCategories,
    createCategory,
    setCategoryEnabled,
    deleteCategory,
    renameCategory,
    createAccount,
    setAccountEnabled,
    deleteAccount,
    renameAccount,
    listMembers,
    getBillPreferences,
    saveBillPreferences,
    createBill,
    listBills,
    getStats,
    getBill,
    updateBill,
    deleteBill
    ,getBudget
    ,saveBudget
    ,deleteBudget
    ,searchBills
    ,previewImport
    ,confirmImport
    ,rollbackImport
    ,exportBills
    ,listOperationLogs
    ,getHomeSummary
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
    const result = fail(error.message || "服务器错误", "SERVER_ERROR");
    if (error && error.batchId) {
      result.batchId = error.batchId;
      result.imported = Number(error.imported) || 0;
    }
    return result;
  }
};

// 仅用于本地单元测试暴露的纯函数引用；不改变云端 main 行为。
if (typeof module !== "undefined") {
  module.exports.testUtils = {
    parseAmountCents,
    parseOptionalAmountCents,
    validateDateTime,
    getMonthBounds,
    getShanghaiDate,
    normalizeText,
    normalizeName,
    compareMembership,
    getStableDocumentId,
    getStableMembershipId,
    resolveImportedMember
  };
}
