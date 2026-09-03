const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const COLLECTION = "feedbacks";

// 开发者 openid 白名单：首次部署后通过 whoami 动作获取本人 openid，
// 填入下方数组并重新部署即可看到「反馈管理」入口。
const DEVELOPER_OPENIDS = ["oEntM3edll4iSPXTT0RzgomZNFIM"];

const VALID_TYPES = ["bug", "suggestion", "other"];
const VALID_STATUS = ["pending", "processing", "resolved", "closed"];
const CONTENT_MIN = 10;
const CONTENT_MAX = 500;
const MAX_IMAGES = 3;
const PAGE_SIZE_MAX = 50;
const DAILY_SUBMIT_LIMIT = 10;

const ok = (data = {}) => ({ success: true, ...data });
const fail = (message, errorCode = "BAD_REQUEST") => ({ success: false, errorCode, message });

// 仅放行业务错误信息给客户端：带中文且不含底层驱动/网络报错特征，其余收敛为通用文案
const INTERNAL_ERROR_MARKERS = [":fail", "openapi", "document.", "collection", "database", "getaddrinfo", "econn", "etimedout", "socket", "ssl", "network", "timeout", "internalerror", "failedoperation", "accessdenied", "permission", "mongo"];
const toClientErrorMessage = (error) => {
  const message = String((error && error.message) || "");
  if (!message) return "服务器错误";
  if (error && error.expose) return message;
  const lower = message.toLowerCase();
  if (INTERNAL_ERROR_MARKERS.some((marker) => lower.includes(marker)) || !/[\u4e00-\u9fa5]/.test(message)) {
    return "服务器开小差了，请稍后重试";
  }
  return message;
};

const getOpenid = () => cloud.getWXContext().OPENID;

const isDeveloper = (openid) => DEVELOPER_OPENIDS.includes(openid);

let collectionsReadyPromise;
const ensureCollections = async () => {
  if (!collectionsReadyPromise) {
    collectionsReadyPromise = db.createCollection(COLLECTION).catch(() => {
      // 集合已存在时云开发会抛错，忽略即可；其他错误在后续数据库操作中暴露
    });
  }
  await collectionsReadyPromise;
};

const ensureDeveloper = (openid) => {
  if (!isDeveloper(openid)) throw new Error("无权限执行该操作");
};

const todayStart = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
};

const sanitizeSystemInfo = (info) => {
  if (!info || typeof info !== "object") return {};
  const keys = ["brand", "model", "system", "platform", "version", "SDKVersion", "language", "fontSizeSetting", "pixelRatio", "windowWidth", "windowHeight"];
  const result = {};
  for (const key of keys) {
    if (info[key] !== undefined && info[key] !== null) result[key] = String(info[key]).slice(0, 64);
  }
  return result;
};

// 返回当前调用者身份，用于前端判断是否显示「反馈管理」入口
const whoami = async () => {
  const openid = getOpenid();
  // 只下发身份尾段，完整 openid 不下发到前端（S9 收敛口径，前端无 shell openid 残留）
  return ok({ identity: openid.slice(-8), isDeveloper: isDeveloper(openid) });
};

// 提交反馈
const submitFeedback = async (event) => {
  const openid = getOpenid();
  const type = String(event.type || "").trim();
  const content = String(event.content || "").trim();
  const contact = String(event.contact || "").trim().slice(0, 50);
  const pagePath = String(event.pagePath || "").trim().slice(0, 200);
  const appVersion = String(event.appVersion || "").trim().slice(0, 20);
  const envVersion = String(event.envVersion || "").trim().slice(0, 20);

  if (!VALID_TYPES.includes(type)) throw new Error("反馈类型无效");
  if (content.length < CONTENT_MIN || content.length > CONTENT_MAX) {
    throw new Error(`反馈描述需 ${CONTENT_MIN}-${CONTENT_MAX} 字`);
  }

  let images = [];
  if (Array.isArray(event.images)) {
    if (event.images.length > MAX_IMAGES) throw new Error(`最多上传 ${MAX_IMAGES} 张截图`);
    images = event.images
      .map((item) => String(item || "").trim())
      .filter((item) => item.startsWith("cloud://"))
      .slice(0, MAX_IMAGES);
  }

  // 防刷：同一 openid 每天最多提交 DAILY_SUBMIT_LIMIT 条
  const todayCount = await db.collection(COLLECTION)
    .where({ openid, createTime: _.gte(todayStart()) })
    .count();
  if (todayCount.total >= DAILY_SUBMIT_LIMIT) {
    throw new Error("今日反馈次数已达上限，请明天再试");
  }

  const now = new Date();
  const doc = {
    openid,
    type,
    content,
    contact,
    images,
    pagePath,
    systemInfo: sanitizeSystemInfo(event.systemInfo),
    appVersion,
    envVersion,
    status: "pending",
    reply: "",
    hasUnreadReply: false,
    createTime: now,
    updateTime: now
  };
  const result = await db.collection(COLLECTION).add({ data: doc });
  return ok({ id: result._id });
};

// 我的反馈列表（分页）
const listMyFeedback = async (event) => {
  const openid = getOpenid();
  const page = Math.max(1, parseInt(event.page, 10) || 1);
  const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, parseInt(event.pageSize, 10) || 20));
  const skip = (page - 1) * pageSize;

  const collection = db.collection(COLLECTION);
  const where = { openid };
  const [listResult, countResult] = await Promise.all([
    collection.where(where).orderBy("createTime", "desc").skip(skip).limit(pageSize).get(),
    collection.where(where).count()
  ]);

  return ok({
    list: listResult.data.map((item) => ({
      id: item._id,
      type: item.type,
      content: item.content,
      status: item.status,
      reply: item.reply || "",
      hasUnreadReply: Boolean(item.hasUnreadReply),
      createTime: item.createTime,
      updateTime: item.updateTime
    })),
    total: countResult.total,
    page,
    pageSize,
    hasMore: skip + listResult.data.length < countResult.total
  });
};

// 反馈详情：本人或开发者可查看；本人查看时清除未读红点
const getFeedbackDetail = async (event) => {
  const openid = getOpenid();
  const id = String(event.id || "").trim();
  if (!id) throw new Error("反馈 ID 无效");

  let doc;
  try {
    doc = await db.collection(COLLECTION).doc(id).get();
  } catch (error) {
    throw new Error("反馈不存在或已删除");
  }
  const data = doc.data;
  if (!data) throw new Error("反馈不存在或已删除");
  const isOwner = data.openid === openid;
  if (!isOwner && !isDeveloper(openid)) throw new Error("无权限查看该反馈");

  // 本人查看时清除未读标记
  if (isOwner && data.hasUnreadReply) {
    await db.collection(COLLECTION).doc(id).update({ data: { hasUnreadReply: false, updateTime: new Date() } });
    data.hasUnreadReply = false;
  }

  // 换取截图临时链接
  let imageUrls = [];
  if (Array.isArray(data.images) && data.images.length > 0) {
    try {
      const temp = await cloud.getTempFileURL({ fileList: data.images });
      imageUrls = (temp.fileList || [])
        .filter((item) => item.status === 0 && item.tempFileURL)
        .map((item) => item.tempFileURL);
    } catch (error) {
      console.warn("换取截图临时链接失败", error);
    }
  }

  // 管理员查看时附带提交人信息
  let submitter = null;
  if (!isOwner && isDeveloper(openid)) {
    try {
      const userRes = await db.collection("users").where({ openid: data.openid }).limit(1).get();
      const user = userRes.data[0];
      if (user) submitter = { nickName: user.nickName || "微信用户", avatarUrl: user.avatarUrl || "" };
    } catch (error) {
      console.warn("查询提交人信息失败", error);
    }
  }

  return ok({
    id: data._id,
    type: data.type,
    content: data.content,
    contact: data.contact || "",
    images: imageUrls,
    pagePath: data.pagePath || "",
    systemInfo: data.systemInfo || {},
    appVersion: data.appVersion || "",
    envVersion: data.envVersion || "",
    status: data.status,
    reply: data.reply || "",
    hasUnreadReply: Boolean(data.hasUnreadReply),
    createTime: data.createTime,
    updateTime: data.updateTime,
    replyTime: data.replyTime || null,
    isOwner,
    submitter
  });
};

// 当前用户未读回复数（用于「我的」页红点）
const getUnreadCount = async () => {
  const openid = getOpenid();
  const result = await db.collection(COLLECTION)
    .where({ openid, hasUnreadReply: true })
    .count();
  return ok({ count: result.total });
};

// 管理员：全部反馈列表（分页 + 状态筛选）
const listAllFeedback = async (event) => {
  const openid = getOpenid();
  ensureDeveloper(openid);

  const page = Math.max(1, parseInt(event.page, 10) || 1);
  const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, parseInt(event.pageSize, 10) || 20));
  const status = String(event.status || "").trim();
  const skip = (page - 1) * pageSize;

  const where = {};
  if (status && VALID_STATUS.includes(status)) where.status = status;

  const collection = db.collection(COLLECTION);
  const [listResult, countResult] = await Promise.all([
    collection.where(where).orderBy("createTime", "desc").skip(skip).limit(pageSize).get(),
    collection.where(where).count()
  ]);

  // 批量关联提交人昵称头像，避免 N+1
  const openids = [...new Set(listResult.data.map((item) => item.openid).filter(Boolean))];
  let userMap = {};
  if (openids.length > 0) {
    try {
      const userRes = await db.collection("users").where({ openid: _.in(openids) }).get();
      userMap = Object.fromEntries(
        userRes.data.map((user) => [user.openid, { nickName: user.nickName || "微信用户", avatarUrl: user.avatarUrl || "" }])
      );
    } catch (error) {
      console.warn("批量查询用户信息失败", error);
    }
  }

  return ok({
    list: listResult.data.map((item) => ({
      id: item._id,
      openid: item.openid,
      type: item.type,
      content: item.content,
      contact: item.contact || "",
      imageCount: Array.isArray(item.images) ? item.images.length : 0,
      pagePath: item.pagePath || "",
      appVersion: item.appVersion || "",
      status: item.status,
      reply: item.reply || "",
      createTime: item.createTime,
      updateTime: item.updateTime,
      submitter: userMap[item.openid] || { nickName: "微信用户", avatarUrl: "" }
    })),
    total: countResult.total,
    page,
    pageSize,
    hasMore: skip + listResult.data.length < countResult.total
  });
};

// 管理员：回复反馈 / 更新状态
const replyFeedback = async (event) => {
  const openid = getOpenid();
  ensureDeveloper(openid);

  const id = String(event.id || "").trim();
  const reply = String(event.reply || "").trim();
  const status = String(event.status || "").trim();

  if (!id) throw new Error("反馈 ID 无效");
  if (!reply && !status) throw new Error("回复内容或状态至少填写一项");
  if (reply.length > 500) throw new Error("回复内容不能超过 500 字");
  if (status && !VALID_STATUS.includes(status)) throw new Error("状态值无效");

  let existing;
  try {
    existing = await db.collection(COLLECTION).doc(id).get();
  } catch (error) {
    throw new Error("反馈不存在或已删除");
  }
  if (!existing.data) throw new Error("反馈不存在或已删除");

  const updateData = { updateTime: new Date() };
  if (reply) {
    updateData.reply = reply;
    updateData.replyTime = new Date();
    updateData.hasUnreadReply = true;
    // 回复后若仍处于待处理，自动流转为处理中；管理员显式选择其他状态则尊重其选择
    updateData.status = (!status || status === "pending") ? "processing" : status;
  } else if (status) {
    updateData.status = status;
  }

  await db.collection(COLLECTION).doc(id).update({ data: updateData });
  return ok({ id });
};

const BUILD_VERSION = "2026-08-26-feedback-v4";

const HANDLERS = {
  whoami,
  submitFeedback,
  listMyFeedback,
  getFeedbackDetail,
  getUnreadCount,
  listAllFeedback,
  replyFeedback
};

exports.main = async (event = {}) => {
  try {
    await ensureCollections();
    const action = String(event.action || event.type || "").trim();
    const handler = HANDLERS[action];
    if (!handler) {
      return { ...fail("未知操作", "UNKNOWN_ACTION"), buildVersion: BUILD_VERSION, receivedAction: action };
    }
    const result = await handler(event);
    return { ...result, buildVersion: BUILD_VERSION };
  } catch (error) {
    console.error("feedbackFunctions error:", error && error.message, error);
    return { ...fail(toClientErrorMessage(error), "SERVER_ERROR"), buildVersion: BUILD_VERSION };
  }
};
