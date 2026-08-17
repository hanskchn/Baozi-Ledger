const app = getApp();

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
    const date = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const pad = (value) => String(value).padStart(2, "0");
    return date.getUTCFullYear() + "-" + pad(date.getUTCMonth() + 1) + "-" + pad(date.getUTCDate()) + " " + pad(date.getUTCHours()) + ":" + pad(date.getUTCMinutes());
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
      const [categoryResult, accountResult, memberResult] = await Promise.all([
        this.callFunction("listCategories", { familyId, type }),
        this.callFunction("listAccounts", { familyId }),
        this.callFunction("listMembers", { familyId })
      ]);
      let preferenceResult = { preferences: null };
      try {
        preferenceResult = await this.callFunction("getBillPreferences", { familyId });
      } catch (error) {
        console.warn("加载记账偏好失败，已使用默认值", error);
      }
      const categories = this.normalizeCategories(categoryResult.categories || []);
      const accounts = accountResult.accounts || [];
      const members = this.decorateMembers(memberResult.members || []);
      const preferences = preferenceResult.preferences || null;
      this.setData({ categories, accounts, members, preferences });
      this.writeOptionsCache(familyId, type, { categories: categoryResult.categories || [], accounts, members, preferences });
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
        preferences: data.preferences || existing.preferences || null
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
    } catch (e) {}
  },

  normalizeCategories(categories) {
    if (!categories.length || categories.some((item) => Array.isArray(item.children))) return categories;
    const parents = categories.filter((item) => !item.parentId);
    return parents.map((parent) => ({
      id: parent._id || parent.id,
      name: parent.name,
      icon: parent.icon,
      children: categories
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

  onAmountInput(event) { this.setData({ amount: event.detail.value }); },
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

  onDateSheetChange(e) {
    this.setData({ datePart: e.detail.value });
  },

  onHourChange(e) {
    this.setData({ timeHour: this.data.hours[e.detail.value] });
  },

  onMinuteChange(e) {
    this.setData({ timeMinute: this.data.minutes[e.detail.value] });
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
    const recent = this.loadRecentCategories();
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
    this.setData({
      category1: item.category1 || this.data.category1,
      category1Icon: item.category1Icon || this.data.category1Icon,
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
    const parent = this.data.categories.find((item) => item.children.some((c) => c.name === child.name));
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
    const data = {
      familyId: this.data.familyId,
      expenseCategory: this.data.preferences ? this.data.preferences.expenseCategory : null,
      incomeCategory: this.data.preferences ? this.data.preferences.incomeCategory : null,
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
      if (this.data.editMode) {
        await this.callFunction("updateBill", { ...billData, billId: this.data.billId, version: this.data.billVersion });
      } else {
        await this.callFunction("createBill", billData);
      }
      // 通知账单/统计页跳过缓存、强制刷新一次；同时通知首页摘要跳过缓存
      app.globalData.billsDirty = true;
      app.globalData.homeSummaryDirty = true;
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
