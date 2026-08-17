const app = getApp();

Page({
  data: {
    families: [],
    currentFamilyId: "",
    members: [],
    isAdmin: false,
    loading: false,
    inviteCode: ""
  },

  async onShow() {
    await this.loadFamilies();
  },

  async callFunction(type, data = {}) {
    const response = await wx.cloud.callFunction({
      name: "ledgerFunctions",
      data: { ...data, action: type }
    });
    if (!response.result || !response.result.success) {
      throw new Error(response.result?.message || "操作失败");
    }
    return response.result;
  },

  async loadFamilies() {
    this.setData({ loading: true });
    try {
      await app.ensureInitialized();
      const result = await this.callFunction("listFamilies");
      const currentFamilyId = wx.getStorageSync("currentFamilyId") || result.families[0]?.id || "";
      app.globalData.currentFamilyId = currentFamilyId;
      wx.setStorageSync("currentFamilyId", currentFamilyId);
      this.setData({ families: result.families, currentFamilyId });
      if (currentFamilyId) {
        await this.loadFamilyDetail(currentFamilyId);
      } else {
        this.setData({ members: [], isAdmin: false });
      }
    } catch (error) {
      wx.showToast({ title: error.message || "加载失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
    if (this.data.isAdmin && !this.data.inviteCode) {
      this.ensureInvite();
    }
  },

  async loadFamilyDetail(familyId) {
    const result = await this.callFunction("getFamilyDetail", { familyId });
    if (familyId === app.globalData.currentFamilyId) app.globalData.currentFamily = result.family;
    this.setData({
      members: result.members,
      isAdmin: result.role === "admin"
    });
  },

  async createFamily() {
    const modal = await new Promise((resolve) => {
      wx.showModal({
        title: "创建家庭账本",
        editable: true,
        placeholderText: "例如：坤坤和倩倩",
        success: resolve
      });
    });
    const name = (modal.content || "").trim();
    if (!modal.confirm || !name) return;
    try {
      const result = await this.callFunction("createFamily", { name });
      wx.setStorageSync("currentFamilyId", result.family.id);
      app.globalData.currentFamilyId = result.family.id;
      wx.showToast({ title: "创建成功" });
      await this.loadFamilies();
    } catch (error) {
      wx.showToast({ title: error.message || "创建失败", icon: "none" });
    }
  },

  async renameCurrentFamily() {
    const current = this.data.families.find((item) => item.id === this.data.currentFamilyId);
    const modal = await new Promise((resolve) => wx.showModal({ title: "修改账本名称", editable: true, content: current?.name || "", success: resolve }));
    const name = (modal.content || "").trim();
    if (!modal.confirm || !name) return;
    try {
      await this.callFunction("renameFamily", { familyId: this.data.currentFamilyId, name });
      app.globalData.currentFamily = { ...app.globalData.currentFamily, name };
      wx.showToast({ title: "已修改" });
      await this.loadFamilies();
    } catch (error) { wx.showToast({ title: error.message || "修改失败", icon: "none" }); }
  },

  async ensureInvite() {
    if (!this.data.currentFamilyId || !this.data.isAdmin) return null;
    if (this.data.inviteCode) return this.data.inviteCode;
    try {
      const result = await this.callFunction("createInvite", { familyId: this.data.currentFamilyId });
      this.setData({ inviteCode: result.code });
      return result.code;
    } catch (error) {
      wx.showToast({ title: error.message || "生成邀请链接失败", icon: "none" });
      return null;
    }
  },

  async revokeInvite() {
    const modal = await new Promise((resolve) => wx.showModal({ title: "撤销邀请码", content: "撤销后，当前邀请码将立刻失效。", success: resolve }));
    if (!modal.confirm) return;
    try {
      await this.callFunction("revokeInvite", { familyId: this.data.currentFamilyId });
      this.setData({ inviteCode: "" });
      wx.showToast({ title: "邀请码已撤销" });
    } catch (error) { wx.showToast({ title: error.message || "撤销失败", icon: "none" }); }
  },


  async removeMember(e) {
    const memberId = e.currentTarget.dataset.memberId;
    const modal = await new Promise((resolve) => {
      wx.showModal({ title: "移除成员", content: "移除后仍保留其历史账单，确定继续吗？", success: resolve });
    });
    if (!modal.confirm) return;
    try {
      await this.callFunction("removeMember", { familyId: this.data.currentFamilyId, memberId });
      await this.loadFamilyDetail(this.data.currentFamilyId);
    } catch (error) {
      wx.showToast({ title: error.message || "移除失败", icon: "none" });
    }
  },

  async transferAdmin(e) {
    const memberId = e.currentTarget.dataset.memberId;
    const modal = await new Promise((resolve) => {
      wx.showModal({ title: "移交管理员", content: "移交后你将成为普通成员，确定继续吗？", success: resolve });
    });
    if (!modal.confirm) return;
    try {
      await this.callFunction("transferAdmin", { familyId: this.data.currentFamilyId, memberId });
      await this.loadFamilies();
    } catch (error) {
      wx.showToast({ title: error.message || "移交失败", icon: "none" });
    }
  },

  async switchFamily(e) {
    const familyId = e.currentTarget.dataset.id;
    try {
      const result = await this.callFunction("getFamilyDetail", { familyId });
      wx.setStorageSync("currentFamilyId", familyId);
      app.onFamilyChange(result.family);
      const isAdmin = result.role === "admin";
      this.setData({ currentFamilyId: familyId, members: result.members, isAdmin, inviteCode: "" });
      if (isAdmin) this.ensureInvite();
    } catch (error) {
      wx.showToast({ title: error.message || "切换失败", icon: "none" });
    }
  },

  async leaveFamily() {
    if (this.data.isAdmin) {
      wx.showToast({ title: "管理员请先转让管理权", icon: "none" });
      return;
    }
    const modal = await new Promise((resolve) => wx.showModal({ title: "退出账本", content: "退出后将无法继续查看该账本，确定继续吗？", success: resolve }));
    if (!modal.confirm) return;
    try {
      await this.callFunction("leaveFamily", { familyId: this.data.currentFamilyId });
      wx.removeStorageSync("currentFamilyId");
      app.globalData.currentFamilyId = "";
      app.initializePromise = null;
      wx.showToast({ title: "已退出" });
      await this.loadFamilies();
    } catch (error) { wx.showToast({ title: error.message || "退出失败", icon: "none" }); }
  },

  onShareAppMessage() {
    const current = this.data.families.find((item) => item.id === this.data.currentFamilyId);
    const familyName = current?.name || "家庭账本";
    const code = this.data.inviteCode;
    const path = code
      ? "/pages/index/index?inviteCode=" + encodeURIComponent(code)
      : "/pages/index/index";
    return {
      title: "邀请你加入“" + familyName + "”",
      path: path
    };
  }

});
