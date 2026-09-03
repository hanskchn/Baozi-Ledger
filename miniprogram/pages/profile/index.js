const app = getApp();
const dailyReminder = require("../../utils/dailyReminder.js");

Page({
  data: {
    nickName: "微信用户",
    avatarUrl: "",
    familyName: "我的家庭",
    isAdmin: false,
    isOwner: false,
    familyAdminName: "",
    roleReady: false,
    showProfileSheet: false,
    savingProfile: false,
    sheetAvatarUrl: "",
    isDeveloper: false,
    unreadCount: 0,
    reminder: { enabled: false, remindHour: 21, remaining: 0, loaded: false },
    reminderValueText: "未开启",
    showReminderSheet: false,
    showReminderGuide: false,
    guideReminderTimeText: "",
    reminderQuotaText: "",
    reminderSaving: false,
    reminderOptions: [
      { hour: 9, label: "09:00", desc: "早上 · 通勤路上补昨天的账" },
      { hour: 13, label: "13:00", desc: "午间 · 记下上午的花销" },
      { hour: 21, label: "21:00", desc: "睡前 · 盘点今天全天的收支" }
    ]
  },

  async onShow() {
    try {
      const initialized = await app.ensureInitialized();
      await app.refreshCurrentFamily();
      const user = app.globalData.userInfo || initialized.user;
      const family = app.globalData.currentFamily || initialized.family;
      const isAdmin = family?.role === "admin";
      this.setData({
        nickName: user.nickName || "微信用户",
        avatarUrl: user.avatarUrl || "",
        familyName: family?.name || "待确认邀请",
        isAdmin,
        isOwner: family?.isOwner === true || isAdmin,
        familyAdminName: family?.adminName || "",
        roleReady: Boolean(family)
      });
    } catch (error) {
      wx.showToast({ title: error.message || "加载失败", icon: "none" });
    }
    this.refreshFeedbackState();
    this.refreshReminderState();
  },

  async callFeedback(action, data = {}) {
    const response = await wx.cloud.callFunction({ name: "feedbackFunctions", data: { ...data, action } });
    if (!response.result?.success) throw new Error(response.result?.message || "操作失败");
    return response.result;
  },

  async refreshFeedbackState() {
    try {
      const [whoami, unread] = await Promise.all([
        this.callFeedback("whoami"),
        this.callFeedback("getUnreadCount")
      ]);
      this.setData({ isDeveloper: Boolean(whoami.isDeveloper), unreadCount: unread.count || 0 });
    } catch (error) {
      // 反馈模块异常不影响「我的」页主流程
      console.warn("刷新反馈状态失败", error);
    }
  },

  goFeedback() {
    wx.navigateTo({ url: "/pages/feedback/index" });
  },

  goFeedbackAdmin() {
    wx.navigateTo({ url: "/pages/feedbackAdmin/index" });
  },

  goTestTools() {
    wx.navigateTo({ url: "/pages/testTools/index" });
  },

  onFamilyChanged(family) {
    if (!family) {
      this.setData({ familyName: "待确认邀请", isAdmin: false, isOwner: false, familyAdminName: "", roleReady: false });
      return;
    }
    const isAdmin = family.role === "admin";
    this.setData({
      familyName: family.name || "待确认邀请",
      isAdmin,
      isOwner: family.isOwner === true || isAdmin,
      familyAdminName: family.adminName || "",
      roleReady: true
    });
  },

  goFamily() {
    wx.navigateTo({ url: "/pages/family/index" });
  },

  noop() {},

  openProfileSheet() {
    this._sheetNickname = this.data.nickName === "微信用户" ? "" : this.data.nickName;
    this._sheetAvatarTempPath = "";
    this.setData({ showProfileSheet: true, sheetAvatarUrl: this.data.avatarUrl, savingProfile: false });
  },

  closeProfileSheet() {
    if (this.data.savingProfile) return;
    this._sheetNickname = "";
    this._sheetAvatarTempPath = "";
    this.setData({ showProfileSheet: false });
  },

  onSheetChooseAvatar(event) {
    const tempFilePath = event.detail?.avatarUrl || "";
    if (!tempFilePath) return;
    this._sheetAvatarTempPath = tempFilePath;
    this.setData({ sheetAvatarUrl: tempFilePath });
  },

  onSheetNicknameInput(event) {
    const value = (event.detail?.value || event.detail?.nickname || "").trim();
    if (value) this._sheetNickname = value;
  },

  async saveProfile() {
    if (this.data.savingProfile) return;
    const nickName = (this._sheetNickname || "").trim();
    if (!nickName) {
      wx.showToast({ title: "请输入昵称", icon: "none" });
      return;
    }
    this.setData({ savingProfile: true });
    wx.showLoading({ title: "保存中", mask: true });
    let loadingVisible = true;
    const closeLoading = () => {
      if (!loadingVisible) return;
      loadingVisible = false;
      wx.hideLoading();
    };
    try {
      let avatarUrl = this.data.avatarUrl;
      if (this._sheetAvatarTempPath) {
        const extension = this._sheetAvatarTempPath.split(".").pop() || "png";
        const upload = await wx.cloud.uploadFile({ cloudPath: "avatars/" + Date.now() + "." + extension, filePath: this._sheetAvatarTempPath });
        avatarUrl = upload.fileID;
      }
      const response = await wx.cloud.callFunction({ name: "ledgerFunctions", data: { action: "updateUserProfile", nickName, avatarUrl } });
      if (!response.result?.success) throw new Error(response.result?.message || "保存失败");
      app.setLoginState(true, response.result.user);
      this.setData({
        nickName: response.result.user.nickName,
        avatarUrl: response.result.user.avatarUrl,
        showProfileSheet: false
      });
      closeLoading();
      wx.showToast({ title: "已保存", icon: "success" });
    } catch (error) {
      closeLoading();
      wx.showToast({ title: error.message || "保存失败", icon: "none" });
    } finally {
      closeLoading();
      this._sheetNickname = "";
      this._sheetAvatarTempPath = "";
      this.setData({ savingProfile: false });
    }
  },

  goBudget() {
    wx.navigateTo({ url: "/pages/budget/index" });
  },

  goCategory() {
    wx.navigateTo({ url: "/pages/category/index" });
  },

  goAccount() {
    wx.navigateTo({ url: "/pages/account/index" });
  },

  goImport() {
    wx.navigateTo({ url: "/pages/import/index" });
  },

  goLogs() {
    wx.navigateTo({ url: "/pages/logs/index" });
  },

  // ==================== 每日记账提醒 ====================

  buildReminderValueText(reminder) {
    if (!reminder.enabled) {
      if (reminder.pausedReason === "no_quota") return "已暂停（额度用完）";
      return "未开启";
    }
    const option = this.data.reminderOptions.find((item) => item.hour === reminder.remindHour);
    let text = "每天 " + (option ? option.label : "21:00");
    if (reminder.renewBlocked) text += " · 请重新允许";
    return text;
  },

  reminderTimeText(hour) {
    const option = this.data.reminderOptions.find((item) => item.hour === hour);
    return option ? option.label : "21:00";
  },

  applyReminder(reminder, setting) {
    const next = { ...this.data.reminder, ...reminder };
    const cache = dailyReminder.getCache();
    const blocked = next.renewBlocked === true || (cache && cache.renewBlocked === true);
    const remaining = Number(next.remaining) || 0;
    const pausedNoQuota = next.pausedReason === "no_quota";
    // 已开启（额度不足）或自动暂停（额度用尽）时展示“补一条 / 重新允许”；额度足够且正常时不显示，保持清爽
    const showQuota = (next.enabled === true || pausedNoQuota) && (blocked || pausedNoQuota || remaining <= 5);
    this.setData({
      reminder: next,
      reminderValueText: this.buildReminderValueText({ ...next, renewBlocked: blocked }),
      reminderQuotaText: blocked
        ? ""
        : pausedNoQuota
          ? "额度已用完，提醒已暂停，补一条即可恢复"
          : `剩余 ${remaining} 条提醒额度`,
      showQuota,
      renewBlocked: blocked
    });
    if (setting) dailyReminder.syncCacheFromSetting(setting);
  },

  async refreshReminderState() {
    try {
      const response = await this.callLedger("getReminderSetting");
      const setting = response.setting || {};
      const cache = dailyReminder.getCache() || {};
      this.applyReminder({
        ...setting,
        loaded: true,
        renewBlocked: cache.renewBlocked === true
      }, setting);
    } catch (error) {
      console.warn("获取提醒设置失败", error);
    }
  },

  openReminderSheet() {
    this.setData({ showReminderSheet: true });
  },

  closeReminderSheet() {
    if (this.data.reminderSaving) return;
    this.setData({ showReminderSheet: false });
  },

  // —— 开启提醒：瑞幸式底部授权说明 ——
  openReminderGuide() {
    this.setData({
      showReminderGuide: true,
      guideReminderTimeText: this.reminderTimeText(this.data.reminder.remindHour)
    });
  },

  closeReminderGuide() {
    this.setData({ showReminderGuide: false });
    // 用户未开启时保证开关归位
    if (!this.data.reminder.enabled) this.applyReminder({ enabled: false });
  },

  async confirmReminderGuide() {
    if (this.data.reminderSaving) return;
    this.setData({ showReminderGuide: false, reminderSaving: true });
    try {
      // 「同意并开启」= 唯一订阅意向：首次授权（微信必须弹一次系统窗）。
      // 之后不再批量补；额度靠“记账成功后”在用户手势回调里自动补，也可手动「补一条」（见 dailyReminder.autoRenewIfNeeded）。
      const result = await dailyReminder.requestSubscribe();
      if (result.granted < 1) {
        wx.showToast({ title: this.describeSubscribeRefusal(result.raw), icon: "none" });
        this.applyReminder({ enabled: false });
        return;
      }
      await this.persistReminder({ enabled: true });
      wx.showToast({ title: "已开启提醒，以后自动补足", icon: "success" });
    } catch (error) {
      wx.showToast({ title: error.message || "开启失败", icon: "none" });
      this.applyReminder({ enabled: false });
    } finally {
      this.setData({ reminderSaving: false });
    }
  },

  describeSubscribeRefusal(raw) {
    if (raw === "ban") return "订阅已被关闭，请在小程序「设置」中重新允许订阅消息";
    return "未完成订阅授权，提醒暂时无法生效";
  },

  onReminderToggle(event) {
    if (event.detail.value === true) this.openReminderGuide();
    else this.disableReminder();
  },

  async disableReminder() {
    if (this.data.reminderSaving) return;
    const modal = await new Promise((resolve) => wx.showModal({
      title: "关闭提醒",
      content: "关闭后将不再推送记账提醒，已预留的推送额度也会清零。确认关闭？",
      confirmText: "关闭",
      confirmColor: "#D64545",
      success: resolve
    }));
    if (!modal.confirm) return;
    this.setData({ reminderSaving: true });
    try {
      await this.persistReminder({ enabled: false });
      wx.showToast({ title: "已关闭提醒", icon: "success" });
    } catch (error) {
      wx.showToast({ title: error.message || "关闭失败", icon: "none" });
      this.applyReminder({ enabled: true });
    } finally {
      this.setData({ reminderSaving: false });
    }
  },

  async persistReminder(patch) {
    const response = await this.callLedger("saveReminderSetting", {
      ...patch,
      remindHour: this.data.reminder.remindHour,
      familyId: app.globalData.currentFamilyId || ""
    });
    const setting = response.setting || {};
    this.applyReminder({
      ...patch,
      remindHour: Number(setting.remindHour) || 21,
      remaining: Number(setting.remaining) || 0,
      loaded: true
    }, setting);
    return setting;
  },

  pickRemindHour(event) {
    const hour = Number(event.currentTarget.dataset.hour);
    if (!hour || hour === this.data.reminder.remindHour) return;
    this.applyReminder({ remindHour: hour });
    if (!this.data.reminder.enabled) return;
    this.persistReminder({ enabled: true })
      .then(() => wx.showToast({ title: "已保存", icon: "success" }))
      .catch((error) => {
      wx.showToast({ title: error.message || "保存失败", icon: "none" });
      this.refreshReminderState();
    });
  },

  // 打开小程序订阅消息设置（withSubscriptions 直达订阅消息一栏）
  openReminderSettings() {
    wx.openSetting({
      withSubscriptions: true,
      success: () => this.refreshReminderState()
    });
  },

  // 手动补一条额度：用户主动点击（bindtap，合法手势），请求订阅消息 +1
  async manualTopup() {
    if (this.data.reminderSaving) return;
    this.setData({ reminderSaving: true });
    try {
      const result = await dailyReminder.requestSubscribe();
      if (result.granted >= 1) {
        wx.showToast({ title: "已补一条额度", icon: "success" });
      } else {
        const tip = result.raw === "ban"
          ? "订阅已被关闭，请在下方「去设置重新允许」开启"
          : "未完成授权，暂时无法补足额度";
        wx.showToast({ title: tip, icon: "none" });
      }
      await this.refreshReminderState();
    } catch (error) {
      wx.showToast({ title: error.message || "补额度失败", icon: "none" });
    } finally {
      this.setData({ reminderSaving: false });
    }
  },


  async callLedger(action, data = {}) {
    const response = await wx.cloud.callFunction({ name: "ledgerFunctions", data: { ...data, action } });
    if (!response.result?.success) throw new Error(response.result?.message || "操作失败");
    return response.result;
  },

  async cancelAccount() {
    try {
      const status = await this.callLedger("getAccountCancellationStatus");
      if (!status.canCancel) {
        const lines = status.adminFamilies.map((item) => {
          const label = "“" + item.name + "”";
          return item.memberCount <= 1 ? label + "（唯一成员）" : label + "（还有 " + (item.memberCount - 1) + " 位成员）";
        });
        const content = "注销需先解散你管理的账本：\n" + lines.join("\n") + "\n\n解散后所有成员将失去访问权，数据保留 30 天期间可还原。";
        const confirmation = await new Promise((resolve) => wx.showModal({ title: "处理后继续注销", content, confirmText: "继续解散", confirmColor: "#D64545", success: resolve }));
        if (!confirmation.confirm) return;
        wx.showLoading({ title: "解散中", mask: true });
        try {
          // 先在服务端登记注销意图，随后的 forceLastFamily 解散豁免才会生效
          await this.callLedger("beginAccountCancellation");
          await status.adminFamilies.reduce((promise, family) => promise.then(() => this.callLedger("dissolveFamily", { familyId: family.id, forceLastFamily: true })), Promise.resolve());
        } finally {
          wx.hideLoading();
        }
        return await this.cancelAccount();
      }
      const confirmation = await new Promise((resolve) => wx.showModal({ title: "注销账号", content: "注销后将退出所有账本、删除个人资料和记账偏好。历史账单与审计记录会保留并显示为“已注销用户”。此操作不可恢复。", confirmText: "确认注销", confirmColor: "#D64545", success: resolve }));
      if (!confirmation.confirm) return;
      await this.callLedger("cancelAccount");
      app.clearSession();
      wx.removeStorageSync("pendingInviteCodes");
      wx.showModal({ title: "账号已注销", content: "你的个人资料和账本访问权限已移除。", showCancel: false, success: () => wx.switchTab({ url: "/pages/index/index" }) });
    } catch (error) {
      wx.showToast({ title: error.message || "注销失败", icon: "none" });
    }
  },

  goExport() {
    if (!app.globalData.currentFamilyId) { wx.showToast({ title: "请先确认加入账本", icon: "none" }); return; }
    wx.navigateTo({ url: "/pages/export/index" });
  }
});
