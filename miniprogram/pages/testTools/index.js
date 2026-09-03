const app = getApp();
const dailyReminder = require("../../utils/dailyReminder.js");

const OPTIONS = [
  { key: "all", label: "全部数据", desc: "清空所有集合，恢复到全新状态", collections: [], danger: true },
  { key: "bills", label: "账单记录", desc: "只清流水，分类/账户/成员保留", collections: ["bills"] },
  { key: "bills_budgets", label: "账单+预算", desc: "清流水和本月预算", collections: ["bills", "budgets"] },
  { key: "preferences", label: "记账偏好", desc: "记住的默认分类/账户，回到初始状态", collections: ["bill_preferences"] },
  { key: "feedbacks", label: "意见反馈", desc: "清空所有反馈记录", collections: ["feedbacks"] },
  { key: "logs", label: "操作日志", desc: "清空审计日志", collections: ["operation_logs"] }
];

const COLLECTION_LABELS = {
  users: "用户",
  families: "家庭账本",
  family_members: "账本成员",
  family_invites: "邀请码",
  categories: "分类",
  accounts: "账户",
  bills: "账单",
  budgets: "预算",
  bill_preferences: "记账偏好",
  operation_logs: "操作日志",
  initialization_locks: "初始化锁",
  feedbacks: "意见反馈",
  reminder_subscriptions: "记账提醒设置"
};

Page({
  data: {
    options: OPTIONS.map((item) => ({ ...item, counts: "" })),
    reminderDebug: null,
    reminderBusy: false,
    skipRecordedCheck: false
  },

  async onLoad() {
    try {
      const response = await wx.cloud.callFunction({ name: "feedbackFunctions", data: { action: "whoami" } });
      if (!response.result?.isDeveloper) {
        wx.showModal({
          title: "无权限",
          content: "仅开发者可访问该页面",
          showCancel: false,
          success: () => wx.navigateBack({ fail: () => wx.switchTab({ url: "/pages/index/index" }) })
        });
        return;
      }
    } catch (error) {
      wx.showToast({ title: "权限校验失败", icon: "none" });
      return;
    }
    this.loadCounts();
  },

  async loadCounts() {
    try {
      const response = await wx.cloud.callFunction({ name: "resetTestData", data: { action: "counts" } });
      const counts = response.result?.counts || {};
      const options = this.data.options.map((item) => {
        const targetCollections = item.key === "all"
          ? Object.keys(COLLECTION_LABELS)
          : item.collections;
        const total = targetCollections.reduce((sum, name) => sum + (counts[name] || 0), 0);
        return { ...item, counts: total > 0 ? String(total) : "" };
      });
      this.setData({ options });
    } catch (error) {
      wx.showToast({ title: error.message || "加载失败", icon: "none" });
    }
  },

  async onClear(event) {
    const key = event.currentTarget.dataset.key;
    const option = OPTIONS.find((item) => item.key === key);
    if (!option) return;
    const confirmText = option.danger ? "全部清除" : "确认清除";
    const content = option.danger
      ? "将清空所有用户、账本、账单等全部数据，此操作不可恢复，确定继续吗？"
      : "确定清除" + option.label + "吗？此操作不可恢复。";
    const modal = await new Promise((resolve) => wx.showModal({
      title: "清除数据",
      content,
      confirmText,
      confirmColor: "#D64545",
      success: resolve
    }));
    if (!modal.confirm) return;
    wx.showLoading({ title: "清除中", mask: true });
    try {
      // 云函数侧要求显式确认后才执行清空，防止误触/调用方遗漏
      const data = option.key === "all" ? { action: "clear", confirm: true } : { action: "clear", collections: option.collections, confirm: true };
      const response = await wx.cloud.callFunction({ name: "resetTestData", data });
      if (!response.result?.success) throw new Error(response.result?.message || "清除失败");
      wx.hideLoading();
      wx.showToast({ title: "已清除", icon: "success" });
      this.loadCounts();
      // 全部数据清除后，重置本地状态，下次进入会重新初始化
      if (option.key === "all") {
        app.clearSession();
        wx.removeStorageSync("pendingInviteCodes");
      }
    } catch (error) {
      wx.hideLoading();
      wx.showToast({ title: error.message || "清除失败", icon: "none" });
    }
  },

  // ==================== 每日记账提醒调试 ====================
  async callLedger(action, data = {}) {
    const response = await wx.cloud.callFunction({ name: "ledgerFunctions", data: { ...data, action } });
    if (!response.result?.success) throw new Error(response.result?.message || "操作失败");
    return response.result;
  },

  async loadReminderDebug() {
    if (this.data.reminderBusy) return;
    this.setData({ reminderBusy: true });
    try {
      const result = await this.callLedger("debugReminderDiagnose");
      this.setData({ reminderDebug: this.formatReminderDebug(result.debug) });
    } catch (error) {
      wx.showToast({ title: error.message || "诊断失败", icon: "none" });
    } finally {
      this.setData({ reminderBusy: false });
    }
  },

  // 把云端诊断结果压平成键值对，便于直接展示
  formatReminderDebug(debug) {
    const setting = debug.setting || {};
    const rows = [
      { label: "提醒开关", value: setting.enabled ? "已开启" : "未开启" },
      { label: "提醒档位", value: "每天 " + String(setting.remindHour).padStart(2, "0") + ":00" },
      { label: "授权额度", value: "已授 " + (setting.grantedCount || 0) + " 条 / 已发 " + (setting.sentCount || 0) + " 条，剩余约 " + (setting.remaining || 0) + " 条" },
      { label: "北京时间", value: debug.beijingTimeText || "" }
    ];
    if (setting.pausedReason) rows.push({ label: "已自动暂停", value: "原因：" + setting.pausedReason + "，重新授权并开启后恢复" });
    const familyRows = (debug.families || []).map((family) => ({
      label: family.name || family.familyId,
      value: "今日" + (debug.recordedToday[family.familyId] ? "已记账 ✓（会被跳过）" : "未记账") + (debug.targetFamilyName && debug.targetFamilyName === family.name ? " · 推送目标账本" : "")
    }));
    if (!familyRows.length) familyRows.push({ label: "账本身份", value: "无任何有效成员关系" });
    const preview = debug.messagePreview || {};
    const previewRows = ["thing3", "thing4", "thing9", "amount7", "time1"]
      .map((key) => ({ label: key, value: preview[key] ? preview[key].value : "" }));
    let verdictRows;
    if (debug.wouldSendIfSlotNow) verdictRows = [{ label: "发送判定", value: "条件齐备：到点将会发送 ✓", ok: true }];
    else verdictRows = (debug.blockReasons || ["未知"]).map((reason) => ({ label: "暂不发送原因", value: reason }));
    return rows
      .concat(familyRows)
      .concat([{ label: "本月支出预览", value: debug.monthExpensePreview || "0元" }])
      .concat(previewRows)
      .concat(verdictRows);
  },

  onToggleSkipRecorded(event) {
    this.setData({ skipRecordedCheck: event.detail.value === true });
  },

  async requestReminderAuth() {
    try {
      const result = await dailyReminder.requestSubscribe();
      if (result.granted >= 1) {
        wx.showToast({ title: "补额成功，额度+1", icon: "success" });
        await this.loadReminderDebug();
        return;
      }
      // 开发者诊断弹窗：透出微信原始结果，便于定位弹窗没弹/被拒/被过滤/调用失败
      wx.showModal({
        title: "未完成订阅授权",
        content: "微信原始结果：" + (result.raw || "(空，调用未成功)") +
          "\nerrMsg: " + (result.errMsg || "(空)") +
          "\n\n含义对照：reject=弹窗出现但点了拒绝；ban=之前勾选过「总是保持以上选择」且选择了拒绝（不再弹窗）；filter=模板被过滤；结果为空=调用失败，看 errMsg 详情。",
        showCancel: false
      });
    } catch (error) {
      wx.showToast({ title: error.message || "授权失败", icon: "none" });
    }
  },

  async sendTestReminder() {
    const modal = await new Promise((resolve) => wx.showModal({
      title: "发送测试提醒",
      content: this.data.skipRecordedCheck
        ? "将跳过「今日已记账」判断，立即向你真实推送一条服务通知并消耗 1 次额度，继续吗？"
        : "按生产规则真实推送：本人今天已有记账则被跳过且不消耗额度，继续吗？",
      success: resolve
    }));
    if (!modal.confirm) return;
    wx.showLoading({ title: "发送中", mask: true });
    try {
      const result = await this.callLedger("debugReminderForceSend", { skipRecordedCheck: this.data.skipRecordedCheck });
      wx.hideLoading();
      const outcome = result.outcome || {};
      let content;
      if (outcome.sent) {
        content = "已真实推送到微信「服务通知」，请去微信查收展示效果。本次消耗了 1 次推送额度。";
      } else if (outcome.skipped === "recorded_today") {
        content = "被生产规则跳过：本人今天已有记账。打开下方「跳过」开关再试即可强制发送。";
      } else if (outcome.skipped === "no_membership") {
        content = "被生产规则跳过：当前没有有效账本成员身份。";
      } else if (outcome.error && outcome.error.errCode === "43101") {
        content = "微信返回 43101：无可用订阅额度或用户已拒收。请先点「补充一条推送额度」；本次已自动暂停推送，重新开启开关可恢复。";
      } else if (outcome.error && outcome.error.errCode === "-604101") {
        content = "云端未配置云调用权限（-604101）：需重新部署 ledgerFunctions 云函数，并等待约 10 分钟权限缓存生效后再试。";
      } else {
        content = "发送失败：" + ((outcome.error && outcome.error.errCode + " " + outcome.error.errMsg) || outcome.skipped || "未知原因");
      }
      wx.showModal({
        title: outcome.sent ? "发送成功" : "未能发送",
        content,
        showCancel: false,
        success: () => this.loadReminderDebug()
      });
    } catch (error) {
      wx.hideLoading();
      wx.showToast({ title: error.message || "请求失败", icon: "none" });
    }
  }
});
