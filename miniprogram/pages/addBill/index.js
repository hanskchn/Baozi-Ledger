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
    date: "",
    account: "",
    member: "",
    memberName: "",
    remark: "",
    merchant: "",
    categories: [],
    accounts: [],
    members: [],
    preferences: null,
    showCategoryPicker: false,
    saving: false,
    isAdmin: false
  },

  async onLoad(options) {
    try {
      const initialized = await app.ensureInitialized();
      this.setData({
        familyId: initialized.family.id,
        type: options.type === "income" ? "income" : "expense",
        date: this.formatShanghaiDateTime(),
        member: initialized.user.openid,
        memberName: initialized.user.nickName,
        isAdmin: initialized.family.role === "admin"
      });
      await this.loadFormOptions();
    } catch (error) {
      wx.showModal({ title: "加载失败", content: error.message || "无法加载记账信息", showCancel: false });
    }
  },

  formatShanghaiDateTime() {
    const date = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const pad = (value) => String(value).padStart(2, "0");
    return date.getUTCFullYear() + "-" + pad(date.getUTCMonth() + 1) + "-" + pad(date.getUTCDate()) + " " + pad(date.getUTCHours()) + ":" + pad(date.getUTCMinutes());
  },

  async loadFormOptions() {
    const [categoryResult, accountResult, memberResult] = await Promise.all([
      this.callFunction("listCategories", { familyId: this.data.familyId, type: this.data.type }),
      this.callFunction("listAccounts", { familyId: this.data.familyId }),
      this.callFunction("listMembers", { familyId: this.data.familyId })
    ]);
    let preferenceResult = { preferences: null };
    try {
      preferenceResult = await this.callFunction("getBillPreferences", { familyId: this.data.familyId });
    } catch (error) {
      console.warn("加载记账偏好失败，已使用默认值", error);
    }
    const categories = this.normalizeCategories(categoryResult.categories || []);
    this.setData({
      categories,
      accounts: accountResult.accounts || [],
      members: memberResult.members || [],
      preferences: preferenceResult.preferences || null
    });
    this.applyDefaults();
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
    try {
      const result = await this.callFunction("listCategories", { familyId: this.data.familyId, type });
      this.setData({ categories: this.normalizeCategories(result.categories || []) });
      this.applyDefaults();
    } catch (error) {
      wx.showToast({ title: error.message || "加载分类失败", icon: "none" });
    }
  },

  onAmountInput(event) { this.setData({ amount: event.detail.value }); },
  onRemarkInput(event) { this.setData({ remark: event.detail.value }); },
  onMerchantInput(event) { this.setData({ merchant: event.detail.value }); },

  onDateChange(event) {
    this.setData({ date: event.detail.value + " " + (this.data.date.split(" ")[1] || "00:00") });
  },

  selectCategory() {
    if (!this.data.categories.length) {
      wx.showToast({ title: "暂无可用分类", icon: "none" });
      return;
    }
    this.setData({ showCategoryPicker: true });
  },

  selectCategory1(event) {
    const category = event.currentTarget.dataset.category;
    const child = category.children[0];
    this.setData({
      category1: category.name,
      category1Icon: category.icon,
      category2: child ? child.name : "",
      category2Icon: child ? child.icon : ""
    });
  },

  selectCategory2(event) {
    const child = event.currentTarget.dataset.child;
    this.setData({ category2: child.name, category2Icon: child.icon, showCategoryPicker: false });
  },

  closeCategoryPicker() { this.setData({ showCategoryPicker: false }); },
  stopPropagation() {},

  selectAccount() {
    if (!this.data.accounts.length) {
      wx.showToast({ title: "暂无可用账户", icon: "none" });
      return;
    }
    wx.showActionSheet({
      itemList: this.data.accounts.map((item) => item.name),
      success: (result) => this.setData({ account: this.data.accounts[result.tapIndex].name })
    });
  },

  selectMember() {
    if (!this.data.isAdmin) return;
    wx.showActionSheet({
      itemList: this.data.members.map((item) => item.nickName),
      success: (result) => {
        const member = this.data.members[result.tapIndex];
        this.setData({ member: member.openid, memberName: member.nickName });
      }
    });
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

  async saveBill() {
    if (this.data.saving) return;
    const amount = String(this.data.amount).trim();
    if (!/^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) {
      wx.showToast({ title: "请输入有效金额，最多两位小数", icon: "none" });
      return;
    }
    if (!this.data.category2 || !this.data.account || !this.data.member) {
      wx.showToast({ title: "请填写完整信息", icon: "none" });
      return;
    }
    this.setData({ saving: true });
    try {
      await this.callFunction("createBill", {
        familyId: this.data.familyId,
        type: this.data.type,
        amount,
        category1: this.data.category1,
        category1Icon: this.data.category1Icon,
        category2: this.data.category2,
        category2Icon: this.data.category2Icon,
        date: this.data.date,
        account: this.data.account,
        member: this.data.member,
        remark: this.data.remark,
        merchant: this.data.merchant
      });
      try {
        await this.savePreferences();
      } catch (preferenceError) {
        console.warn("保存记账偏好失败，不影响本次记账", preferenceError);
      }
      wx.showToast({ title: "记账成功" });
      setTimeout(() => wx.navigateBack(), 800);
    } catch (error) {
      wx.showToast({ title: error.message || "保存失败", icon: "none" });
    } finally {
      this.setData({ saving: false });
    }
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
