// 每日记账提醒（微信一次性订阅消息）共享工具。
// 职责：模板 ID 常量、本地缓存副本、自动补足（记账成功后 / 打开小程序时静默续订）。
// 设置的读写走 ledgerFunctions 云函数（getReminderSetting / saveReminderSetting / reportReminderGrant），
// 本文件不直接读写数据库，只维护一份本地缓存供各页面快速判断是否需要自动补足。

const TEMPLATE_ID = "-Jfjvy5CY9tEPP8Wck9XLPFu-iHWfzXRg4Us37LA058";
const STORAGE_KEY = "dailyReminderState";
// 剩余可发条数低于该阈值时，会在记账成功后 / 打开小程序时自动补 1 条；高于则不打扰
const RENEW_THRESHOLD = 5;
// 并发防重复：同一时刻只允许一个自动补足请求在进行
let renewingBusy = false;

const readCache = () => {
  try {
    const cached = wx.getStorageSync(STORAGE_KEY);
    return cached && typeof cached === "object" ? cached : null;
  } catch (error) {
    return null;
  }
};

const writeCache = (patch) => {
  try {
    wx.setStorageSync(STORAGE_KEY, { ...(readCache() || {}), ...patch });
  } catch (error) {
    // 存储异常不影响主流程
  }
};

// 只读本地缓存，供各页面判断“是否已开启 / 是否曾勾选过『总是保持以上选择』 / 是否曾被永久拒绝(ban)”
const getCache = () => readCache();

// 用云端返回的最新设置覆盖本地缓存（我的页加载、订阅授权上报后共用）
const syncCacheFromSetting = (setting) => {
  if (!setting) return;
  writeCache({
    enabled: setting.enabled === true,
    remindHour: Number(setting.remindHour) || 21,
    remaining: Number(setting.remaining) || 0,
    templateId: setting.templateId || TEMPLATE_ID
  });
};

// 调起订阅授权并上报云端累加额度。resolve { granted, raw, errMsg }：
// granted 为本次新增的可发条数(0/1)，raw 为微信原始结果（accept/reject/ban/filter，失败时为空），
// errMsg 为 requestSubscribeMessage 完整 errMsg，供测试工具透出排查。
const requestSubscribe = () => new Promise((resolve) => {
  const finish = async (res) => {
    const state = res ? res[TEMPLATE_ID] || "" : "";
    const errMsg = res ? String(res.errMsg || "") : "";
    if (state !== "accept") {
      // ban=用户（之前）勾选“总是保持以上选择”并选择永远拒绝，此后不再弹窗
      if (state === "ban") writeCache({ renewBlocked: true });
      else writeCache({ renewBlocked: false });
      resolve({ granted: 0, raw: state, errMsg });
      return;
    }
    writeCache({ renewBlocked: false });
    let granted = 1; // 授权已消耗，即使上报失败也按 +1 记，避免反复打扰
    try {
      const app = getApp();
      const response = await wx.cloud.callFunction({
        name: "ledgerFunctions",
        data: {
          action: "reportReminderGrant",
          granted,
          familyId: app.globalData.currentFamilyId || "",
          familyName: (app.globalData.currentFamily && app.globalData.currentFamily.name) || ""
        }
      });
      if (response.result && response.result.setting) syncCacheFromSetting(response.result.setting);
      if (!response.result || response.result.success !== true) granted = 0;
    } catch (error) {
      console.warn("上报订阅授权失败", error);
    }
    resolve({ granted, raw: state, errMsg });
  };
  wx.requestSubscribeMessage({
    tmplIds: [TEMPLATE_ID],
    complete: (res) => finish(res)
  });
});

// 判断当前用户是否具备“自动补足”的前置条件：
// 已开启提醒 + 未永久拒绝（ban）+ 剩余条数不足。
// 说明：是否已勾选“总是保持以上选择”微信不提供明确状态、无法可靠读取，
// 因此不在本地判断，交由微信本身决定补足时是否弹窗（保持则静默、否则弹一次）。
const shouldAutoTopup = () => {
  const cache = readCache();
  if (!cache) return { ok: false, reason: "no_cache" };
  if (cache.enabled !== true) return { ok: false, reason: "disabled" };
  if (cache.renewBlocked === true) return { ok: false, reason: "blocked" };
  const remaining = Math.max(0, Number(cache.remaining) || 0);
  if (remaining > RENEW_THRESHOLD) return { ok: false, reason: "enough" };
  return { ok: true, reason: "ok" };
};

// 自动补足：记账成功后 / 打开小程序时调用。只有“已开启 + 未拒绝 + 额度不足”才真正申请。
// busy 标志防同一时刻重复请求（记账回调与 onShow 极可能同时触发），无时间冷却。
const autoRenewIfNeeded = async () => {
  const before = shouldAutoTopup();
  if (!before.ok) return { renewed: false, reason: before.reason };
  if (renewingBusy) return { renewed: false, reason: "busy" };
  renewingBusy = true;
  let result;
  try {
    result = await requestSubscribe();
  } finally {
    renewingBusy = false;
  }
  return { renewed: result.granted > 0, result };
};

// 保存账单成功后的静默补足入口（fire-and-forget，调用方无需 await、无需处理异常）
const afterBillSaved = () => {
  try {
    autoRenewIfNeeded().catch(() => {});
  } catch (error) {
    // 静默失败
  }
};

module.exports = {
  TEMPLATE_ID,
  getCache,
  syncCacheFromSetting,
  requestSubscribe,
  autoRenewIfNeeded,
  afterBillSaved
};
