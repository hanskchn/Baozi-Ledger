const app = getApp();

Page({
  data: {
    nickName: "微信用户",
    avatarUrl: "",
    familyName: "我的家庭",
    isAdmin: false,
    isOwner: false,
    familyAdminName: "",
    // 角色未确认前不渲染标签，避免管理员先闪现“成员”
    roleReady: false
  },

  async onShow() {
    // 未登录时不展示个人资料，统一跳登录页
    if (app.globalData.loggedIn !== true) { app.redirectToLogin(); return; }
    try {
      const initialized = await app.ensureInitialized();
      if (initialized && initialized.loggedIn === false) { app.redirectToLogin(); return; }
      // 轻量校验角色是否被服务端改动（如管理员被移交给自己），变化时会广播 onFamilyChanged
      await app.refreshCurrentFamily();
      const user = app.globalData.userInfo || initialized.user;
      const family = app.globalData.currentFamily || initialized.family;
      // 本项目每个账本仅一位管理员，role 为 admin 即账本归属者；
      // 旧缓存可能缺少 isOwner，用 role 兜底避免误显示“成员”
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
  },

  // 账本或角色发生变化时重渲染（由 app.onFamilyChange 广播触发）
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

  async editProfile() {
    const modal = await new Promise((resolve) => wx.showModal({ title: "修改昵称", editable: true, content: this.data.nickName, success: resolve }));
    const nickName = (modal.content || "").trim();
    if (!modal.confirm || !nickName) return;
    try {
      const response = await wx.cloud.callFunction({ name: "ledgerFunctions", data: { action: "updateUserProfile", nickName, avatarUrl: this.data.avatarUrl } });
      if (!response.result?.success) throw new Error(response.result?.message || "修改失败");
      app.setLoginState(true, response.result.user);
      this.setData({ nickName: response.result.user.nickName });
      wx.showToast({ title: "已修改" });
    } catch (error) { wx.showToast({ title: error.message || "修改失败", icon: "none" }); }
  },

  noop() {},

  async onChooseAvatar(event) {
    const tempFilePath = event.detail?.avatarUrl;
    if (!tempFilePath) return;
    try {
      wx.showLoading({ title: "上传头像", mask: true });
      const extension = tempFilePath.split(".").pop() || "png";
      const upload = await wx.cloud.uploadFile({ cloudPath: "avatars/" + Date.now() + "." + extension, filePath: tempFilePath });
      const response = await wx.cloud.callFunction({ name: "ledgerFunctions", data: { action: "updateUserProfile", nickName: this.data.nickName, avatarUrl: upload.fileID } });
      if (!response.result?.success) throw new Error(response.result?.message || "头像更新失败");
      app.globalData.userInfo = response.result.user;
      this.setData({ avatarUrl: response.result.user.avatarUrl });
      wx.showToast({ title: "头像已更新" });
    } catch (error) {
      wx.showToast({ title: error.message || "头像更新失败", icon: "none" });
    } finally {
      wx.hideLoading();
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
        const dissolvable = status.adminFamilies.filter((item) => item.canDissolve);
        const transferRequired = status.adminFamilies.filter((item) => !item.canDissolve);
        if (transferRequired.length) {
          const names = transferRequired.map((item) => item.name).join("、");
          wx.showModal({ title: "暂不能注销", content: "你仍管理“" + names + "”。请先在家庭管理中转让管理员，再回来继续注销。", confirmText: "去管理", success: (modal) => { if (modal.confirm) this.goFamily(); } });
          return;
        }
        const names = dissolvable.map((item) => "“" + item.name + "”").join("、");
        const confirmation = await new Promise((resolve) => wx.showModal({ title: "处理后继续注销", content: "你是 " + names + " 的唯一成员。继续将逐个解散这些账本，然后注销账号；账本不可恢复。", confirmText: "继续处理", confirmColor: "#D64545", success: resolve }));
        if (!confirmation.confirm) return;
        wx.showLoading({ title: "处理中", mask: true });
        try {
          await dissolvable.reduce((promise, family) => promise.then(() => this.callLedger("dissolveFamily", { familyId: family.id })), Promise.resolve());
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
      wx.showModal({ title: "账号已注销", content: "你的个人资料和账本访问权限已移除。再次登录将视为新用户。", showCancel: false, success: () => wx.reLaunch({ url: "/pages/login/index" }) });
    } catch (error) {
      wx.showToast({ title: error.message || "注销失败", icon: "none" });
    }
  },

  goExport() {
    if (!app.globalData.currentFamilyId) { wx.showToast({ title: "请先确认加入账本", icon: "none" }); return; }
    wx.navigateTo({ url: "/pages/export/index" });
  }
});
