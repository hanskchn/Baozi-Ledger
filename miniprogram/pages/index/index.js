const app = getApp();

const formatBudget = (raw) => {
  if (!raw) return null;
  const percent = Number(raw.percent) || 0;
  const remain = Number(raw.remain) || 0;
  return {
    amount: Number(raw.amount || 0).toFixed(2),
    expense: Number(raw.expense || 0).toFixed(2),
    remain: Math.abs(remain).toFixed(2),
    percent,
    isOver: percent >= 100,
    isWarning: percent >= 80 && percent < 100,
    displayPercent: percent > 100 ? "100%+" : percent + "%",
    barWidth: Math.min(percent, 100)
  };
};
const brand = require("../../utils/brand");

Page({
  data: {
    familyName: "",
    currentFamilyId: "",
    isOwner: false,
    familyAdminName: "",
    todayExpense: 0,
    monthExpense: 0,
    monthIncome: 0,
    monthBalance: 0,
    budget: null,
    recentBills: [],
    loading: true,
    errorMessage: "",
    showFamilyPicker: false,
    families: [],
    groupedBills: [],
    hasBrandAssets: brand.available,
    brandImageFailed: false,
    emptyImageFailed: false,
    welcomeImageFailed: false,
    networkImageFailed: false,
    showWelcome: false
    ,pendingInvite: null
    ,statusBarHeight: 20
    ,slidBillId: ""
    ,showSwipeGuide: false
    ,swipeOffsetMap: {}
    ,swipeAnimating: false
    ,showNicknameTip: false
    // 角色未确认前不渲染标签，避免管理员先闪现“成员”
    ,roleReady: false
  },

  onLoad() {
    const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this.setData({ statusBarHeight: win.statusBarHeight || 20 });
  },

  onShow() {
    // 刚记完账/编辑/删除过账单：清除标记即可，首页用「快照 + 乐观增量」即时渲染，
    // 后台静默拉取云端数据校正，全程不出现整页 loading
    const homeDirty = app.globalData.homeSummaryDirty === true;
    if (homeDirty) app.globalData.homeSummaryDirty = false;
    // 首次进入展示一次"左滑删除"引导提示（本地已记住则不重复）
    if (!wx.getStorageSync("hasSeenSwipeGuide") && this.data.recentBills && this.data.recentBills.length > 0) {
      this.setData({ showSwipeGuide: true });
      this._swipeGuideTimer = setTimeout(() => {
        this.closeSwipeGuide();
      }, 4000);
    }
    // 1) 先用本地快照立刻渲染（有缓存时 loading 全程为 false）
    const hasCache = this.applyCachedHome();
    this.refreshNicknameTip();
    // 2) 新用户（无缓存且未看过欢迎页）立即弹欢迎页，不等云函数初始化
    const isNewVisitor = !hasCache && !wx.getStorageSync("hasSeenWelcome") && !wx.getStorageSync("welcomePending");
    if (isNewVisitor) {
      this.setData({ showWelcome: true });
      if (app.setWelcomeActive) app.setWelcomeActive(true);
    }
    // 3) 后台刷新：欢迎页展示中或有缓存时不显示 loading
    this.refreshHome({ silent: hasCache || isNewVisitor });
  },

  // 昵称仍是默认值且用户未关闭过提示时，展示"完善昵称"提示条
  refreshNicknameTip() {
    const nickName = app.globalData.userInfo?.nickName || "";
    const dismissed = wx.getStorageSync("hasDismissedNicknameTip") === true;
    const needsNickname = !nickName || nickName === "微信用户";
    this.setData({ showNicknameTip: needsNickname && !dismissed });
  },

  // bindinput 的返回值会被微信当作输入框新值回填，
  // 所以这里必须是同步函数且不返回内容（async 会回填 Promise，显示 undefined）。
  onNicknameTipChange(event) {
    const nickName = (event.detail?.value || event.detail?.nickname || "").trim();
    if (!nickName || nickName === "微信用户") return;
    this.saveNicknameFromTip(nickName);
  },

  async saveNicknameFromTip(nickName) {
    if (this._savingNickname) return;
    this._savingNickname = true;
    try {
      const response = await wx.cloud.callFunction({
        name: "ledgerFunctions",
        data: { action: "updateUserProfile", nickName, avatarUrl: app.globalData.userInfo?.avatarUrl || "" }
      });
      if (!response.result?.success) throw new Error(response.result?.message || "保存失败");
      app.setLoginState(true, response.result.user);
      this.setData({ showNicknameTip: false });
      wx.showToast({ title: "昵称已更新" });
    } catch (error) {
      wx.showToast({ title: error.message || "昵称保存失败", icon: "none" });
    } finally {
      this._savingNickname = false;
    }
  },

  closeNicknameTip() {
    try { wx.setStorageSync("hasDismissedNicknameTip", true); } catch (error) { /* ignore */ }
    this.setData({ showNicknameTip: false });
  },

  applyCachedHome() {
    const familyId = app.globalData.currentFamilyId;
    if (!familyId) {
      this.setData({ loading: true, errorMessage: "" });
      return false;
    }
    let cached = null;
    try { cached = wx.getStorageSync(`home:summary:${familyId}`); } catch (error) { cached = null; }
    if (!cached || !cached.summary) {
      this.setData({ loading: true, errorMessage: "" });
      return false;
    }
    // 记账/编辑/删除回来也直接用快照渲染（不再整页转圈），未同步的改动以乐观增量并入；
    // 云端数据由 refreshHome 静默拉回后原地覆盖校正。
    const snapshot = this.buildSnapshotWithDeltas(familyId, cached);
    this.setData({
      currentFamilyId: familyId,
      familyName: cached.familyName || app.globalData.currentFamily?.name || "",
      isOwner: cached.isOwner === true || app.globalData.currentFamily?.isOwner === true,
      familyAdminName: cached.familyAdminName || app.globalData.currentFamily?.adminName || "",
      roleReady: true,
      todayExpense: snapshot.todayExpense,
      monthExpense: snapshot.monthExpense,
      monthIncome: snapshot.monthIncome,
      monthBalance: snapshot.monthBalance,
      budget: formatBudget(snapshot.budget),
      recentBills: snapshot.bills,
      groupedBills: this._groupRecentBills(snapshot.bills),
      hasCache: true,
      loading: false,
      errorMessage: ""
    });
    // 缓存有账单时也尝试展示引导
    if (snapshot.bills.length > 0 && !wx.getStorageSync("hasSeenSwipeGuide")) {
      this.setData({ showSwipeGuide: true });
      if (this._swipeGuideTimer) clearTimeout(this._swipeGuideTimer);
      this._swipeGuideTimer = setTimeout(() => {
        this.closeSwipeGuide();
      }, 4000);
    }
    return true;
  },

  // 把乐观增量（记账/编辑/删除）并入首页快照，返回可直接 setData 的视图数据。
  // 汇总口径与云函数 getHomeSummary 一致：只统计今天及更早、且落在本月的账单；
  // 预算以缓存为基数按增量平移，剩余额度和百分比用分重算，最终一律以云端返回为准。
  buildSnapshotWithDeltas(familyId, cached) {
    const today = this.formatShanghaiDate(new Date());
    const month = today.substring(0, 7);

    let todayCents = Math.round(Number(cached.summary.todayExpense || 0) * 100);
    let monthExpenseCents = Math.round(Number(cached.summary.monthExpense || 0) * 100);
    let monthIncomeCents = Math.round(Number(cached.summary.monthIncome || 0) * 100);
    let balanceCents = Math.round(Number(cached.summary.monthBalance || 0) * 100);
    let deltaTodayCents = 0;
    let deltaMonthExpenseCents = 0;
    let deltaMonthIncomeCents = 0;

    let bills = (cached.recentBills || []).map((b) => ({ ...b, canOperate: b.canOperate === true, displayTime: (b.date || "").substring(11, 16) }));

    // 一笔账对汇总数字的贡献（金额单位分）；未来日期的账单不计入汇总，口径同云函数
    const effectOf = (meta) => {
      if (!meta || !["expense", "income"].includes(meta.type)) return null;
      const date = String(meta.date || "");
      const day = date.substring(0, 10);
      if (!date || day > today) return null;
      const inMonthAmount = date.substring(0, 7) === month ? meta.amountCents : 0;
      return {
        today: day === today ? meta.amountCents : 0,
        expense: meta.type === "expense" ? inMonthAmount : 0,
        income: meta.type === "income" ? inMonthAmount : 0
      };
    };
    const shiftTotals = (effect, sign) => {
      if (!effect) return;
      deltaTodayCents += sign * effect.today;
      deltaMonthExpenseCents += sign * effect.expense;
      deltaMonthIncomeCents += sign * effect.income;
    };

    app.consumeHomeDeltas(familyId).forEach((delta) => {
      if (!delta) return;
      if (delta.remove && delta.remove.id) {
        const index = bills.findIndex((bill) => bill._id === delta.remove.id);
        let removedMeta = null;
        if (index >= 0) {
          const row = bills[index];
          removedMeta = { type: row.type, amountCents: Number(row.amount || 0), date: row.date || "" };
          bills.splice(index, 1);
        } else if (delta.remove.type && delta.remove.amountCents !== undefined) {
          // 被删的账单不在最近列表窗口内：退回用记账页快照的原始数据扣除
          removedMeta = delta.remove;
        }
        shiftTotals(effectOf(removedMeta), -1);
      }
      if (delta.add) {
        const amountCents = Math.round(Number(delta.add.amountCents || 0));
        const date = delta.add.date || "";
        const row = {
          _id: delta.add.id,
          type: delta.add.type,
          amount: amountCents,
          category1: delta.add.category1,
          category1Icon: delta.add.category1Icon || "",
          category2: delta.add.category2,
          category2Icon: delta.add.category2Icon || "",
          date,
          account: delta.add.account,
          member: delta.add.member,
          remark: delta.add.remark || "",
          merchant: delta.add.merchant || "",
          canOperate: true,
          displayAmount: (amountCents / 100).toFixed(2),
          displayTime: date.substring(11, 16)
        };
        // 按日期降序插入最近列表，超出 10 条裁掉末尾
        const insertAt = bills.findIndex((bill) => (bill.date || "") < date);
        if (insertAt >= 0) bills.splice(insertAt, 0, row);
        else bills.push(row);
        if (bills.length > 10) bills = bills.slice(0, 10);
        shiftTotals(effectOf({ type: delta.add.type, amountCents, date }), 1);
      }
    });

    const budgetSrc = cached.summary.budget || null;
    let budget = null;
    if (budgetSrc) {
      const budgetAmountCents = Math.round(Number(budgetSrc.amount) * 100);
      const budgetExpenseCents = Math.round(Number(budgetSrc.expense) * 100) + deltaMonthExpenseCents;
      budget = {
        amount: budgetAmountCents / 100,
        expense: budgetExpenseCents / 100,
        remain: (budgetAmountCents - budgetExpenseCents) / 100,
        percent: budgetAmountCents > 0 ? Math.round((budgetExpenseCents / budgetAmountCents) * 100) : 0
      };
    }

    return {
      bills,
      todayExpense: ((todayCents + deltaTodayCents) / 100).toFixed(2),
      monthExpense: ((monthExpenseCents + deltaMonthExpenseCents) / 100).toFixed(2),
      monthIncome: ((monthIncomeCents + deltaMonthIncomeCents) / 100).toFixed(2),
      monthBalance: ((balanceCents + deltaMonthIncomeCents - deltaMonthExpenseCents) / 100).toFixed(2),
      budget
    };
  },

  async refreshHome(options = {}) {
    const silent = options.silent === true;
    if (!silent) this.setData({ loading: true, errorMessage: "" });
    try {
      const initialized = await app.ensureInitialized();
      if (app.globalData.initializationNotice) {
        wx.showToast({ title: app.globalData.initializationNotice, icon: "none" });
        app.globalData.initializationNotice = "";
      }
      // 初始化拿到最新用户资料后再判定一次，避免缓存里没有昵称时误判
      this.refreshNicknameTip();
      if (app.globalData.currentFamily && app.globalData.currentFamily.created) {
        wx.setStorageSync("welcomePending", true);
      }
      // 邀请链接进入：关掉欢迎页，显示邀请确认弹层
      if (initialized.pendingInvite) {
        this.setData({ showWelcome: false, pendingInvite: initialized.pendingInvite });
        if (app.setWelcomeActive) app.setWelcomeActive(false);
        return;
      }
      this.setData({ pendingInvite: null });
      if (wx.getStorageSync("welcomePending") && !wx.getStorageSync("hasSeenWelcome") && !this.data.showWelcome) {
        this.setData({ showWelcome: true });
        if (app.setWelcomeActive) app.setWelcomeActive(true);
      }
      await Promise.all([this.loadFamilyInfo(), this.loadHomeData()]);
      // 后台预加载记账页分类/账户/成员数据，点"+"时秒开
      this.precacheFormOptions().catch(() => {});
    } catch (error) {
      // 有缓存时静默失败，避免覆盖已展示的内容；无缓存才回退到 errorMessage
      if (!this.data.hasCache) {
        this.setData({ errorMessage: error.message || "初始化失败，请重试" });
      } else {
        console.warn("首页后台刷新失败，保留缓存数据", error);
      }
    } finally {
      if (!silent) this.setData({ loading: false });
    }
  },

  async precacheFormOptions() {
    const familyId = app.globalData.currentFamilyId;
    if (!familyId) return;
    // 10 分钟内有缓存就不重复请求
    try {
      const cached = wx.getStorageSync("formOptions:" + familyId);
      if (cached && cached.ts && Date.now() - cached.ts < 5 * 60 * 1000) return;
    } catch (e) {}
    const resp = await wx.cloud.callFunction({
      name: "accountingFunctions",
      data: { action: "listFormOptions", familyId }
    }).catch(() => null);
    if (!resp || !resp.result) return;
    const allCategories = resp.result.categories || [];
    const catExpense = allCategories.filter((c) => c.type !== "income");
    const catIncome = allCategories.filter((c) => c.type === "income");
    try {
      wx.setStorageSync("formOptions:" + familyId, {
        ts: Date.now(),
        categories: catExpense,
        incomeCategories: catIncome,
        accounts: resp.result.accounts || [],
        members: resp.result.members || [],
        preferences: null
      });
    } catch (e) {}
  },

  async onPullDownRefresh() {
    try {
      await Promise.all([this.loadFamilyInfo(), this.loadHomeData()]);
    } finally {
      wx.stopPullDownRefresh();
    }
  },

  async loadFamilyInfo() {
    const currentFamilyId = app.globalData.currentFamilyId;
    if (!currentFamilyId) {
      this.setData({ familyName: "未加入家庭", isOwner: false, familyAdminName: "", roleReady: false });
      return;
    }
    const currentFamily = app.globalData.currentFamily || {};
    // globalData 里已有角色时才展示标签，未知则等云端返回，避免闪成“成员”
    // 每个账本仅一位管理员，role 为 admin 即归属者；旧缓存缺 isOwner 时用 role 兜底
    const cachedIsOwner = currentFamily.isOwner === true || currentFamily.role === "admin";
    const hasCachedRole = typeof currentFamily.isOwner === "boolean" || Boolean(currentFamily.role);
    this.setData({
      currentFamilyId,
      familyName: currentFamily.name || "",
      isOwner: cachedIsOwner,
      familyAdminName: currentFamily.adminName || "",
      roleReady: hasCachedRole || this.data.roleReady
    });
    
    try {
      // 轻量校验：仅当账本成员/角色版本变化时才拉全量详情，并由 app 统一广播
      await app.refreshCurrentFamily();
      const family = app.globalData.currentFamily || {};
      if (!app.globalData.currentFamilyId) return;
      this.setData({
        familyName: family.name || "",
        isOwner: family.isOwner === true || family.role === "admin",
        familyAdminName: family.adminName || "",
        roleReady: true
      });
    } catch (error) {
      console.error("加载家庭信息失败", error);
    }
  },

  async loadHomeData() {
    try {
      const currentFamilyId = app.globalData.currentFamilyId;
      if (!currentFamilyId) return;

      // 获取所有账单
      const now = new Date();
      const today = this.formatShanghaiDate(now);
      const month = today.substring(0, 7);
      // Step 4 上线后改用 getHomeSummary，首页只需 4 个数字 + 最近 10 条账单。
      const [billResponse, summaryResponse] = await Promise.all([
        wx.cloud.callFunction({ name: "accountingFunctions", data: { action: "listBills", familyId: currentFamilyId, limit: 10, sort: "dateDesc" } }),
        wx.cloud.callFunction({ name: "accountingFunctions", data: { action: "getHomeSummary", familyId: currentFamilyId, month } })
      ]);
      const bills = billResponse.result && billResponse.result.bills || [];
      const summary = summaryResponse.result || {};
      // 云端权威数据已到手，丢弃未消费的乐观增量，避免后续渲染重复叠加
      app.consumeHomeDeltas(currentFamilyId);

      const recentBills = bills
        .map(bill => ({
          ...bill,
          canOperate: bill.canOperate === true,
          displayAmount: (bill.amount / 100).toFixed(2),
          displayTime: (bill.date || "").substring(11, 16)
        }));
      const groupedBills = this._groupRecentBills(recentBills);

      const todayExpense = Number(summary.todayExpense || 0).toFixed(2);
      const monthExpense = Number(summary.totalExpense || 0).toFixed(2);
      const monthIncome = Number(summary.totalIncome || 0).toFixed(2);
      const monthBalance = Number(summary.balance || (Number(monthIncome) - Number(monthExpense))).toFixed(2);

      this.setData({
        todayExpense,
        monthExpense,
        monthIncome,
        monthBalance,
        budget: formatBudget(summary.budget),
        recentBills,
        groupedBills,
        hasCache: true
      });

      // 首次有账单时展示左滑删除引导
      if (recentBills.length > 0 && !wx.getStorageSync("hasSeenSwipeGuide") && !this.data.showSwipeGuide) {
        this.setData({ showSwipeGuide: true });
        if (this._swipeGuideTimer) clearTimeout(this._swipeGuideTimer);
        this._swipeGuideTimer = setTimeout(() => {
          this.closeSwipeGuide();
        }, 4000);
      }

      // 把首页快照写入 storage，供下次 onShow 即时渲染（applyCachedHome）。
      try {
        wx.setStorageSync(`home:summary:${currentFamilyId}`, {
          ts: Date.now(),
          familyName: this.data.familyName,
          isOwner: this.data.isOwner,
          familyAdminName: this.data.familyAdminName,
          summary: { todayExpense, monthExpense, monthIncome, monthBalance, budget: summary.budget || null },
          recentBills,
          groupedBills
        });
      } catch (storageError) {
        console.warn("首页快照写入缓存失败", storageError);
      }
    } catch (error) {
      console.error("加载首页数据失败", error);
    }
  },

  onFamilyChanged() {
    // 账本未变化（如首次初始化广播）：跳过重复加载，避免 onShow 与 onFamilyChanged 各请求一次
    const newFamilyId = app.globalData.currentFamilyId;
    if (newFamilyId && newFamilyId === this.data.currentFamilyId) return;
    // 切账本后清首页缓存并强制刷新
    try {
      wx.removeStorageSync(`home:summary:${newFamilyId}`);
    } catch (error) { /* ignore */ }
    this.setData({ bills: [], recentBills: [], groupedBills: [], todayExpense: "0.00", monthExpense: "0.00", monthIncome: "0.00", monthBalance: "0.00", loading: true, errorMessage: "" });
    this.refreshHome({ silent: false });
  },

  formatShanghaiDate(date) {
    const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
    const pad = (value) => String(value).padStart(2, "0");
    return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
  },

  retryInitialize() {
    app.initializePromise = null;
    wx.removeStorageSync("currentFamilyId");
    this.onShow();
  },

  async confirmPendingInvite() {
    const code = this.data.pendingInvite?.code;
    if (!code) return;
    try {
      const response = await wx.cloud.callFunction({ name: "ledgerFunctions", data: { action: "confirmJoinFamily", code } });
      if (!response.result?.success) throw new Error(response.result?.message || "加入失败");
      app.removePendingInvite(code);
      app.onFamilyChange(response.result.family);
      app.initializePromise = null;
      wx.showToast({ title: response.result.alreadyMember ? "已切换账本" : "加入成功" });
      this.onShow();
    } catch (error) { wx.showToast({ title: error.message || "加入失败", icon: "none" }); }
  },

  declinePendingInvite() {
    const code = this.data.pendingInvite?.code;
    if (code) app.removePendingInvite(code);
    this.setData({ pendingInvite: null });
    app.initializePromise = null;
    this.refreshHome({ silent: true });
  },

  async removePendingInvite() {
    const code = this.data.pendingInvite?.code;
    if (!code) return;
    const modal = await new Promise((resolve) => wx.showModal({ title: "删除待处理邀请", content: "删除后不会加入该账本，也不会影响对方账本。", success: resolve }));
    if (!modal.confirm) return;
    app.removePendingInvite(code);
    app.initializePromise = null;
    this.onShow();
  },

  goAddBill(e) {
    const type = e?.currentTarget?.dataset?.type || "expense";
    wx.navigateTo({ url: `/pages/addBill/index?type=${type}` });
  },

  goFamily() {
    wx.navigateTo({ url: "/pages/family/index" });
  },

  goBills() {
    wx.switchTab({ url: "/pages/bills/index" });
  },

  goBudget() {
    wx.navigateTo({ url: "/pages/budget/index" });
  },

  _groupRecentBills(bills) {
    const weekdayNames = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
    const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const today = now.getUTCFullYear() + "-" + String(now.getUTCMonth() + 1).padStart(2, "0") + "-" + String(now.getUTCDate()).padStart(2, "0");
    const groups = [];
    const indexMap = {};
    (bills || []).forEach((bill) => {
      const day = (bill.date || "").substring(0, 10);
      if (!day) return;
      if (indexMap[day] === undefined) {
        const [year, month, date] = day.split("-").map(Number);
        const weekday = weekdayNames[new Date(year, month - 1, date).getDay()];
        const title = day === today ? "今天" : (year + "年" + month + "月" + date + "日 " + weekday);
        indexMap[day] = groups.length;
        groups.push({ key: day, title, expense: 0, income: 0, bills: [] });
      }
      const group = groups[indexMap[day]];
      const amount = Number(bill.amount || 0) / 100;
      if (bill.type === "expense") group.expense += amount;
      else if (bill.type === "income") group.income += amount;
      group.bills.push(bill);
    });
    groups.forEach((group) => {
      group.expense = group.expense.toFixed(2);
      group.income = group.income.toFixed(2);
    });
    return groups;
  },

  openAddBill() {
    wx.navigateTo({ url: "/pages/addBill/index?type=expense" });
  },

  noop() {},

  onBrandImageError() { this.setData({ brandImageFailed: true }); },

  onEmptyImageError() { this.setData({ emptyImageFailed: true }); },

  onWelcomeImageError() { this.setData({ welcomeImageFailed: true }); },

  onNetworkImageError() { this.setData({ networkImageFailed: true }); },

  async closeWelcome() {
    wx.setStorageSync("hasSeenWelcome", true);
    wx.removeStorageSync("welcomePending");
    // 云函数初始化可能还在跑（新建账本+种子数据），等它完成
    if (app.initializePromise || !app.globalData.currentFamily) {
      wx.showLoading({ title: "准备中", mask: true });
      try {
        if (!app.initializePromise) app.initializePromise = app.initialize();
        const result = await app.initializePromise;
        wx.hideLoading();
        if (result && result.pendingInvite) {
          this.setData({ showWelcome: false, pendingInvite: result.pendingInvite });
          if (app.setWelcomeActive) app.setWelcomeActive(false);
          return;
        }
      } catch (error) {
        wx.hideLoading();
        // 初始化失败：重置 promise，用户可再次点击重试
        app.initializePromise = null;
        wx.showToast({ title: error.message || "初始化失败，请重试", icon: "none" });
        return;
      }
    }
    this.setData({ showWelcome: false });
    // 欢迎页已看完，按“隐私 → 欢迎 → 公告”的顺序接力弹出新功能公告
    if (app.setWelcomeActive) app.setWelcomeActive(false);
    if (app.pumpAnnouncements) app.pumpAnnouncements();
  },

  // —— 首页最近账单：左滑删除 / 点击编辑 / 引导提示 ——

  // 左滑开始：记录起点位置，切换到跟手模式（无过渡动画）
  onSwipeStart(e) {
    const billId = e.currentTarget.dataset.id;
    const canOperate = e.currentTarget.dataset.canOperate === "true" || e.currentTarget.dataset.canOperate === true;
    // 无操作权限的账单不响应左滑
    if (!canOperate) return;
    // 收起引导（首次左滑即视为已学会）
    this.closeSwipeGuide();
    // 如果当前有其他已展开的账单，先收起
    if (this.data.slidBillId && this.data.slidBillId !== billId) {
      this.setData({ slidBillId: "" });
    }
    const touch = e.touches[0];
    this._swipeStartX = touch.clientX;
    this._swipeStartY = touch.clientY;
    this._swipeBillId = billId;
    this._swipeBaseX = this.data.slidBillId === billId ? -180 : 0;
    this._isDragging = false;
    this._dragDirection = null;
    this.setData({ swipeAnimating: true });
  },

  // 拖动中：跟手移动（只更新当前账单的偏移量）
  onSwipeMove(e) {
    const billId = e.currentTarget.dataset.id;
    if (!this._swipeBillId || this._swipeBillId !== billId) return;
    const canOperate = e.currentTarget.dataset.canOperate === "true" || e.currentTarget.dataset.canOperate === true;
    if (!canOperate) return;
    const touch = e.touches[0];
    const deltaX = touch.clientX - this._swipeStartX;
    const deltaY = touch.clientY - this._swipeStartY;
    // 首次移动时判断方向，纵向滚动则放弃横向滑动
    if (!this._dragDirection) {
      if (Math.abs(deltaX) < 6 && Math.abs(deltaY) < 6) return;
      if (Math.abs(deltaY) > Math.abs(deltaX)) {
        this._dragDirection = "vertical";
        this._swipeBillId = null;
        return;
      }
      this._dragDirection = "horizontal";
      this._isDragging = true;
    }
    if (this._dragDirection !== "horizontal") return;
    // 转换为 rpx 近似值（750rpx = 屏幕宽度）
    const sysInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const rpxRatio = 750 / sysInfo.windowWidth;
    let offsetRpx = this._swipeBaseX + deltaX * rpxRatio;
    // 限制范围：0 到 -180，略加超出回弹的手感
    if (offsetRpx > 0) offsetRpx = offsetRpx * 0.2;
    if (offsetRpx < -220) offsetRpx = -220 + (offsetRpx + 220) * 0.2;
    const map = {};
    map[billId] = Math.round(offsetRpx);
    this.setData({ swipeOffsetMap: Object.assign({}, this.data.swipeOffsetMap, map) });
  },

  // 滑动结束：根据偏移量和速度决定展开或收起
  onSwipeEnd(e) {
    const billId = e.currentTarget.dataset.id;
    if (!this._swipeBillId || this._swipeBillId !== billId) return;
    const canOperate = e.currentTarget.dataset.canOperate === "true" || e.currentTarget.dataset.canOperate === true;
    this._swipeBillId = null;
    if (!canOperate) {
      this.setData({ slidBillId: "", swipeAnimating: false, swipeOffsetMap: {} });
      return;
    }
    // 当前偏移量（rpx）
    const currentOffset = this.data.swipeOffsetMap[billId] !== undefined
      ? this.data.swipeOffsetMap[billId]
      : (this.data.slidBillId === billId ? -180 : 0);
    // 阈值：超过一半（-90rpx）则展开，否则收起
    const shouldOpen = currentOffset < -90;
    this.setData({
      slidBillId: shouldOpen ? billId : "",
      swipeAnimating: false,
      swipeOffsetMap: {}
    });
  },

  // 点击账单主体：有权限才跳编辑页
  onItemTap(e) {
    const billId = e.currentTarget.dataset.id;
    const canOperate = e.currentTarget.dataset.canOperate === "true" || e.currentTarget.dataset.canOperate === true;
    // 已滑开（露出删除按钮）时点击主体视为收起，不跳转，避免误触进编辑
    if (this.data.slidBillId === billId) {
      this.setData({ slidBillId: "" });
      return;
    }
    if (!canOperate) {
      // 普通成员点击别人账单：轻提示，不进编辑
      wx.showToast({ title: "仅管理员或记账人可编辑", icon: "none" });
      return;
    }
    wx.navigateTo({ url: `/pages/addBill/index?billId=${billId}` });
  },

  // 点击删除按钮
  onDeleteTap(e) {
    const billId = e.currentTarget.dataset.id;
    const canOperate = e.currentTarget.dataset.canOperate === "true" || e.currentTarget.dataset.canOperate === true;
    if (!canOperate) {
      wx.showToast({ title: "无删除权限", icon: "none" });
      return;
    }
    const bill = this.data.recentBills.find((item) => item._id === billId);
    if (!bill) return;
    const self = this;
    wx.showModal({
      title: "删除账单",
      content: "删除后不可恢复，确定删除这笔账单吗？",
      success: async (modal) => {
        if (!modal.confirm) {
          self.setData({ slidBillId: "" });
          return;
        }
        try {
          await wx.cloud.callFunction({
            name: "accountingFunctions",
            data: { action: "deleteBill", familyId: app.globalData.currentFamilyId, billId, version: bill.version }
          });
          // 删除成功：从列表移除 + 重新拉一次首页摘要，并标记账单/首页缓存需刷新
          self.setData({ slidBillId: "" });
          app.globalData.billsDirty = true;
          app.globalData.homeSummaryDirty = true;
          // 若本次刷新失败，下次回首页时靠这份增量把缓存里的账单乐观扣掉
          app.queueHomeDelta({
            familyId: app.globalData.currentFamilyId,
            ts: Date.now(),
            remove: { id: billId, type: bill.type, amountCents: Number(bill.amount || 0), date: bill.date }
          });
          wx.showToast({ title: "已删除", icon: "success" });
          self.refreshHome({ silent: true });
        } catch (error) {
          wx.showToast({ title: error.message || "删除失败", icon: "none" });
          self.setData({ slidBillId: "" });
        }
      }
    });
  },

  // 收起删除按钮
  closeDelete() {
    this.setData({ slidBillId: "" });
  },

  // 关闭左滑删除引导提示并记住
  closeSwipeGuide() {
    if (this._swipeGuideTimer) {
      clearTimeout(this._swipeGuideTimer);
      this._swipeGuideTimer = null;
    }
    if (this.data.showSwipeGuide) {
      wx.setStorageSync("hasSeenSwipeGuide", true);
      this.setData({ showSwipeGuide: false });
    }
  },

  async editFamilyName() {
    // 顶部"我的家庭账本"内联编辑：仅管理员可改
    if (!this.data.isOwner) {
      wx.showToast({ title: "仅管理员可修改", icon: "none" });
      return;
    }
    const familyId = this.data.currentFamilyId;
    if (!familyId) return;
    const modal = await new Promise((resolve) => {
      wx.showModal({
        title: "修改账本名称",
        editable: true,
        content: this.data.familyName || "",
        placeholderText: "请输入新的账本名称",
        success: resolve
      });
    });
    if (!modal.confirm) return;
    const name = String(modal.content || "").trim();
    if (!name) {
      wx.showToast({ title: "名称不能为空", icon: "none" });
      return;
    }
    if (name === this.data.familyName) {
      wx.showToast({ title: "名称未变化", icon: "none" });
      return;
    }
    try {
      wx.showLoading({ title: "保存中", mask: true });
      const response = await wx.cloud.callFunction({
        name: "ledgerFunctions",
        data: { action: "renameFamily", familyId, name }
      });
      if (!response.result || !response.result.success) {
        throw new Error(response.result?.message || "修改失败");
      }
      const newName = response.result.name || name;
      // 1) 首页顶部立即更新
      this.setData({ familyName: newName });
      // 2) 同步全局 currentFamily + 缓存（统计/账单等页面从这里读）
      const currentFamily = app.globalData.currentFamily;
      if (currentFamily && currentFamily.id === familyId) {
        app.globalData.currentFamily = { ...currentFamily, name: newName };
        try { wx.setStorageSync("currentFamilyCache", app.globalData.currentFamily); } catch (e) {}
      }
      // 3) 同步首页摘要快照（applyCachedHome 会从这里读 familyName）
      try {
        const cacheKey = `home:summary:${familyId}`;
        const cached = wx.getStorageSync(cacheKey);
        if (cached) {
          cached.familyName = newName;
          wx.setStorageSync(cacheKey, cached);
        }
      } catch (e) {}
      wx.showToast({ title: "已修改", icon: "success" });
    } catch (error) {
      wx.showToast({ title: error.message || "修改失败", icon: "none" });
    } finally {
      wx.hideLoading();
    }
  },

  async openFamilyPicker() {
    try {
      const response = await wx.cloud.callFunction({ name: "ledgerFunctions", data: { action: "listFamilies" } });
      this.setData({ families: response.result.families || [], showFamilyPicker: true });
    } catch (error) {
      wx.showToast({ title: error.message || "加载账本失败", icon: "none" });
    }
  },

  closeFamilyPicker() { this.setData({ showFamilyPicker: false }); },

  async switchFamily(event) {
    const familyId = event.currentTarget.dataset.id;
    try {
      const response = await wx.cloud.callFunction({ name: "ledgerFunctions", data: { action: "getFamilyDetail", familyId } });
      if (!response.result?.success) throw new Error(response.result?.message || "切换账本失败");
      const familyInfo = response.result.family;
      app.onFamilyChange(familyInfo);
      this.setData({
        showFamilyPicker: false,
        loading: true,
        familyName: familyInfo.name || "",
        isOwner: familyInfo.isOwner === true,
        familyAdminName: familyInfo.adminName || ""
      });
      await Promise.all([this.loadFamilyInfo(), this.loadHomeData()]);
    } catch (error) {
      wx.showToast({ title: error.message || "切换账本失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  }
});
