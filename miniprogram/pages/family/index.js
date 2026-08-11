const app = getApp();

Page({
  data: {
    families: [],
    currentFamilyId: "",
    members: [],
    isAdmin: false,
    loading: false
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
  },

  async loadFamilyDetail(familyId) {
    const result = await this.callFunction("getFamilyDetail", { familyId });
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

  async showInvite() {
    if (!this.data.currentFamilyId || !this.data.isAdmin) return;
    try {
      const result = await this.callFunction("createInvite", { familyId: this.data.currentFamilyId });
      wx.showModal({
        title: "邀请成员",
        content: `邀请码：${result.code}\n有效期：7 天`,
        showCancel: false
      });
    } catch (error) {
      wx.showToast({ title: error.message || "生成失败", icon: "none" });
    }
  },

  async joinByInvite() {
    const modal = await new Promise((resolve) => {
      wx.showModal({
        title: "加入家庭账本",
        editable: true,
        placeholderText: "请输入邀请码",
        success: resolve
      });
    });
    const code = (modal.content || "").trim().toUpperCase();
    if (!modal.confirm || !code) return;
    try {
      const result = await this.callFunction("joinFamily", { code });
      wx.setStorageSync("currentFamilyId", result.family.id);
      app.globalData.currentFamilyId = result.family.id;
      wx.showToast({ title: "加入成功" });
      await this.loadFamilies();
    } catch (error) {
      wx.showToast({ title: error.message || "加入失败", icon: "none" });
    }
  },

  async removeMember(e) {
    const openid = e.currentTarget.dataset.openid;
    const modal = await new Promise((resolve) => {
      wx.showModal({ title: "移除成员", content: "移除后仍保留其历史账单，确定继续吗？", success: resolve });
    });
    if (!modal.confirm) return;
    try {
      await this.callFunction("removeMember", { familyId: this.data.currentFamilyId, openid });
      await this.loadFamilyDetail(this.data.currentFamilyId);
    } catch (error) {
      wx.showToast({ title: error.message || "移除失败", icon: "none" });
    }
  },

  async transferAdmin(e) {
    const openid = e.currentTarget.dataset.openid;
    const modal = await new Promise((resolve) => {
      wx.showModal({ title: "移交管理员", content: "移交后你将成为普通成员，确定继续吗？", success: resolve });
    });
    if (!modal.confirm) return;
    try {
      await this.callFunction("transferAdmin", { familyId: this.data.currentFamilyId, openid });
      await this.loadFamilies();
    } catch (error) {
      wx.showToast({ title: error.message || "移交失败", icon: "none" });
    }
  },

  async switchFamily(e) {
    const familyId = e.currentTarget.dataset.id;
    wx.setStorageSync("currentFamilyId", familyId);
    app.globalData.currentFamilyId = familyId;
    this.setData({ currentFamilyId: familyId });
    try {
      await this.loadFamilyDetail(familyId);
    } catch (error) {
      wx.showToast({ title: error.message || "切换失败", icon: "none" });
    }
  },


  async resetFamilyData() {
    if (!this.data.currentFamilyId) {
      wx.showToast({ title: "请先选择一个家庭", icon: "none" });
      return;
    }
    
    const modal = await new Promise((resolve) => {
      wx.showModal({
        title: "确认重置",
        content: "此操作将删除当前家庭的所有分类和账户，并恢复为默认设置。确定要继续吗？",
        confirmColor: "#ff5252",
        success: resolve
      });
    });
    
    if (!modal.confirm) return;
    
    try {
      const result = await this.callFunction("resetFamilyData", { familyId: this.data.currentFamilyId });
      wx.showToast({ title: result.message || "重置成功" });
    } catch (error) {
      wx.showToast({ title: error.message || "重置失败", icon: "none" });
    }
  }
});
