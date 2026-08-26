const app = getApp();

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
    unreadCount: 0
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
