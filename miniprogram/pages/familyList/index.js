const app = getApp();

Page({
  data: {
    families: [],
    currentFamilyId: "",
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
      const result = await this.callFunction("listFamilies");
      this.setData({
        families: (result.families || []).map((item) => ({
          ...item,
          totalBillCount: item.totalBillCount || 0,
          iconText: String(item.name || "账").trim().slice(0, 1)
        })),
        currentFamilyId: app.globalData.currentFamilyId || wx.getStorageSync("currentFamilyId") || ""
      });
    } catch (error) {
      wx.showToast({ title: error.message || "加载失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },

  async switchFamily(e) {
    const familyId = e.currentTarget.dataset.id;
    if (!familyId) return;
    if (familyId === this.data.currentFamilyId) {
      wx.navigateBack();
      return;
    }
    wx.showLoading({ title: "切换中", mask: true });
    try {
      const result = await this.callFunction("getFamilyDetail", { familyId });
      app.onFamilyChange(result.family);
      app.initializePromise = null;
      wx.hideLoading();
      wx.showToast({ title: "已切换账本" });
      setTimeout(() => wx.navigateBack(), 400);
    } catch (error) {
      wx.hideLoading();
      wx.showToast({ title: error.message || "切换失败", icon: "none" });
    }
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
    wx.showLoading({ title: "创建中", mask: true });
    try {
      const result = await this.callFunction("createFamily", { name });
      const detail = await this.callFunction("getFamilyDetail", { familyId: result.family.id });
      app.onFamilyChange(detail.family);
      app.initializePromise = null;
      wx.hideLoading();
      wx.showToast({ title: "创建成功" });
      await this.loadFamilies();
    } catch (error) {
      wx.hideLoading();
      wx.showToast({ title: error.message || "创建失败", icon: "none" });
    }
  }
});
