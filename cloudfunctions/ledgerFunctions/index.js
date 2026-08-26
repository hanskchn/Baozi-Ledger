const cloud = require("wx-server-sdk");
const crypto = require("crypto");

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
let collectionsReadyPromise;
const MAX_FAMILY_MEMBERS = 50;
const FAMILY_MEMBER_QUERY_LIMIT = 100;
const DISSOLVE_RETENTION_DAYS = 30;
const DEFAULT_SEED_VERSION = 1;
const COLLECTIONS = [
  "users",
  "families",
  "family_members",
  "family_invites",
  "categories",
  "accounts",
  "bills",
  "budgets",
  "bill_preferences",
  "operation_logs",
  "initialization_locks"
];

// 账本累计账单笔数（不限月份），用于账本卡与账本列表展示
const countFamilyBills = async (familyId) => {
  try {
    const result = await db.collection("bills").where({ familyId, deleted: false }).count();
    return result.total || 0;
  } catch (error) {
    console.warn("countFamilyBills failed", familyId, error);
    return 0;
  }
};
// 成员累计记账笔数（不限月份），用于成员卡展示
const countMemberBills = async (familyId, openids) => {
  const counts = {};
  await Promise.all(openids.map(async (openid) => {
    try {
      const result = await db.collection("bills").where({ familyId, deleted: false, memberOpenid: openid }).count();
      counts[openid] = result.total || 0;
    } catch (error) {
      console.warn("countMemberBills failed", familyId, openid, error);
      counts[openid] = 0;
    }
  }));
  return counts;
};

const getOpenid = () => cloud.getWXContext().OPENID;
const normalizeName = (value) => String(value || "").trim().toLocaleLowerCase();
const getStableDocumentId = (...parts) => crypto.createHash("sha256").update(parts.map((item) => String(item || "")).join("\u0000")).digest("hex").slice(0, 24);
const getStableUserId = (openid) => getStableDocumentId("user", openid);
const getStableMembershipId = (familyId, openid) => getStableDocumentId("member", familyId, openid);

// 计算默认账本名称：已有同名账本时依次使用“我的家庭账本 2、3…”
const computeDefaultFamilyName = (usedNames) => {
  const set = new Set(Array.from(usedNames || []).map((item) => String(item).trim().toLowerCase()).filter(Boolean));
  let name = "我的家庭账本";
  let suffix = 2;
  while (set.has(name.toLowerCase())) name = `我的家庭账本 ${suffix++}`;
  return name;
};

// 生成不含易混淆字符的 8 位邀请码（字符集不含 0/1/I/O）
const INVITE_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const generateInviteCode = () => {
  let code = "";
  for (let index = 0; index < 8; index += 1) {
    code += INVITE_CODE_ALPHABET[Math.floor(Math.random() * INVITE_CODE_ALPHABET.length)];
  }
  return code;
};

const fail = (message, errorCode = "BAD_REQUEST") => ({
  success: false,
  errorCode,
  message
});

const writeOperationLog = async (familyId, action, targetId, summary = {}) => {
  try { await db.collection("operation_logs").add({ data: { familyId, action, targetId, operatorOpenId: getOpenid(), summary, createdAt: new Date() } }); }
  catch (error) { console.warn("写入操作记录失败", error); }
};

const addOperationLogInTransaction = (transaction, familyId, action, targetId, summary = {}) => transaction.collection("operation_logs").add({
  data: { familyId, action, targetId, operatorOpenId: getOpenid(), summary, createdAt: new Date() }
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

const getUsersByOpenid = async (openid) => {
  const result = await db.collection("users").where({ openid }).limit(20).get();
  return result.data;
};

const getUser = async (openid) => {
  const stableId = getStableUserId(openid);
  try {
    const result = await db.collection("users").doc(stableId).get();
    if (result.data?.openid === openid) return result.data;
  } catch (error) {
    // 遗留用户记录可能使用随机文档 ID，继续按 openid 查询。
  }
  const users = await getUsersByOpenid(openid);
  return users[0] || null;
};

const ensureUser = async (profile = {}) => {
  const openid = getOpenid();
  const userId = getStableUserId(openid);
  const existingRecords = await getUsersByOpenid(openid);
  const existing = existingRecords.find((item) => item._id === userId) || existingRecords[0] || null;
  const now = new Date();
  const userData = {
    openid,
    nickName: String(profile.nickName || existing?.nickName || "微信用户").slice(0, 32),
    avatarUrl: String(profile.avatarUrl || existing?.avatarUrl || ""),
    registered: profile.registered === true || existing?.registered === true,
    updatedAt: now
  };
  if (profile.registered === true && !existing?.registered) userData.registeredAt = now;
  const createdAt = existing?.createdAt || now;
  // 所有并发登录最终写入同一确定性文档；遗留随机 ID 记录只在新文档落库后清理。
  await db.collection("users").doc(userId).set({ data: { ...userData, createdAt } });
  const duplicates = existingRecords.filter((item) => item._id !== userId);
  await Promise.all(duplicates.map(async (item) => {
    try {
      await db.collection("users").doc(item._id).remove();
    } catch (error) {
      console.warn("清理重复用户记录失败", error);
    }
  }));
  return { _id: userId, ...userData, createdAt };
};

const toClientUser = (user) => {
  if (!user) return null;
  return { nickName: user.nickName || "微信用户", avatarUrl: user.avatarUrl || "" };
};

// 是否已完成显式登录授权：仅 login 动作会把 registered 置为 true
const isRegisteredUser = (user) => Boolean(user && user.registered === true);

const getLoginState = async () => {
  const user = await getUser(getOpenid());
  const loggedIn = isRegisteredUser(user);
  return {
    success: true,
    loggedIn,
    // 未登录时也返回历史资料，便于登录页预填昵称和头像
    user: user ? toClientUser(user) : null
  };
};

// 显式登录：写入用户资料并标记登录态，同步刷新各账本成员展示信息
const login = async (event) => {
  const user = await ensureUser({ nickName: event.nickName, avatarUrl: event.avatarUrl, registered: true });
  const memberships = await db.collection("family_members").where({ openid: user.openid, status: "active" }).get();
  await Promise.all(memberships.data.map((member) => db.collection("family_members").doc(member._id).update({
    data: { nickName: user.nickName, avatarUrl: user.avatarUrl, updatedAt: new Date() }
  })));
  return { success: true, user: toClientUser(user) };
};

const toClientMember = (member) => ({
  memberId: member._id,
  nickName: member.nickName || "微信用户",
  avatarUrl: member.avatarUrl || "",
  role: member.role,
  joinedAt: member.joinedAt
});

const getFamilyMembers = async (familyId, status) => {
  const where = { familyId };
  if (status) where.status = status;
  const result = await db.collection("family_members").where(where).limit(FAMILY_MEMBER_QUERY_LIMIT).get();
  const byOpenid = new Map();
  result.data.forEach((member) => {
    const current = byOpenid.get(member.openid);
    if (!current || compareMembership(member, current) < 0) byOpenid.set(member.openid, member);
  });
  return Array.from(byOpenid.values());
};

const rankMembership = (member) => {
  const roleRank = member.role === "admin" ? 0 : 1;
  const statusRank = member.status === "active" ? 0 : 1;
  const stableRank = member._id === getStableMembershipId(member.familyId, member.openid) ? 0 : 1;
  const joinedAt = new Date(member.joinedAt || 0).getTime();
  return [statusRank, roleRank, stableRank, -joinedAt, String(member._id || "")];
};

const compareMembership = (left, right) => {
  const a = rankMembership(left);
  const b = rankMembership(right);
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] < b[index]) return -1;
    if (a[index] > b[index]) return 1;
  }
  return 0;
};

const getMembershipsByOpenid = async (openid) => {
  const memberships = [];
  let offset = 0;
  while (true) {
    const result = await db.collection("family_members").where({ openid }).skip(offset).limit(FAMILY_MEMBER_QUERY_LIMIT).get();
    memberships.push(...result.data);
    if (result.data.length < FAMILY_MEMBER_QUERY_LIMIT) return memberships;
    offset += result.data.length;
  }
};

const getFamilyMemberById = async (familyId, memberId) => {
  if (!familyId || !memberId) return null;
  try {
    const result = await db.collection("family_members").doc(memberId).get();
    return result.data?.familyId === familyId ? result.data : null;
  } catch (error) {
    return null;
  }
};

const initializationLockId = (openid) => getStableUserId(openid);
const claimDefaultFamilyInitialization = async (openid, forceNewFamily = false) => {
  const lockId = initializationLockId(openid);
  const now = Date.now();
  return db.runTransaction(async (transaction) => {
    const lockRef = transaction.collection("initialization_locks").doc(lockId);
    let lock = null;
    try {
      lock = (await lockRef.get()).data;
    } catch (error) {
      // 首次初始化时锁文档不存在，继续声明锁。
    }
    if (!forceNewFamily && lock && lock.state === "complete" && lock.familyId) return { state: "complete", familyId: lock.familyId };
    if (lock && lock.state === "running" && now - new Date(lock.startedAt || 0).getTime() < 60000) throw new Error("初始化正在进行，请稍后重试");
    const attempt = forceNewFamily ? Number(lock?.attempt || 0) + 1 : Math.max(1, Number(lock?.attempt || 1));
    const familyId = !forceNewFamily && lock?.familyId
      ? lock.familyId
      : getStableDocumentId("default-family", openid, attempt);
    await lockRef.set({ data: { openid, familyId, attempt, state: "running", startedAt: new Date(now), updatedAt: new Date(now) } });
    return { state: "claimed", lockId, familyId };
  });
};

const finishDefaultFamilyInitialization = async (openid, familyId, state = "complete") => {
  const now = new Date();
  const lockRef = db.collection("initialization_locks").doc(initializationLockId(openid));
  try {
    await lockRef.update({ data: { familyId, state, updatedAt: now, ...(state === "complete" ? { completedAt: now } : {}) } });
  } catch (error) {
    await lockRef.set({ data: { openid, familyId, attempt: 1, state, updatedAt: now, ...(state === "complete" ? { completedAt: now } : {}) } });
  }
};

const getActiveMember = async (familyId, openid) => {
  const family = await getFamilyOrNull(familyId);
  if (!family || family.status === "dissolved") return null;
  const result = await db.collection("family_members").where({
    familyId,
    openid,
    status: "active"
  }).limit(FAMILY_MEMBER_QUERY_LIMIT).get();
  return result.data.sort(compareMembership)[0] || null;
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
  const records = await getMembershipsByOpenid(openid);
  const result = { data: records.filter((item) => item.status === "active") };
  const valid = [];
  const canonicalByFamily = new Map();
  result.data.forEach((member) => {
    const current = canonicalByFamily.get(member.familyId);
    if (!current || compareMembership(member, current) < 0) canonicalByFamily.set(member.familyId, member);
  });
  for (const member of canonicalByFamily.values()) {
    const family = await getFamilyOrNull(member.familyId);
    if (family && family.status !== "dissolved") {
      valid.push({ member, family });
    } else {
      await db.collection("family_members").doc(member._id).update({
        data: { status: family?.status === "dissolved" ? "dissolved" : "invalid", updatedAt: new Date() }
      });
    }
  }
  return valid;
};

const createInviteCode = async () => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateInviteCode();
    const existing = await db.collection("family_invites").where({ code, status: "active" }).limit(1).get();
    if (!existing.data.length) return code;
  }
  throw new Error("邀请码生成失败，请重试");
};

const ensureInitialFamilyInvite = async (familyId, creatorOpenid) => {
  const family = await getFamily(familyId);
  if (family.initialInviteInitialized) return;
  const existing = await db.collection("family_invites").where({ familyId }).limit(1).get();
  if (!existing.data.length) {
    const now = new Date();
    const code = await createInviteCode();
    const inviteId = getStableDocumentId("initial-invite", familyId);
    await db.collection("family_invites").doc(inviteId).set({
      data: { familyId, code, status: "active", createdBy: creatorOpenid, createdAt: now, expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000) }
    });
  }
  await db.collection("families").doc(familyId).update({ data: { initialInviteInitialized: true, updatedAt: new Date() } });
};

const initUser = async (event) => {
  // 静默登录：用微信 openid 自动建号，不要求用户授权头像昵称
  const user = await ensureUser();
  const pendingInviteCode = String(event.inviteCode || "").trim().toUpperCase();
  if (pendingInviteCode) {
    try {
      const invite = await getValidInvite(pendingInviteCode);
      const family = await getFamily(invite.familyId);
      const members = await getFamilyMembers(invite.familyId, "active");
      const admin = members.find((item) => item.role === "admin");
      const existing = members.find((item) => item.openid === user.openid);
      if (!existing && members.length >= MAX_FAMILY_MEMBERS) throw new Error("该账本成员已达上限");
      return {
        success: true,
        loggedIn: true,
        user: toClientUser(user),
        family: null,
        pendingInvite: {
          code: pendingInviteCode,
          familyName: family.name,
          adminName: admin?.nickName || "管理员",
          adminAvatar: admin?.avatarUrl || "",
          memberPreviews: members
            .filter((m) => m.openid !== user.openid)
            .slice(0, 3)
            .map((m) => ({ nickName: m.nickName || "微信用户", avatarUrl: m.avatarUrl || "" })),
          memberCount: members.length,
          totalBillCount: await countFamilyBills(invite.familyId),
          alreadyMember: Boolean(existing)
        }
      };
    } catch (error) {
      console.warn("启动邀请码无效，等待客户端处理下一条邀请", error.message);
      return {
        success: true,
        loggedIn: true,
        user: toClientUser(user),
        family: null,
        invalidInvite: {
          code: pendingInviteCode,
          message: error.message || "邀请码无效或已过期"
        }
      };
    }
  }
  const memberships = await getValidMemberships(user.openid);
  let family;
  if (memberships.length) {
    const preferred = memberships.find((item) => item.member.familyId === event.currentFamilyId) || memberships[0];
    await ensureFamilySeedData(preferred.family._id);
    const activeMembers = await getFamilyMembers(preferred.family._id, "active");
    const admin = activeMembers.find((item) => item.role === "admin");
    family = { id: preferred.family._id, name: preferred.family.name, role: preferred.member.role, memberId: preferred.member._id, isOwner: preferred.family.adminOpenid === user.openid, adminName: admin?.nickName || "管理员", membershipRevision: Number(preferred.family.membershipRevision || 0), created: false };
  } else {
    const claim = await claimDefaultFamilyInitialization(user.openid);
    if (claim.state === "complete") {
      const claimedFamily = await getFamilyOrNull(claim.familyId);
      const claimedMember = claimedFamily && await getActiveMember(claim.familyId, user.openid);
      if (claimedFamily && claimedFamily.status !== "dissolved" && claimedMember) {
        await ensureFamilySeedData(claimedFamily._id);
        const claimedActiveMembers = await getFamilyMembers(claim.familyId, "active");
        const claimedAdmin = claimedActiveMembers.find((item) => item.role === "admin");
        family = { id: claimedFamily._id, name: claimedFamily.name, role: claimedMember.role, memberId: claimedMember._id, isOwner: claimedFamily.adminOpenid === user.openid, adminName: claimedAdmin?.nickName || "管理员", membershipRevision: Number(claimedFamily.membershipRevision || 0), created: false };
      } else {
        const canRepairClaimedFamily = !claimedFamily || (claimedFamily.status !== "dissolved" && claimedFamily.adminOpenid === user.openid);
        await finishDefaultFamilyInitialization(user.openid, claim.familyId, "failed");
        const retryClaim = await claimDefaultFamilyInitialization(user.openid, !canRepairClaimedFamily);
        if (retryClaim.state !== "claimed") throw new Error("初始化正在进行，请稍后重试");
        family = await createDefaultFamily(user, retryClaim.familyId);
        await finishDefaultFamilyInitialization(user.openid, family.id, "complete");
      }
    } else {
      family = await createDefaultFamily(user, claim.familyId);
      await finishDefaultFamilyInitialization(user.openid, family.id, "complete");
    }
  }
  return { success: true, loggedIn: true, user: toClientUser(user), family };
};

const listFamilies = async () => {
  const openid = getOpenid();
  const memberships = await getValidMemberships(openid);
  const families = await Promise.all(memberships.map(async ({ member, family }) => {
    const activeMembers = await getFamilyMembers(family._id, "active");
    const admin = activeMembers.find((item) => item.role === "admin");
    const isOwner = family.adminOpenid === openid;
    const totalBillCount = await countFamilyBills(family._id);
    return {
      id: family._id,
      name: family.name,
      memberCount: activeMembers.length,
      role: member.role,
      adminName: admin?.nickName || "管理员",
      isOwner,
      totalBillCount,
      maxMemberCount: MAX_FAMILY_MEMBERS,
      createdAt: family.createdAt
    };
  }));
  // 可还原账本：已解散但在 30 天保留期内，仅原管理员可见
  const now = new Date();
  const dissolvedResult = await db.collection("families")
    .where({ adminOpenid: openid, status: "dissolved" })
    .orderBy("dissolvedAt", "desc")
    .limit(20)
    .get();
  const recoverableFamilies = dissolvedResult.data
    .filter((f) => !f.deleteAfter || new Date(f.deleteAfter) > now)
    .map((f) => ({
      id: f._id,
      name: f.name,
      deleteAfter: f.deleteAfter,
      dissolvedAt: f.dissolvedAt,
      daysRemaining: f.deleteAfter ? Math.max(0, Math.ceil((new Date(f.deleteAfter) - now) / 86400000)) : DISSOLVE_RETENTION_DAYS
    }));
  return { success: true, families, recoverableFamilies };
};

const createFamily = async (event) => {
  const name = String(event.name || "").trim();
  if (!name || name.length > 30) throw new Error("账本名称需为 1 到 30 个字符");
  const user = await ensureUser(event.profile);
  const memberships = await getValidMemberships(user.openid);
  if (memberships.some((item) => String(item.family.name || "").trim().toLowerCase() === name.toLowerCase())) throw new Error("账本名称已存在");
  const now = new Date();
  const familyResult = await db.collection("families").add({
    data: {
      name,
      adminOpenid: user.openid,
      activeMemberCount: 1,
      membershipRevision: 1,
      seedVersion: 0,
      initialInviteInitialized: false,
      createdAt: now,
      updatedAt: now
    }
  });
  const memberId = getStableMembershipId(familyResult._id, user.openid);
  await db.collection("family_members").doc(memberId).set({
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
  await ensureInitialFamilyInvite(familyResult._id, user.openid);
  await writeOperationLog(familyResult._id, "family.create", familyResult._id, {});
  // 新建账本的创建者即管理员，isOwner / adminName 必须返回，避免前端显示成“成员”
  return { success: true, family: { id: familyResult._id, name, role: "admin", memberId, isOwner: true, adminName: user.nickName || "管理员", created: true } };
};

const renameFamily = async (event) => {
  const admin = await requireAdmin(event.familyId);
  const name = String(event.name || "").trim();
  if (!name || name.length > 30) throw new Error("账本名称需为 1 到 30 个字符");
  const memberships = await getValidMemberships(admin.openid);
  if (memberships.some((item) => item.family._id !== event.familyId && String(item.family.name || "").trim().toLowerCase() === name.toLowerCase())) throw new Error("账本名称已存在");
  await db.collection("families").doc(event.familyId).update({ data: { name, updatedAt: new Date() } });
  await writeOperationLog(event.familyId, "family.rename", event.familyId, { name });
  return { success: true, name };
};

const updateUserProfile = async (event) => {
  const user = await ensureUser({ nickName: event.nickName, avatarUrl: event.avatarUrl, registered: true });
  const memberships = await db.collection("family_members").where({ openid: user.openid, status: "active" }).get();
  await Promise.all(memberships.data.map((member) => db.collection("family_members").doc(member._id).update({ data: { nickName: user.nickName, avatarUrl: user.avatarUrl, updatedAt: new Date() } })));
  await Promise.all(memberships.data.map((member) => writeOperationLog(member.familyId, "user.profile.update", user.openid, {})));
  return { success: true, user: toClientUser(user) };
};

const initFamilyCategoriesAndAccounts = async (familyId) => {
  const now = new Date();
  const categories = [...BASELINE_EXPENSE_CATEGORIES.map((item) => ({ ...item, type: "expense" })), ...BASELINE_INCOME_CATEGORIES.map((item) => ({ ...item, type: "income" }))];
  const categoryResult = await db.collection("categories").where({ familyId }).limit(1000).get();
  const categoryDocuments = categoryResult.data.slice();
  for (const category of categories) {
    let parent = categoryDocuments.find((item) => !item.parentId && item.type === category.type && normalizeName(item.name) === normalizeName(category.name));
    if (!parent) {
      const parentId = getStableDocumentId("seed-category", familyId, category.type, category.name);
      parent = { _id: parentId, familyId, name: category.name, icon: category.icon, type: category.type, parentId: null, enabled: true, createTime: now, updatedAt: now };
      await db.collection("categories").doc(parentId).set({ data: { familyId, name: category.name, icon: category.icon, type: category.type, parentId: null, enabled: true, createTime: now, updatedAt: now } });
      categoryDocuments.push(parent);
    }
    for (const child of category.children) {
      const exists = categoryDocuments.some((item) => item.parentId === parent._id && item.type === category.type && normalizeName(item.name) === normalizeName(child.name));
      if (exists) continue;
      const childId = getStableDocumentId("seed-category-child", familyId, category.type, category.name, child.name);
      const childData = { _id: childId, familyId, name: child.name, icon: child.icon, type: category.type, parentId: parent._id, enabled: true, createTime: now, updatedAt: now };
      await db.collection("categories").doc(childId).set({ data: { familyId, name: child.name, icon: child.icon, type: category.type, parentId: parent._id, enabled: true, createTime: now, updatedAt: now } });
      categoryDocuments.push(childData);
    }
  }
  const accountResult = await db.collection("accounts").where({ familyId }).limit(100).get();
  const existingAccountNames = new Set(accountResult.data.map((item) => normalizeName(item.name)));
  for (const name of DEFAULT_ACCOUNTS) {
    if (existingAccountNames.has(normalizeName(name))) continue;
    const accountId = getStableDocumentId("seed-account", familyId, name);
    await db.collection("accounts").doc(accountId).set({ data: { familyId, name, enabled: true, createTime: now, updatedAt: now } });
    existingAccountNames.add(normalizeName(name));
  }
  await db.collection("families").doc(familyId).update({ data: { seedVersion: DEFAULT_SEED_VERSION, seedCompletedAt: new Date(), updatedAt: new Date() } });
};

const getFamilyDetail = async (event) => {
  const openid = getOpenid();
  const member = await getActiveMember(event.familyId, openid);
  if (!member) throw new Error("你不是该家庭成员");
  const family = await getFamily(event.familyId);
  const members = await getFamilyMembers(event.familyId, "active");
  const admin = members.find((item) => item.role === "admin");
  const [totalBillCount, billCounts] = await Promise.all([
    countFamilyBills(family._id),
    countMemberBills(family._id, members.map((item) => item.openid))
  ]);
  return {
    success: true,
    family: {
      id: family._id,
      name: family.name,
      role: member.role,
      memberId: member._id,
      isOwner: family.adminOpenid === openid,
      adminName: admin?.nickName || "管理员",
      memberCount: members.length,
      maxMemberCount: MAX_FAMILY_MEMBERS,
      totalBillCount,
      membershipRevision: Number(family.membershipRevision || 0)
    },
    role: member.role,
    members: members.map((item) => ({ ...toClientMember(item), billCount: billCounts[item.openid] || 0 }))
  };
};

// 幂等读取当前账本的有效邀请码：有则复用，仅在缺失或已过期时才新建。
// 只读当前有效邀请码，不自动创建新码。过期/撤销后由管理员在前端手动生成。
const getFamilyInvite = async (event) => {
  await requireAdmin(event.familyId);
  const now = Date.now();
  const existing = await db.collection("family_invites")
    .where({ familyId: event.familyId, status: "active" })
    .limit(FAMILY_MEMBER_QUERY_LIMIT)
    .get();
  const valid = existing.data
    .filter((invite) => new Date(invite.expiresAt).getTime() > now)
    .sort((left, right) => new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime())[0];
  if (valid) return { success: true, code: valid.code, expiresAt: valid.expiresAt, hasValid: true };
  // 找到最近一条 active 但已过期的记录，用于前端展示过期状态
  const latest = existing.data
    .sort((left, right) => new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime())[0];
  return { success: true, code: "", expiresAt: latest ? latest.expiresAt : null, hasValid: false };
};

// 轻量版本探测：只读账本文档与自己的成员记录，供客户端判断角色/成员关系是否变化。
// 相比 getFamilyDetail（要拉全部成员 + 两次账单 count）开销极小，可在页面 onShow 频繁调用。
const getFamilyRevision = async (event) => {
  const openid = getOpenid();
  const family = await getFamilyOrNull(event.familyId);
  if (!family || family.status === "dissolved") return { success: true, exists: false, membershipRevision: 0 };
  const member = await getActiveMember(event.familyId, openid);
  if (!member) return { success: true, exists: false, membershipRevision: Number(family.membershipRevision || 0) };
  return {
    success: true,
    exists: true,
    membershipRevision: Number(family.membershipRevision || 0),
    role: member.role,
    isOwner: family.adminOpenid === openid
  };
};

const createInvite = async (event) => {
  await requireAdmin(event.familyId);
  await db.collection("family_invites").where({ familyId: event.familyId, status: "active" }).update({ data: { status: "revoked", revokedAt: new Date() } });
  const code = await createInviteCode();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  await db.collection("family_invites").add({
    data: { familyId: event.familyId, code, status: "active", createdBy: getOpenid(), createdAt: now, expiresAt }
  });
  await writeOperationLog(event.familyId, "invite.create", event.familyId, {});
  return { success: true, code, expiresAt };
};

const revokeInvite = async (event) => {
  await requireAdmin(event.familyId);
  const result = await db.collection("family_invites").where({ familyId: event.familyId, status: "active" }).update({ data: { status: "revoked", revokedAt: new Date() } });
  if (!result.stats?.updated) throw new Error("当前没有可撤销的邀请码");
  await writeOperationLog(event.familyId, "invite.revoke", event.familyId, {});
  return { success: true };
};

const getInviteQrcode = async (event) => {
  await requireAdmin(event.familyId);
  const envVersion = ["develop", "trial", "release"].includes(event.envVersion) ? event.envVersion : "release";
  const now = Date.now();
  const existing = await db.collection("family_invites")
    .where({ familyId: event.familyId, status: "active" })
    .limit(FAMILY_MEMBER_QUERY_LIMIT)
    .get();
  const valid = existing.data
    .filter((invite) => new Date(invite.expiresAt).getTime() > now)
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())[0];
  if (!valid) throw new Error("没有有效的邀请码，请先生成");

  const code = valid.code;
  const fileIdField = "qrcodeFileId_" + envVersion;
  if (valid[fileIdField]) return { success: true, fileId: valid[fileIdField], code };

  const qrResult = await cloud.openapi.wxacode.getUnlimited({
    scene: "i=" + code,
    page: "pages/index/index",
    checkPath: false,
    width: 430,
    envVersion
  });
  const upload = await cloud.uploadFile({
    cloudPath: "qrcodes/invite-" + code + "-" + envVersion + ".png",
    fileContent: qrResult.buffer
  });
  await db.collection("family_invites").doc(valid._id).update({ data: { [fileIdField]: upload.fileID } });
  return { success: true, fileId: upload.fileID, code };
};

const getValidInvite = async (code) => {
  const inviteResult = await db.collection("family_invites").where({ code, status: "active" }).limit(1).get();
  const invite = inviteResult.data[0];
  if (!invite || new Date(invite.expiresAt).getTime() < Date.now()) throw new Error("邀请码无效或已过期");
  const family = await getFamilyOrNull(invite.familyId);
  if (!family || family.status === "dissolved") throw new Error("该账本已解散，邀请码已失效");
  return invite;
};

const verifyInvite = async (event) => {
  const code = String(event.code || "").trim().toUpperCase();
  if (!code) throw new Error("请输入邀请码");
  const invite = await getValidInvite(code);
  const family = await getFamily(invite.familyId);
  const members = await getFamilyMembers(invite.familyId, "active");
  const existing = members.find((item) => item.openid === getOpenid());
  const admin = members.find((item) => item.role === "admin");
  if (!existing && members.length >= MAX_FAMILY_MEMBERS) throw new Error("该账本成员已达上限");
  // 客户端只需要确认信息，不返回 familyId，避免邀请码流程泄露内部账本标识。
  // isCurrentFamily 仅比对客户端自报的当前账本，用于提示「这就是你正在用的账本」，不泄露额外信息。
  return {
    success: true,
    invite: {
      code,
      familyName: family.name,
      adminName: admin?.nickName || "管理员",
      memberCount: members.length,
      alreadyMember: Boolean(existing),
      isCurrentFamily: Boolean(event.currentFamilyId) && String(event.currentFamilyId) === String(invite.familyId)
    }
  };
};

const confirmJoinFamily = async (event) => {
  const code = String(event.code || "").trim().toUpperCase();
  if (!code) throw new Error("请输入邀请码");
  const invite = await getValidInvite(code);
  const user = await ensureUser(event.profile);
  const now = new Date();
  const joined = await db.runTransaction(async (transaction) => {
    const inviteInTransaction = (await transaction.collection("family_invites").doc(invite._id).get()).data;
    if (!inviteInTransaction || inviteInTransaction.code !== code || inviteInTransaction.status !== "active" || new Date(inviteInTransaction.expiresAt).getTime() < now.getTime()) {
      throw new Error("邀请码无效或已过期");
    }
    const family = (await transaction.collection("families").doc(inviteInTransaction.familyId).get()).data;
    if (!family || family.status === "dissolved") throw new Error("该账本已解散，邀请码已失效");

    const activeResult = await transaction.collection("family_members").where({ familyId: family._id, status: "active" }).limit(FAMILY_MEMBER_QUERY_LIMIT).get();
    const ownResult = await transaction.collection("family_members").where({ familyId: family._id, openid: user.openid }).limit(20).get();
    const activeOwnRecords = ownResult.data.filter((item) => item.status === "active").sort(compareMembership);
    if (activeOwnRecords.length) {
      const current = activeOwnRecords[0];
      await transaction.collection("family_members").doc(current._id).update({ data: { nickName: user.nickName, avatarUrl: user.avatarUrl, updatedAt: now } });
      for (const duplicate of activeOwnRecords.slice(1)) {
        await transaction.collection("family_members").doc(duplicate._id).update({ data: { status: "superseded", leftAt: now, updatedAt: now } });
      }
      if (activeOwnRecords.length > 1) {
        await transaction.collection("families").doc(family._id).update({ data: { membershipRevision: Number(family.membershipRevision || 0) + 1, updatedAt: now } });
      }
      return { familyId: family._id, familyName: family.name, memberId: current._id, role: current.role, alreadyMember: true, created: false };
    }

    const reusableRecords = ownResult.data.filter((item) => item.status !== "cancelled");
    const previous = reusableRecords.slice().sort((left, right) => {
      const rightTime = new Date(right.leftAt || right.updatedAt || right.joinedAt || 0).getTime();
      const leftTime = new Date(left.leftAt || left.updatedAt || left.joinedAt || 0).getTime();
      if (rightTime !== leftTime) return rightTime - leftTime;
      const leftStable = left._id === getStableMembershipId(family._id, user.openid);
      const rightStable = right._id === getStableMembershipId(family._id, user.openid);
      return Number(rightStable) - Number(leftStable);
    })[0];
    const activeOpenids = new Set(activeResult.data.map((item) => item.openid));
    if (activeOpenids.size >= MAX_FAMILY_MEMBERS) throw new Error("该账本成员已达上限");

    const memberId = previous?._id || (ownResult.data.some((item) => item.status === "cancelled")
      ? getStableDocumentId("member-rejoin", family._id, user.openid, inviteInTransaction._id)
      : getStableMembershipId(family._id, user.openid));
    const memberData = {
      familyId: family._id,
      openid: user.openid,
      nickName: user.nickName,
      avatarUrl: user.avatarUrl,
      role: "member",
      status: "active",
      joinedAt: now,
      leftAt: null,
      updatedAt: now
    };
    if (previous) await transaction.collection("family_members").doc(memberId).update({ data: memberData });
    else await transaction.collection("family_members").doc(memberId).set({ data: memberData });
    await transaction.collection("families").doc(family._id).update({
      data: { activeMemberCount: activeOpenids.size + 1, membershipRevision: Number(family.membershipRevision || 0) + 1, updatedAt: now }
    });
    return { familyId: family._id, familyName: family.name, memberId, role: "member", alreadyMember: false, created: true };
  });
  if (joined.created) await writeOperationLog(joined.familyId, "member.join", joined.memberId, {});
  return {
    success: true,
    family: { id: joined.familyId, name: joined.familyName, role: joined.role, memberId: joined.memberId },
    alreadyMember: joined.alreadyMember
  };
};

const removeMember = async (event) => {
  const openid = getOpenid();
  const now = new Date();
  const removedMemberId = await db.runTransaction(async (transaction) => {
    const family = (await transaction.collection("families").doc(event.familyId).get()).data;
    if (!family || family.status === "dissolved" || family.adminOpenid !== openid) throw new Error("只有管理员可以执行此操作");
    const admins = await transaction.collection("family_members").where({ familyId: event.familyId, openid, status: "active", role: "admin" }).limit(20).get();
    if (!admins.data.length) throw new Error("只有管理员可以执行此操作");
    const member = (await transaction.collection("family_members").doc(event.memberId).get()).data;
    if (!member || member.familyId !== event.familyId || member.status !== "active") throw new Error("成员不存在");
    if (member.openid === openid || member.role === "admin") throw new Error("管理员不能移除自己");
    const activeMembers = await transaction.collection("family_members").where({ familyId: event.familyId, status: "active" }).limit(FAMILY_MEMBER_QUERY_LIMIT).get();
    const activeOpenids = new Set(activeMembers.data.map((item) => item.openid));
    const targetRecords = activeMembers.data.filter((item) => item.openid === member.openid);
    for (const record of targetRecords) {
      await transaction.collection("family_members").doc(record._id).update({ data: { status: "left", leftAt: now, updatedAt: now } });
    }
    await transaction.collection("families").doc(event.familyId).update({
      data: { activeMemberCount: Math.max(1, activeOpenids.size - 1), membershipRevision: Number(family.membershipRevision || 0) + 1, updatedAt: now }
    });
    return member._id;
  });
  await writeOperationLog(event.familyId, "member.remove", removedMemberId, {});
  return { success: true };
};

const leaveFamily = async (event) => {
  const openid = getOpenid();
  const memberships = await getValidMemberships(openid);
  if (memberships.length === 1 && memberships[0].family._id === event.familyId) {
    throw new Error("你至少需要保留一个账本，无法退出唯一的账本");
  }
  const now = new Date();
  const memberId = await db.runTransaction(async (transaction) => {
    const family = (await transaction.collection("families").doc(event.familyId).get()).data;
    if (!family || family.status === "dissolved") throw new Error("你不是该家庭成员");
    const ownMembers = await transaction.collection("family_members").where({ familyId: event.familyId, openid, status: "active" }).limit(20).get();
    const member = ownMembers.data.sort(compareMembership)[0];
    if (!member) throw new Error("你不是该家庭成员");
    if (member.role === "admin" || family.adminOpenid === openid) throw new Error("管理员请先转让管理权或处理账本");
    const activeMembers = await transaction.collection("family_members").where({ familyId: event.familyId, status: "active" }).limit(FAMILY_MEMBER_QUERY_LIMIT).get();
    const activeOpenids = new Set(activeMembers.data.map((item) => item.openid));
    for (const record of ownMembers.data) {
      await transaction.collection("family_members").doc(record._id).update({ data: { status: "left", leftAt: now, updatedAt: now } });
    }
    await transaction.collection("families").doc(event.familyId).update({
      data: { activeMemberCount: Math.max(1, activeOpenids.size - 1), membershipRevision: Number(family.membershipRevision || 0) + 1, updatedAt: now }
    });
    return member._id;
  });
  await writeOperationLog(event.familyId, "member.leave", memberId, {});
  return { success: true };
};

const transferAdmin = async (event) => {
  const openid = getOpenid();
  const now = new Date();
  const targetMemberId = await db.runTransaction(async (transaction) => {
    const family = (await transaction.collection("families").doc(event.familyId).get()).data;
    if (!family || family.status === "dissolved" || family.adminOpenid !== openid) throw new Error("只有管理员可以执行此操作");
    const currentRecords = await transaction.collection("family_members").where({ familyId: event.familyId, openid, status: "active" }).limit(20).get();
    const currentAdmin = currentRecords.data.find((item) => item.role === "admin");
    if (!currentAdmin) throw new Error("只有管理员可以执行此操作");
    const target = (await transaction.collection("family_members").doc(event.memberId).get()).data;
    if (!target || target.familyId !== event.familyId || target.status !== "active" || target.role !== "member" || target.openid === openid) throw new Error("请选择其他普通成员");
    const activeMembers = await transaction.collection("family_members").where({ familyId: event.familyId, status: "active" }).limit(FAMILY_MEMBER_QUERY_LIMIT).get();
    const admins = activeMembers.data.filter((item) => item.role === "admin");
    if (admins.length !== 1 || admins[0]._id !== currentAdmin._id) throw new Error("管理员状态异常，请刷新后重试");
    await transaction.collection("family_members").doc(currentAdmin._id).update({ data: { role: "member", updatedAt: now } });
    await transaction.collection("family_members").doc(target._id).update({ data: { role: "admin", updatedAt: now } });
    await transaction.collection("families").doc(event.familyId).update({ data: { adminOpenid: target.openid, membershipRevision: Number(family.membershipRevision || 0) + 1, updatedAt: now } });
    return target._id;
  });
  await writeOperationLog(event.familyId, "member.transfer_admin", targetMemberId, {});
  return { success: true };
};

const getAccountCancellationStatus = async () => {
  const openid = getOpenid();
  const memberships = await getValidMemberships(openid);
  const adminFamilies = await Promise.all(memberships.filter((item) => item.member.role === "admin").map(async ({ family }) => {
    const activeMembers = await getFamilyMembers(family._id, "active");
    return { id: family._id, name: family.name, memberCount: activeMembers.length, canDissolve: true };
  }));
  return { success: true, canCancel: adminFamilies.length === 0, adminFamilies };
};

const dissolveFamily = async (event) => {
  const openid = getOpenid();
  // 注销流程会批量解散管理员账本，此时允许解散最后一个账本（注销后会重新建号）
  if (!event.forceLastFamily) {
    const memberships = await getValidMemberships(openid);
    if (memberships.length === 1 && memberships[0].family._id === event.familyId) {
      throw new Error("你至少需要保留一个账本，无法解散唯一的账本");
    }
  }
  const now = new Date();
  const deleteAfter = new Date(now.getTime() + DISSOLVE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const result = await db.runTransaction(async (transaction) => {
    const familyResult = await transaction.collection("families").doc(event.familyId).get();
    const family = familyResult.data;
    if (!family) throw new Error("账本不存在");
    const members = await transaction.collection("family_members").where({ familyId: event.familyId, status: "active" }).limit(FAMILY_MEMBER_QUERY_LIMIT).get();
    const ownAdmin = members.data.find((item) => item.openid === openid && item.role === "admin");
    if (!ownAdmin && family.status !== "dissolved") throw new Error("只有管理员可以解散账本");
    if (family.status === "dissolved") return { alreadyDissolved: true };
    const activeInvites = await transaction.collection("family_invites").where({ familyId: event.familyId, status: "active" }).limit(FAMILY_MEMBER_QUERY_LIMIT).get();
    await Promise.all(activeInvites.data.map((invite) => transaction.collection("family_invites").doc(invite._id).update({ data: { status: "revoked", revokedAt: now } })));
    await Promise.all(members.data.map((member) => transaction.collection("family_members").doc(member._id).update({ data: { status: "dissolved", dissolvedAt: now, updatedAt: now } })));
    await transaction.collection("families").doc(event.familyId).update({ data: { status: "dissolved", dissolvedAt: now, deleteAfter, dissolvedBy: openid, activeMemberCount: 0, membershipRevision: Number(family.membershipRevision || 0) + 1, updatedAt: now } });
    const existingLog = await transaction.collection("operation_logs").where({ familyId: event.familyId, action: "family.dissolve", targetId: event.familyId }).limit(1).get();
    if (!existingLog.data.length) await addOperationLogInTransaction(transaction, event.familyId, "family.dissolve", event.familyId, { deleteAfter, memberCount: members.data.length });
    return { alreadyDissolved: false };
  });
  return { success: true, alreadyDissolved: result.alreadyDissolved };
};

const restoreFamily = async (event) => {
  const openid = getOpenid();
  const now = new Date();
  const family = await getFamilyOrNull(event.familyId);
  if (!family) throw new Error("账本不存在");
  if (family.status !== "dissolved") throw new Error("账本未处于解散状态");
  if (family.adminOpenid !== openid) throw new Error("只有原管理员可以还原账本");
  if (family.deleteAfter && new Date(family.deleteAfter) < now) throw new Error("账本已过保留期，无法还原");

  await db.runTransaction(async (transaction) => {
    const memberResult = await transaction.collection("family_members")
      .where({ familyId: event.familyId, openid, role: "admin" })
      .limit(FAMILY_MEMBER_QUERY_LIMIT).get();
    const adminMember = memberResult.data.sort((a, b) => new Date(b.joinedAt || 0) - new Date(a.joinedAt || 0))[0];
    if (!adminMember) throw new Error("管理员关系丢失，无法还原");
    await transaction.collection("family_members").doc(adminMember._id).update({
      data: { status: "active", dissolvedAt: db.command.remove(), updatedAt: now }
    });
    await transaction.collection("families").doc(event.familyId).update({
      data: {
        status: "active",
        dissolvedAt: db.command.remove(),
        deleteAfter: db.command.remove(),
        dissolvedBy: db.command.remove(),
        activeMemberCount: 1,
        membershipRevision: Number(family.membershipRevision || 0) + 1,
        updatedAt: now
      }
    });
    await addOperationLogInTransaction(transaction, event.familyId, "family.restore", event.familyId, {});
  });
  // 还原后旧邀请码已全部撤销，需要重新生成
  await db.collection("families").doc(event.familyId).update({ data: { initialInviteInitialized: false, updatedAt: now } });
  await ensureInitialFamilyInvite(event.familyId, openid);
  return { success: true };
};

const purgeExpiredFamilies = async () => {
  const now = new Date();
  const expiredResult = await db.collection("families")
    .where({ status: "dissolved", deleteAfter: db.command.lt(now) })
    .limit(100)
    .get();
  const purged = [];
  for (const family of expiredResult.data) {
    const familyId = family._id;
    try {
      await db.runTransaction(async (transaction) => {
        const fresh = await transaction.collection("families").doc(familyId).get();
        if (!fresh.data || fresh.data.status !== "dissolved" || !fresh.data.deleteAfter || new Date(fresh.data.deleteAfter) >= now) return;
        const familyScopedCollections = ["bills", "categories", "accounts", "budgets", "family_invites", "family_members", "operation_logs"];
        for (const colName of familyScopedCollections) {
          let deleted = 0;
          do {
            const batch = await transaction.collection(colName).where({ familyId }).limit(100).get();
            if (!batch.data.length) break;
            await Promise.all(batch.data.map((doc) => transaction.collection(colName).doc(doc._id).remove()));
            deleted = batch.data.length;
          } while (deleted >= 100);
        }
        await transaction.collection("families").doc(familyId).remove();
      });
      purged.push(familyId);
    } catch (error) {
      console.warn("purgeExpiredFamilies: failed to purge", familyId, error);
    }
  }
  return { success: true, purgedCount: purged.length };
};

const cancelAccount = async () => {
  const openid = getOpenid();
  const cancellation = await getAccountCancellationStatus();
  if (!cancellation.canCancel) throw new Error("请先解散你管理的账本");
  const now = new Date();
  const activeMemberships = (await getMembershipsByOpenid(openid)).filter((item) => item.status === "active");
  // 按账本分组：同一账本可能有遗留重复成员记录，需在同一事务内一起处理，
  // 并原子地更新 families.activeMemberCount / membershipRevision（与 leaveFamily 保持一致）。
  const byFamily = new Map();
  for (const member of activeMemberships) {
    if (!byFamily.has(member.familyId)) byFamily.set(member.familyId, []);
    byFamily.get(member.familyId).push(member);
  }
  for (const [familyId, records] of byFamily) {
    await db.runTransaction(async (transaction) => {
      const familyResult = await transaction.collection("families").doc(familyId).get();
      const family = familyResult && familyResult.data;
      if (family && family.status !== "dissolved") {
        const allActive = await transaction.collection("family_members").where({ familyId, status: "active" }).limit(FAMILY_MEMBER_QUERY_LIMIT).get();
        const activeOpenids = new Set(allActive.data.map((item) => item.openid));
        for (const record of records) {
          await transaction.collection("family_members").doc(record._id).update({ data: { status: "cancelled", leftAt: now, nickName: "已注销用户", avatarUrl: "", updatedAt: now } });
        }
        await transaction.collection("families").doc(familyId).update({
          data: { activeMemberCount: Math.max(1, activeOpenids.size - 1), membershipRevision: Number(family.membershipRevision || 0) + 1, updatedAt: now }
        });
      } else {
        for (const record of records) {
          await transaction.collection("family_members").doc(record._id).update({ data: { status: "cancelled", leftAt: now, nickName: "已注销用户", avatarUrl: "", updatedAt: now } });
        }
      }
      const logId = getStableDocumentId("account-cancel-log", familyId, openid);
      await transaction.collection("operation_logs").doc(logId).set({ data: { familyId, action: "user.account.cancel", targetId: records[0]._id, operatorOpenId: openid, summary: {}, createdAt: now } });
    });
  }
  const preferences = await db.collection("bill_preferences").where({ openid }).limit(100).get();
  await Promise.all(preferences.data.map((item) => db.collection("bill_preferences").doc(item._id).remove()));
  const users = await getUsersByOpenid(openid);
  await Promise.all(users.map((user) => db.collection("users").doc(user._id).remove()));
  return { success: true };
};

const main = async (event) => {
  await ensureCollections();
  switch (event.action || event.type) {
    case "getLoginState": return await getLoginState();
    case "login": return await login(event);
    case "initUser": return await initUser(event);
    case "listFamilies": return await listFamilies();
    case "createFamily": return await createFamily(event);
    case "renameFamily": return await renameFamily(event);
    case "updateUserProfile": return await updateUserProfile(event);
    case "getFamilyDetail": return await getFamilyDetail(event);
    case "createInvite": return await createInvite(event);
    case "getFamilyInvite": return await getFamilyInvite(event);
    case "getFamilyRevision": return await getFamilyRevision(event);
    case "revokeInvite": return await revokeInvite(event);
    case "getInviteQrcode": return await getInviteQrcode(event);
    case "verifyInvite": return await verifyInvite(event);
    case "confirmJoinFamily": return await confirmJoinFamily(event);
    case "joinFamily": return await confirmJoinFamily(event);
    case "removeMember": return await removeMember(event);
    case "leaveFamily": return await leaveFamily(event);
    case "transferAdmin": return await transferAdmin(event);
    case "getAccountCancellationStatus": return await getAccountCancellationStatus();
    case "dissolveFamily": return await dissolveFamily(event);
    case "restoreFamily": return await restoreFamily(event);
    case "purgeExpiredFamilies": return await purgeExpiredFamilies();
    case "cancelAccount": return await cancelAccount();
    default: return fail("未知操作", "UNKNOWN_ACTION");
  }
};

exports.main = async (event) => {
  try {
    if (event && event.TriggerName && !event.action && !event.type) {
      let action = "purgeExpiredFamilies";
      try {
        if (event.Message) {
          const msg = typeof event.Message === "string" ? JSON.parse(event.Message) : event.Message;
          if (msg && msg.action) action = msg.action;
        }
      } catch (e) { /* ignore parse error, use default */ }
      if (action === "purgeExpiredFamilies") return await purgeExpiredFamilies();
    }
    return await main(event);
  } catch (error) {
    console.error(error);
    return fail(error.message || "服务器错误", "SERVER_ERROR");
  }
};
const ensureFamilySeedData = async (familyId) => {
  const family = await getFamily(familyId);
  if (Number(family.seedVersion || 0) < DEFAULT_SEED_VERSION) {
    const hasSeedMarker = Object.prototype.hasOwnProperty.call(family, "seedVersion");
    if (hasSeedMarker) {
      await initFamilyCategoriesAndAccounts(familyId);
    } else {
      const categoryCount = await db.collection("categories").where({ familyId }).count();
      const accountCount = await db.collection("accounts").where({ familyId }).count();
      if (categoryCount.total === 0 || accountCount.total === 0) await initFamilyCategoriesAndAccounts(familyId);
      else await db.collection("families").doc(familyId).update({ data: { seedVersion: DEFAULT_SEED_VERSION, seedMigratedAt: new Date(), updatedAt: new Date() } });
    }
  }
  if (family.adminOpenid === getOpenid()) await ensureInitialFamilyInvite(familyId, family.adminOpenid);
};

const createDefaultFamily = async (user, requestedFamilyId = "") => {
  const members = { data: (await getMembershipsByOpenid(user.openid)).filter((item) => item.status === "active") };
  const usedNames = new Set();
  for (const item of members.data) {
    const family = await getFamily(item.familyId);
    if (family && family.name) usedNames.add(String(family.name).trim().toLowerCase());
  }
  const name = computeDefaultFamilyName(usedNames);
  const now = new Date();
  const familyId = requestedFamilyId || getStableDocumentId("default-family", user.openid, 1);
  const familyRef = db.collection("families").doc(familyId);
  let family = await getFamilyOrNull(familyId);
  if (!family) {
    await familyRef.set({ data: { name, adminOpenid: user.openid, activeMemberCount: 1, membershipRevision: 1, seedVersion: 0, initialInviteInitialized: false, createdAt: now, updatedAt: now } });
    family = { _id: familyId, name, adminOpenid: user.openid };
  }
  if (family.status === "dissolved") throw new Error("默认账本初始化状态无效，请重试");
  if (family.adminOpenid !== user.openid) throw new Error("默认账本初始化状态无效，请重试");
  const memberRecords = await db.collection("family_members").where({ familyId, openid: user.openid }).limit(20).get();
  const member = memberRecords.data.sort(compareMembership)[0];
  const memberId = member?._id || getStableMembershipId(familyId, user.openid);
  const memberData = { familyId, openid: user.openid, nickName: user.nickName, avatarUrl: user.avatarUrl, role: "admin", status: "active", joinedAt: member?.joinedAt || now, leftAt: null, updatedAt: now };
  if (member) await db.collection("family_members").doc(memberId).update({ data: memberData });
  else await db.collection("family_members").doc(memberId).set({ data: memberData });
  await db.collection("families").doc(familyId).update({ data: { activeMemberCount: 1, membershipRevision: Number(family.membershipRevision || 0) + 1, updatedAt: now } });
  await initFamilyCategoriesAndAccounts(familyId);
  await ensureInitialFamilyInvite(familyId, user.openid);
  // isOwner / adminName 必须一并返回，否则前端会把创建者显示成“成员”
  return { id: familyId, name: family.name || name, role: "admin", memberId, isOwner: true, adminName: user.nickName || "管理员", membershipRevision: Number(family.membershipRevision || 0) + 1, created: true };
};

// 仅用于本地单元测试暴露的纯函数引用；不改变云端 main 行为。
if (typeof module !== "undefined") {
  module.exports.testUtils = {
    getStableDocumentId,
    getStableUserId,
    getStableMembershipId,
    normalizeName,
    compareMembership,
    computeDefaultFamilyName,
    generateInviteCode
  };
}
