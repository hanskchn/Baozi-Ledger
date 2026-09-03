const app = getApp();
const dailyReminder = require("../../utils/dailyReminder.js");
const { mergePreferences } = require("../../utils/preferences.js");
const { nowShanghai } = require("../../utils/dates.js");

Page({
  data: {
    familyId: "",
    type: "expense",
    amount: "",
    category1: "",
    category2: "",
    category1Icon: "",
    category2Icon: "",
    selectedCategory1: "",
    activeCategory2List: [],
    recentCategories: [],
    date: "",
    showDateTimeSheet: false,
    datePart: "",
    timeHour: "00",
    timeMinute: "00",
    hours: Array.from({ length: 24 }, (v, i) => String(i).padStart(2, "0")),
    minutes: Array.from({ length: 60 }, (v, i) => String(i).padStart(2, "0")),
    account: "",
    memberId: "",
    memberName: "",
    remark: "",
    merchant: "",
    amountError: "",
    categories: [],
    accounts: [],
    members: [],
    preferences: null,
    showCategoryPicker: false,
    saving: false,
    formLoading: false,
    isAdmin: false,
    billId: "",
    billVersion: 0,
    editMode: false
  },

  async onLoad(options) {
    this.setData({ formLoading: true });
    if (options.billId) {
      this.setData({ editMode: true, billId: options.billId, formLoading: true });
      wx.setNavigationBarTitle({ title: "编辑账单" });
    }
    try {
      const initialized = await app.ensureInitialized();
      const familyId = app.globalData.currentFamilyId || initialized.family?.id;
      let currentFamily = app.globalData.currentFamily || initialized.family;
      if (!familyId || !currentFamily) throw new Error("请先确认加入账本");
      // 成员信息缺失时自动恢复：先重新拉取账本详情，再尝试重新初始化，避免直接失败死路
      if (!currentFamily.memberId) {
        currentFamily = await this.resolveCurrentMember(familyId, currentFamily);
      }
      this.setData({
        familyId,
        type: options.type === "income" ? "income" : "expense",
        date: this.formatShanghaiDateTime(),
        memberId: currentFamily.memberId || "",
        memberName: (app.globalData.userInfo || initialized.user)?.nickName || "微信用户",
        isAdmin: currentFamily.role === "admin"
      });
      if (!this.data.memberId) throw new Error("成员信息缺失，请返回首页后重试");
      if (options.billId) {
        const detail = await this.callFunction("getBill", { familyId, billId: options.billId });
        const bill = detail.bill;
        if (!bill.canOperate) throw new Error("你没有编辑这笔账单的权限");
        // 快照原始金额/类型/日期，返回首页时用于乐观扣除旧值
        this._editOriginal = { type: bill.type, amountCents: Number(bill.amount || 0), date: bill.date };
        this.setData({
          billId: bill._id,
          billVersion: bill.version,
          editMode: true,
          type: bill.type,
          amount: (Number(bill.amount || 0) / 100).toFixed(2),
          category1: bill.category1,
          category1Icon: bill.category1Icon || "",
          category2: bill.category2,
          category2Icon: bill.category2Icon || "",
          date: bill.date,
          account: bill.account,
          memberId: bill.memberId,
          memberName: bill.member,
          remark: bill.remark || "",
          merchant: bill.merchant || ""
        });
      }
      await this.loadFormOptions();
    } catch (error) {
      wx.showModal({ title: "加载失败", content: error.message || "无法加载记账信息", showCancel: false });
    } finally {
      this.setData({ formLoading: false });
    }
  },

  // 当全局账本信息缺少当前成员的 memberId 时依次恢复：
  // 1) 重新拉取账本详情（getFamilyDetail 返回 family.memberId，同时刷新全局账本缓存）；
  // 2) 仍缺失则重置初始化 Promise 重新初始化，兼容旧版云函数返回结构或陈旧全局状态。
  async resolveCurrentMember(familyId, currentFamily) {
    try {
      const response = await wx.cloud.callFunction({ name: "ledgerFunctions", data: { action: "getFamilyDetail", familyId } });
      const detail = response.result;
      if (detail && detail.success && detail.family && detail.family.memberId) {
        app.globalData.currentFamily = detail.family;
        return detail.family;
      }
    } catch (error) {
      console.warn("重新拉取账本详情失败，尝试重新初始化恢复", error);
    }
    if (!currentFamily.memberId) {
      app.initializePromise = null;
      const retried = await app.ensureInitialized();
      currentFamily = app.globalData.currentFamily || retried.family || currentFamily;
    }
    return currentFamily;
  },

  formatShanghaiDateTime() {
    return nowShanghai();
  },

  async loadFormOptions() {
    const familyId = this.data.familyId;
    const type = this.data.type;

    // 先读本地缓存立刻渲染，避免空白
    const cached = this.readOptionsCache(familyId, type);
    if (cached) {
      const categories = this.normalizeCategories(cached.categories || []);
      this.setData({
        categories,
        accounts: cached.accounts || [],
        members: this.decorateMembers(cached.members || []),
        preferences: cached.preferences || null
      });
      if (!this.data.editMode) this.applyDefaults();
    }

    // 后台静默刷新
    try {
      const optionsResult = await this.callFunction("listFormOptions", { familyId, type });
      let preferenceResult = { preferences: null };
      try {
        preferenceResult = await this.callFunction("getBillPreferences", { familyId });
      } catch (error) {
        console.warn("加载记账偏好失败，已使用默认值", error);
      }
      const categories = this.normalizeCategories(optionsResult.categories || []);
      const accounts = optionsResult.accounts || [];
      const members = this.decorateMembers(optionsResult.members || []);
      // 以本地“最近使用”为准合并服务端偏好，避免云端旧值覆盖本地刚保存的偏好（U7）
      let currentCached = null;
      try { currentCached = wx.getStorageSync("formOptions:" + familyId) || null; } catch (e) {}
      const preferences = mergePreferences(currentCached && currentCached.preferences, preferenceResult.preferences || null);
      this.setData({ categories, accounts, members, preferences });
      this.writeOptionsCache(familyId, type, { categories: optionsResult.categories || [], accounts, members, preferences });
      if (!this.data.editMode) this.applyDefaults();
    } catch (error) {
      if (!cached) throw error;
      console.warn("后台刷新选项失败，使用缓存数据", error);
    }
  },

  readOptionsCache(familyId, type) {
    try {
      const key = "formOptions:" + familyId;
      const data = wx.getStorageSync(key);
      if (!data || typeof data !== "object") return null;
      if (!data.ts || Date.now() - data.ts > 10 * 60 * 1000) return null;
      if (type === "income" && data.incomeCategories) {
        return { ...data, categories: data.incomeCategories };
      }
      return data;
    } catch (e) { return null; }
  },

  writeOptionsCache(familyId, type, data) {
    try {
      const key = "formOptions:" + familyId;
      const existing = wx.getStorageSync(key) || {};
      const toSave = {
        ts: Date.now(),
        accounts: data.accounts || existing.accounts || [],
        members: data.members || existing.members || [],
        preferences: mergePreferences(existing.preferences, data.preferences || null)
      };
      if (type === "income") {
        toSave.categories = existing.categories || [];
        toSave.incomeCategories = data.categories || [];
      } else {
        toSave.categories = data.categories || [];
        toSave.incomeCategories = existing.incomeCategories || [];
      }
      wx.setStorageSync(key, toSave);
    } catch (e) {}
  },

  updateLocalCacheAfterSave() {
    try {
      const key = "formOptions:" + this.data.familyId;
      const cached = wx.getStorageSync(key) || {};
      const prefKey = this.data.type === "expense" ? "expenseCategory" : "incomeCategory";
      const preferences = cached.preferences ? { ...cached.preferences } : {};
      preferences[prefKey] = { category1: this.data.category1, category2: this.data.category2 };
      preferences.account = this.data.account;
      cached.preferences = preferences;
      cached.ts = Date.now();
      wx.setStorageSync(key, cached);
      // 同步页面内存，避免“再记一笔/切换类型”后保存时用旧的偏好覆盖另一态
      this.setData({ preferences });
    } catch (e) {}
  },

  normalizeCategories(categories) {
    // 防御性过滤：云函数 listCategories 只返回启用项，但本地缓存可能残留已停用分类
    const active = (categories || []).filter((item) => item.enabled !== false);
    if (!active.length || active.some((item) => Array.isArray(item.children))) return active;
    const parents = active.filter((item) => !item.parentId);
    return parents.map((parent) => ({
      id: parent._id || parent.id,
      name: parent.name,
      icon: parent.icon,
      children: active
        .filter((item) => item.parentId === (parent._id || parent.id))
        .map((item) => ({ id: item._id || item.id, name: item.name, icon: item.icon }))
    })).filter((item) => item.children.length > 0);
  },

  applyDefaults() {
    const preferenceKey = this.data.type === "expense" ? "expenseCategory" : "incomeCategory";
    const remembered = this.data.preferences && this.data.preferences[preferenceKey];
    let parent = this.data.categories.find((item) => remembered && item.name === remembered.category1);
    let child = parent && parent.children.find((item) => item.name === remembered.category2);
    if (!parent || !child) {
      const defaultName = this.data.type === "expense" ? "餐饮" : "工资";
      parent = this.data.categories.find((item) => item.name === defaultName) || this.data.categories[0];
      child = parent && parent.children[0];
    }
    const rememberedAccount = this.data.preferences && this.data.preferences.account;
    const matchedAccount = this.data.accounts.find((item) => item.name === rememberedAccount)
      || this.data.accounts.find((item) => item.name === "现金")
      || this.data.accounts[0];
    this.setData({
      category1: parent ? parent.name : "",
      category1Icon: parent ? parent.icon : "",
      category2: child ? child.name : "",
      category2Icon: child ? child.icon : "",
      account: matchedAccount ? matchedAccount.name : ""
    });
  },

  async switchType(event) {
    const type = event.currentTarget.dataset.type;
    if (type === this.data.type) return;
    this.setData({ type, category1: "", category2: "", category1Icon: "", category2Icon: "" });
    const familyId = this.data.familyId;
    // 先从本地缓存取该类型分类
    const cached = this.readOptionsCache(familyId, type);
    if (cached && cached.categories && cached.categories.length) {
      this.setData({ categories: this.normalizeCategories(cached.categories) });
      if (!this.data.editMode) this.applyDefaults();
    }
    // 后台刷新分类
    try {
      const result = await this.callFunction("listCategories", { familyId, type });
      const categories = result.categories || [];
      this.setData({ categories: this.normalizeCategories(categories) });
      // 更新缓存
      const existing = wx.getStorageSync("formOptions:" + familyId) || {};
      const toSave = { ...existing, ts: Date.now() };
      if (type === "income") toSave.incomeCategories = categories;
      else toSave.categories = categories;
      wx.setStorageSync("formOptions:" + familyId, toSave);
      if (!this.data.editMode) this.applyDefaults();
    } catch (error) {
      if (!cached || !cached.categories || !cached.categories.length) {
        wx.showToast({ title: error.message || "加载分类失败", icon: "none" });
      }
    }
  },

  onAmountInput(event) {
    const amount = String(event.detail.value || "");
    let amountError = "";
    const text = amount.trim();
    if (text && !/^(?:0|[1-9]\d{0,6})(?:\.\d{0,2})?$/.test(text)) {
      amountError = "金额最多 7 位整数 + 2 位小数，且需为正数";
    }
    this.setData({ amount, amountError });
  },
  onRemarkInput(event) { this.setData({ remark: event.detail.value }); },
  onMerchantInput(event) { this.setData({ merchant: event.detail.value }); },

  openDateTimeSheet() {
    const value = this.data.date || this.formatShanghaiDateTime();
    const time = value.substring(11, 16) || "00:00";
    this.setData({
      datePart: value.substring(0, 10),
      timeHour: time.substring(0, 2),
      timeMinute: time.substring(3, 5),
      showDateTimeSheet: true
    });
  },

  onDateSheetChange(event) { this.setData({ datePart: event.detail.value }); },
  onHourChange(event) { this.setData({ timeHour: this.data.hours[event.detail.value] }); },
  onMinuteChange(event) { this.setData({ timeMinute: this.data.minutes[event.detail.value] }); },
  confirmDateTimeSheet() {
    this.setData({ date: this.data.datePart + " " + this.data.timeHour + ":" + this.data.timeMinute, showDateTimeSheet: false });
  },
  closeDateTimeSheet() { this.setData({ showDateTimeSheet: false }); },

  selectCategory() {
    if (!this.data.categories.length) {
      wx.showToast({ title: "暂无可用分类", icon: "none" });
      return;
    }
    const selected = this.data.category1
      ? this.data.categories.find((item) => item.name === this.data.category1)
      : this.data.categories[0];
    const recent = this.filterRecentCategories(this.loadRecentCategories());
    this.persistRecentCategories(recent);
    this.setData({
      showCategoryPicker: true,
      selectedCategory1: selected ? selected.name : "",
      activeCategory2List: selected ? selected.children : [],
      recentCategories: recent
    });
  },

  loadRecentCategories() {
    const key = "recentCategories:" + this.data.familyId + ":" + this.data.type;
    try {
      const list = wx.getStorageSync(key);
      return Array.isArray(list) ? list : [];
    } catch (e) { return []; }
  },

  // 过滤掉已停用/已删除的分类（仅保留仍在当前分类树中的二级分类）
  filterRecentCategories(list) {
    if (!Array.isArray(list) || !list.length) return [];
    const validNames = new Set();
    (this.data.categories || []).forEach((parent) => {
      (parent.children || []).forEach((child) => validNames.add(child.name));
    });
    const seen = new Set();
    return list.filter((item) => {
      if (!item || !item.name || !validNames.has(item.name) || seen.has(item.name)) return false;
      seen.add(item.name);
      return true;
    });
  },

  persistRecentCategories(list) {
    const key = "recentCategories:" + this.data.familyId + ":" + this.data.type;
    try { wx.setStorageSync(key, Array.isArray(list) ? list : []); } catch (e) {}
  },

  saveRecentCategory(category2, category2Icon, category1, category1Icon) {
    const key = "recentCategories:" + this.data.familyId + ":" + this.data.type;
    let list = [];
    try { list = wx.getStorageSync(key) || []; } catch (e) { list = []; }
    if (!Array.isArray(list)) list = [];
    list = list.filter((item) => item.name !== category2);
    list.unshift({ name: category2, icon: category2Icon, category1, category1Icon });
    if (list.length > 8) list = list.slice(0, 8);
    try { wx.setStorageSync(key, list); } catch (e) {}
  },

  selectRecentCategory(event) {
    const item = event.currentTarget.dataset.item;
    if (!item) return;
    // 优先用记录时保存的一级分类定位父级，避免不同一级分类下同名二级分类（如"其他"）匹配错父级
    const parent =
      (this.data.categories || []).find((p) =>
        item.category1 && p.name === item.category1 && (p.children || []).some((c) => c.name === item.name)
      ) ||
      (this.data.categories || []).find((p) => (p.children || []).some((c) => c.name === item.name));
    if (!parent) {
      wx.showToast({ title: "该分类已停用", icon: "none" });
      const recent = this.filterRecentCategories(this.loadRecentCategories());
      this.persistRecentCategories(recent);
      this.setData({ recentCategories: recent });
      return;
    }
    this.setData({
      category1: parent.name,
      category1Icon: parent.icon,
      category2: item.name,
      category2Icon: item.icon,
      showCategoryPicker: false
    });
  },

  selectCategory1(event) {
    const category = event.currentTarget.dataset.category;
    this.setData({
      selectedCategory1: category.name,
      activeCategory2List: category.children || []
    });
  },

  selectCategory2(event) {
    const child = event.currentTarget.dataset.child;
    // 优先按二级分类唯一 id 反查父级，其次取侧边栏当前选中的一级分类，
    // 避免不同一级分类下同名二级分类（如"其他"）被解析到第一个同名一级分类
    const parent =
      this.data.categories.find((item) => child.id && item.children.some((c) => c.id === child.id)) ||
      this.data.categories.find((item) => item.name === this.data.selectedCategory1 && item.children.some((c) => c.name === child.name)) ||
      this.data.categories.find((item) => item.children.some((c) => c.name === child.name));
    const cat1 = parent ? parent.name : this.data.category1;
    const cat1Icon = parent ? parent.icon : this.data.category1Icon;
    this.saveRecentCategory(child.name, child.icon, cat1, cat1Icon);
    this.setData({
      category1: cat1,
      category1Icon: cat1Icon,
      category2: child.name,
      category2Icon: child.icon,
      showCategoryPicker: false
    });
  },

  closeCategoryPicker() { this.setData({ showCategoryPicker: false }); },
  stopPropagation() {},

  decorateMembers(members) {
    return (members || []).map((item) => ({ ...item, displayName: item.nickName || item.displayName || "微信用户" }));
  },

  onAccountChange(event) {
    const account = this.data.accounts[Number(event.detail.value)];
    if (account) this.setData({ account: account.name });
  },

  onMemberChange(event) {
    const member = this.data.members[Number(event.detail.value)];
    if (member) this.setData({ memberId: member.memberId, memberName: member.displayName });
  },

  async savePreferences() {
    const preferenceKey = this.data.type === "expense" ? "expenseCategory" : "incomeCategory";
    // 以本地最新缓存为准（每次保存后都会更新），避免用页面初始化时的旧值覆盖另一态
    let latest = this.data.preferences || null;
    try {
      const cached = wx.getStorageSync("formOptions:" + this.data.familyId);
      if (cached && cached.preferences) latest = cached.preferences;
    } catch (e) {}
    const data = {
      familyId: this.data.familyId,
      expenseCategory: latest ? latest.expenseCategory : null,
      incomeCategory: latest ? latest.incomeCategory : null,
      account: this.data.account
    };
    data[preferenceKey] = { category1: this.data.category1, category2: this.data.category2 };
    await this.callFunction("saveBillPreferences", data);
  },

  // 后台触发偏好保存，失败仅警告，不阻塞用户的保存/返回体验
  fireAndForgetPreferences() {
    this.savePreferences().catch((error) => {
      console.warn("保存记账偏好失败，不影响本次记账", error);
    });
  },

  // 打包当前表单为首页乐观增量使用的账单数据（字段与 bills 文档保持一致）。
  // 优先用云端返回的真实账单 id，保证云端数据刷回前点击这行去编辑/删除也有效；
  // 拿不到时退回本地伪 id，仅用于展示（此时应等刷新完成后才可操作该行）。
  buildPendingBill(billId) {
    return {
      id: billId || "local_" + Date.now() + Math.random().toString(36).slice(2, 6),
      type: this.data.type,
      amountCents: Math.round(Number(this.data.amount) * 100),
      category1: this.data.category1,
      category1Icon: this.data.category1Icon,
      category2: this.data.category2,
      category2Icon: this.data.category2Icon,
      date: this.data.date,
      account: this.data.account,
      memberId: this.data.memberId,
      member: this.data.memberName,
      remark: this.data.remark,
      merchant: this.data.merchant
    };
  },

  async saveBill() {
    if (this.data.saving) return;
    const amount = String(this.data.amount).trim();
    if (!/^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) {
      wx.showToast({ title: "请输入有效金额，最多两位小数", icon: "none" });
      return;
    }
    if (!this.data.category2 || !this.data.account || !this.data.memberId) {
      wx.showToast({ title: "请填写完整信息", icon: "none" });
      return;
    }
    this.setData({ saving: true });
    try {
      const billData = {
        familyId: this.data.familyId,
        type: this.data.type,
        amount,
        category1: this.data.category1,
        category2: this.data.category2,
        date: this.data.date,
        account: this.data.account,
        memberId: this.data.memberId,
        remark: this.data.remark,
        merchant: this.data.merchant
      };
      let savedResult = null;
      if (this.data.editMode) {
        savedResult = await this.callFunction("updateBill", { ...billData, billId: this.data.billId, version: this.data.billVersion });
      } else {
        savedResult = await this.callFunction("createBill", billData);
      }
      // 通知账单/统计页跳过缓存、强制刷新一次；首页改走「快照 + 乐观增量」即时渲染
      app.globalData.billsDirty = true;
      app.globalData.homeSummaryDirty = true;
      app.queueHomeDelta({
        familyId: this.data.familyId,
        ts: Date.now(),
        // 编辑 = 扣除旧账（_editOriginal 缺失时由首页按列表命中行扣除）+ 计入新账
        remove: this.data.editMode ? { id: this.data.billId, ...(this._editOriginal || {}) } : undefined,
        add: this.buildPendingBill((savedResult && savedResult.billId) || (this.data.editMode ? this.data.billId : ""))
      });
      // 立刻更新本地选项缓存，下次打开记账页直接显示最新选择，不会闪旧数据
      this.updateLocalCacheAfterSave();
      // 偏好保存挪到后台，不阻塞用户感知的返回/toast
      this.fireAndForgetPreferences();
      if (this.data.editMode) {
        wx.showToast({ title: "已保存" });
        // 仅用于让用户看到 toast，navigateBack 不再被 savePreferences 拖慢
        setTimeout(() => wx.navigateBack(), 400);
        return;
      }
      wx.showModal({
        title: "记账成功",
        content: "是否继续记一笔？",
        cancelText: "返回首页",
        confirmText: "再记一笔",
        success: (modal) => {
          // 续订放在弹窗点击回调里：贴近用户手势发起订阅授权（fire-and-forget，内部有冷却控制）
          dailyReminder.afterBillSaved();
          if (!modal.confirm) {
            wx.navigateBack();
            return;
          }
          this.setData({ amount: "", merchant: "", remark: "", date: this.formatShanghaiDateTime() });
        }
      });
    } catch (error) {
      wx.showToast({ title: error.message || "保存失败", icon: "none" });
    } finally {
      this.setData({ saving: false });
    }
  },

  deleteBill() {
    if (!this.data.editMode || !this.data.billId) return;
    wx.showModal({
      title: "删除账单",
      content: "删除后不可恢复，确定删除这笔账单吗？",
      confirmColor: "#E0503C",
      success: async (modal) => {
        if (!modal.confirm) return;
        this.setData({ saving: true });
        try {
          await this.callFunction("deleteBill", {
            familyId: this.data.familyId,
            billId: this.data.billId,
            version: this.data.billVersion
          });
          app.globalData.billsDirty = true;
          app.globalData.homeSummaryDirty = true;
          // 首页乐观扣除这笔被删的账单（_editOriginal 在编辑模式加载时已快照）
          app.queueHomeDelta({
            familyId: this.data.familyId,
            ts: Date.now(),
            remove: { id: this.data.billId, ...(this._editOriginal || {}) }
          });
          wx.showToast({ title: "已删除", icon: "success" });
          setTimeout(() => wx.navigateBack(), 400);
        } catch (error) {
          wx.showToast({ title: error.message || "删除失败", icon: "none" });
        } finally {
          this.setData({ saving: false });
        }
      }
    });
  },

  async callFunction(type, data = {}) {
    const response = await wx.cloud.callFunction({ name: "accountingFunctions", data: { ...data, action: type } });
    if (!response.result || !response.result.success) {
      console.error("accountingFunctions 调用失败", { type, data, result: response.result });
      throw new Error(response.result && response.result.message ? response.result.message : "操作失败");
    }
    return response.result;
  }
});
