App({
  globalData: {
    env: "cloud1-d1gq4g6a7c2911b56",
    userInfo: null,
    currentFamilyId: "",
    currentFamily: null
  },

  onLaunch() {
    if (!wx.cloud) {
      console.error("请使用 2.2.3 或以上的基础库以使用云能力");
    } else {
      wx.cloud.init({
        env: this.globalData.env,
        traceUser: true
      });
      this.initializePromise = this.initialize();
    }
  },

  async initialize() {
    const currentFamilyId = wx.getStorageSync("currentFamilyId") || "";
    try {
      const response = await wx.cloud.callFunction({
        name: "ledgerFunctions",
        data: { type: "initUser", currentFamilyId }
      });
      const result = response.result;
      if (!result || !result.success) throw new Error(result?.message || "初始化失败");
      this.globalData.userInfo = result.user;
      this.globalData.currentFamily = result.family;
      this.globalData.currentFamilyId = result.family.id;
      wx.setStorageSync("currentFamilyId", result.family.id);
      return result;
    } catch (error) {
      this.globalData.currentFamilyId = "";
      this.globalData.currentFamily = null;
      wx.removeStorageSync("currentFamilyId");
      throw error;
    }
  },

  ensureInitialized() {
    if (!this.initializePromise) this.initializePromise = this.initialize();
    return this.initializePromise;
  }
});
