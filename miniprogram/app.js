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
      const launchOptions = wx.getLaunchOptionsSync ? wx.getLaunchOptionsSync() : {};
      const inviteCode = launchOptions?.query?.inviteCode || launchOptions?.query?.code;
      if (inviteCode) this.enqueuePendingInvite(inviteCode);
      // 先用本地缓存复原 userInfo / currentFamily，让首页 onShow 能立即拿到数据渲染骨架。
      this.hydrateGlobalDataFromStorage();
      this.initializePromise = this.initialize();
    }
  },

  hydrateGlobalDataFromStorage() {
    try {
      const cachedUser = wx.getStorageSync("userInfoCache");
      const cachedFamily = wx.getStorageSync("currentFamilyCache");
      if (cachedUser && typeof cachedUser === "object") this.globalData.userInfo = cachedUser;
      if (cachedFamily && typeof cachedFamily === "object" && cachedFamily.id) {
        this.globalData.currentFamily = cachedFamily;
        this.globalData.currentFamilyId = cachedFamily.id;
      }
    } catch (error) {
      console.warn("复原缓存失败", error);
    }
  },

  onShow(options) {
    // 处理从小程序分享/场景值重新进入时携带的邀请码（App 已在后台运行场景）
    if (!wx.cloud) return;
    const query = (options && options.query) || (wx.getLaunchOptionsSync ? wx.getLaunchOptionsSync().query : {});
    const inviteCode = query && (query.inviteCode || query.code);
    if (inviteCode) {
      this.enqueuePendingInvite(inviteCode);
      // 重新初始化以处理新邀请，页面 onShow 中的 ensureInitialized 会复用该流程
      this.initializePromise = null;
    }
  },

  async initialize() {
    const currentFamilyId = wx.getStorageSync("currentFamilyId") || "";
    const inviteCode = this.getPendingInviteCodes()[0] || "";
    try {
      const response = await wx.cloud.callFunction({
        name: "ledgerFunctions",
        data: { action: "initUser", currentFamilyId, inviteCode }
      });
      const result = response.result;
      if (!result || !result.success) throw new Error(result?.message || "初始化失败");
      if (result.invalidInvite && inviteCode) {
        this.removePendingInvite(inviteCode);
        this.globalData.initializationNotice = result.invalidInvite.message;
        return this.initialize();
      }
      this.globalData.userInfo = result.user;
      try {
        if (result.user) wx.setStorageSync("userInfoCache", result.user);
        else wx.removeStorageSync("userInfoCache");
      } catch (storageError) {
        console.warn("写入缓存失败", storageError);
      }
      // 用 onFamilyChange 统一更新 + 广播，避免散落在各处的赋值导致页面不同步
      this.onFamilyChange(result.family || null);
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
  },

  // 切账本统一入口：更新 globalData + 写缓存 + 清缓存 + 广播各页面
  onFamilyChange(family) {
    this.globalData.currentFamily = family || null;
    this.globalData.currentFamilyId = family?.id || "";
    if (family?.id) {
      try {
        wx.setStorageSync("currentFamilyId", family.id);
        wx.setStorageSync("currentFamilyCache", family);
      } catch (error) {
        console.warn("写入缓存失败", error);
      }
    } else {
      try {
        wx.removeStorageSync("currentFamilyId");
        wx.removeStorageSync("currentFamilyCache");
      } catch (error) { /* ignore */ }
    }
    // 通知所有已打开页面，让它们清自己的 data + storage 缓存
    this.notifyFamilyChange(family);
  },

  notifyFamilyChange(family) {
    const pages = getCurrentPages();
    pages.forEach((page) => {
      if (page && typeof page.onFamilyChanged === "function") {
        try { page.onFamilyChanged(family); } catch (error) { console.warn("页面 onFamilyChanged 调用失败", error); }
      }
    });
  },

  getPendingInviteCodes() {
    const stored = wx.getStorageSync("pendingInviteCodes");
    const legacy = wx.getStorageSync("pendingInviteCode");
    const values = Array.isArray(stored) ? stored : [];
    if (legacy) values.push(legacy);
    const codes = Array.from(new Set(values.map((item) => String(item || "").trim().toUpperCase()).filter(Boolean)));
    wx.setStorageSync("pendingInviteCodes", codes);
    wx.removeStorageSync("pendingInviteCode");
    return codes;
  },

  enqueuePendingInvite(code) {
    const normalized = String(code || "").trim().toUpperCase();
    if (!normalized) return;
    const codes = this.getPendingInviteCodes();
    if (!codes.includes(normalized)) codes.push(normalized);
    wx.setStorageSync("pendingInviteCodes", codes);
  },

  removePendingInvite(code) {
    const normalized = String(code || "").trim().toUpperCase();
    const codes = this.getPendingInviteCodes().filter((item) => item !== normalized);
    wx.setStorageSync("pendingInviteCodes", codes);
  }
});
