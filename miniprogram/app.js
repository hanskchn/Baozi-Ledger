App({
  globalData: {
    env: "cloud1-d1gq4g6a7c2911b56",
    userInfo: null,
    currentFamilyId: "",
    currentFamily: null,
    loggedIn: false
  },

  onLaunch() {
    this._sessionDeclinedCodes = new Set();
    if (!wx.cloud) {
      console.error("请使用 2.2.3 或以上的基础库以使用云能力");
    } else {
      wx.cloud.init({
        env: this.globalData.env,
        traceUser: true
      });
      const launchOptions = wx.getLaunchOptionsSync ? wx.getLaunchOptionsSync() : {};
      const inviteCode = this.extractInviteCode(launchOptions);
      if (inviteCode) this.enqueuePendingInvite(inviteCode);
      // 先用本地缓存复原 userInfo / currentFamily，让首页 onShow 能立即拿到数据渲染骨架。
      this.hydrateGlobalDataFromStorage();
      this.initializePromise = this.initialize();
    }
  },

  hydrateGlobalDataFromStorage() {
    try {
      const cachedLoggedIn = wx.getStorageSync("loggedIn") === true;
      const cachedUser = wx.getStorageSync("userInfoCache");
      const cachedFamily = wx.getStorageSync("currentFamilyCache");
      this.globalData.loggedIn = cachedLoggedIn;
      if (cachedUser && typeof cachedUser === "object") this.globalData.userInfo = cachedUser;
      if (cachedLoggedIn && cachedFamily && typeof cachedFamily === "object" && cachedFamily.id) {
        this.globalData.currentFamily = cachedFamily;
        this.globalData.currentFamilyId = cachedFamily.id;
      }
    } catch (error) {
      console.warn("复原缓存失败", error);
    }
  },

  // 登录态写入 globalData + 本地缓存，供各页面门禁判断
  setLoginState(loggedIn, user) {
    this.globalData.loggedIn = loggedIn === true;
    this.globalData.userInfo = user || (loggedIn ? this.globalData.userInfo : null);
    try {
      if (loggedIn) {
        wx.setStorageSync("loggedIn", true);
        if (this.globalData.userInfo) wx.setStorageSync("userInfoCache", this.globalData.userInfo);
      } else {
        wx.removeStorageSync("loggedIn");
        wx.removeStorageSync("userInfoCache");
      }
    } catch (error) {
      console.warn("写入登录缓存失败", error);
    }
  },

  // 登出/注销后清空全部登录与账本状态
  clearSession() {
    this.initializePromise = null;
    this.globalData.currentFamily = null;
    this.globalData.currentFamilyId = "";
    this.setLoginState(false, null);
    try {
      wx.removeStorageSync("currentFamilyId");
      wx.removeStorageSync("currentFamilyCache");
      wx.removeStorageSync("hasDismissedNicknameTip");
    } catch (error) { /* ignore */ }
  },

  onShow(options) {
    // 处理从小程序分享/场景值重新进入时携带的邀请码（App 已在后台运行场景）
    if (!wx.cloud) return;
    const launchOptions = options || (wx.getLaunchOptionsSync ? wx.getLaunchOptionsSync() : {});
    const inviteCode = this.extractInviteCode(launchOptions);
    if (inviteCode) {
      this.enqueuePendingInvite(inviteCode);
      // 重新初始化以处理新邀请，页面 onShow 中的 ensureInitialized 会复用该流程
      this.initializePromise = null;
    }
  },

  extractInviteCode(options) {
    if (!options) return "";
    if (options.query && (options.query.inviteCode || options.query.code)) {
      return options.query.inviteCode || options.query.code;
    }
    // 小程序码 wxacode.getUnlimited 的 scene 参数在 options.query.scene 中（URL 编码字符串）；
    // options.scene 是数字场景值（如 1047=扫码），不要混淆。
    const rawScene = options.query && options.query.scene;
    if (rawScene) {
      try {
        const decoded = decodeURIComponent(rawScene);
        const match = decoded.match(/i=([A-Z0-9]+)/i);
        if (match) return match[1].toUpperCase();
      } catch (e) { /* ignore */ }
    }
    return "";
  },

  async initialize() {
    const currentFamilyId = wx.getStorageSync("currentFamilyId") || "";
    const inviteCode = this.getPendingInviteCodes().find((code) => !this._sessionDeclinedCodes.has(code)) || "";
    try {
      const response = await wx.cloud.callFunction({
        name: "ledgerFunctions",
        data: { action: "initUser", currentFamilyId, inviteCode }
      });
      const result = response.result;
      if (!result || !result.success) throw new Error(result?.message || "初始化失败");
      this.setLoginState(true, result.user);
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
      // 有待确认邀请时，云函数返回 family=null，不能据此清空当前账本，
      // 否则用户点"暂不加入"后会丢失正在使用的账本。
      if (result.pendingInvite) {
        if (!this.globalData.currentFamilyId) {
          const cached = wx.getStorageSync("currentFamilyId") || "";
          if (cached) this.globalData.currentFamilyId = cached;
        }
      } else {
        // 用 onFamilyChange 统一更新 + 广播，避免散落在各处的赋值导致页面不同步
        this.onFamilyChange(result.family || null);
      }
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

  // 角色/成员关系变更的轻量校验：先用 getFamilyRevision 比对 membershipRevision，
  // 只有版本真的变了才拉一次完整详情并广播，避免每次 onShow 都全量请求。
  // 移交管理员这类服务端侧变更（客户端无从感知），靠这里在下次进页面时收敛。
  async refreshCurrentFamily() {
    const familyId = this.globalData.currentFamilyId;
    if (!familyId || this.globalData.loggedIn !== true) return null;
    if (this.refreshingFamilyPromise) return this.refreshingFamilyPromise;
    this.refreshingFamilyPromise = this._refreshCurrentFamily(familyId)
      .catch((error) => {
        // 校验失败不打扰用户，页面继续用现有缓存渲染
        console.warn("刷新账本信息失败", error);
        return null;
      })
      .then((result) => {
        this.refreshingFamilyPromise = null;
        return result;
      });
    return this.refreshingFamilyPromise;
  },

  async _refreshCurrentFamily(familyId) {
    const response = await wx.cloud.callFunction({
      name: "ledgerFunctions",
      data: { action: "getFamilyRevision", familyId }
    });
    const result = response.result;
    if (!result || !result.success) return null;
    // 期间用户可能已切账本，丢弃过期结果
    if (familyId !== this.globalData.currentFamilyId) return null;

    const current = this.globalData.currentFamily || {};
    // 账本被解散或自己已被移出：清空当前账本，交由页面重新初始化
    if (result.exists === false) {
      this.initializePromise = null;
      this.onFamilyChange(null);
      return { removed: true };
    }

    const knownRevision = Number(current.membershipRevision || 0);
    const roleChanged = Boolean(current.role) && current.role !== result.role;
    const revisionChanged = Number(result.membershipRevision || 0) !== knownRevision;
    if (!roleChanged && !revisionChanged) return { changed: false };

    const detail = await wx.cloud.callFunction({
      name: "ledgerFunctions",
      data: { action: "getFamilyDetail", familyId }
    });
    if (!detail.result || !detail.result.success) return null;
    if (familyId !== this.globalData.currentFamilyId) return null;
    const family = detail.result.family;
    const becameAdmin = current.role === "member" && family.role === "admin";
    const lostAdmin = current.role === "admin" && family.role === "member";
    // 重置初始化缓存，让后续 ensureInitialized 拿到新角色
    this.initializePromise = null;
    this.onFamilyChange(family);
    // 权限变化不能静默发生，给用户一个明确提示
    if (becameAdmin) wx.showModal({ title: "你已成为管理员", content: "「" + (family.name || "该账本") + "」的管理员已移交给你，现在可以管理成员与账本设置。", showCancel: false });
    else if (lostAdmin) wx.showModal({ title: "管理员已变更", content: "你在「" + (family.name || "该账本") + "」中已变为普通成员。", showCancel: false });
    return { changed: true, becameAdmin, lostAdmin, family };
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
    // 新的一次扫码/进入视为用户重新想处理该邀请，清除本次会话内曾拒绝的标记，
    // 否则重复扫同一个码不会再弹出加入页面（刷新后才恢复）
    this._sessionDeclinedCodes.delete(normalized);
    const codes = this.getPendingInviteCodes();
    if (!codes.includes(normalized)) codes.push(normalized);
    wx.setStorageSync("pendingInviteCodes", codes);
  },

  removePendingInvite(code) {
    const normalized = String(code || "").trim().toUpperCase();
    const codes = this.getPendingInviteCodes().filter((item) => item !== normalized);
    wx.setStorageSync("pendingInviteCodes", codes);
    this._sessionDeclinedCodes.delete(normalized);
  },

  declinePendingInvite(code) {
    const normalized = String(code || "").trim().toUpperCase();
    if (normalized) this._sessionDeclinedCodes.add(normalized);
  }
});
