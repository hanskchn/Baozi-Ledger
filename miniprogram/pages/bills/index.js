const app = getApp();

Page({
  data: {
    bills: [],
    filterMonth: "",
    filterCategory: "",
    filterMember: "",
    filterAccount: "",
    categories: [],
    members: [],
    accounts: []
  },

  onLoad() {
    const now = new Date();
    const month = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
    this.setData({ filterMonth: month });
  },

  async onShow() {
    try {
      await app.ensureInitialized();
      await Promise.all([this.loadOptions(), this.loadBills()]);
    } catch (error) {
      wx.showToast({ title: error.message || "加载失败", icon: "none" });
    }
  },

  async loadOptions() {
    try {
      const familyId = app.globalData.currentFamilyId;
      if (!familyId) return;
      
      const [catRes, memRes, accRes] = await Promise.all([
        wx.cloud.callFunction({ name: "accountingFunctions", data: { action: "listCategories", familyId } }),
        wx.cloud.callFunction({ name: "accountingFunctions", data: { action: "listMembers", familyId } }),
        wx.cloud.callFunction({ name: "accountingFunctions", data: { action: "listAccounts", familyId } })
      ]);
      
      this.setData({
        categories: catRes.result.categories || [],
        members: memRes.result.members || [],
        accounts: accRes.result.accounts || []
      });
    } catch (error) {
      console.error("加载选项失败", error);
    }
  },

  async loadBills() {
    try {
      const familyId = app.globalData.currentFamilyId;
      if (!familyId) return;
      
      const result = await this.callFunction("listBills", {
        familyId,
        month: this.data.filterMonth,
        category: this.data.filterCategory,
        member: this.data.filterMember,
        account: this.data.filterAccount
      });
      
      // 处理数据，添加显示字段
      const bills = (result.bills || []).map(bill => ({
        ...bill,
        displayAmount: (bill.amount / 100).toFixed(2)
      }));
      
      this.setData({ bills });
    } catch (error) {
      wx.showToast({ title: error.message || "加载失败", icon: "none" });
    }
  },

  changeMonth(e) {
    const delta = e.currentTarget.dataset.delta;
    const [year, mon] = this.data.filterMonth.split("-").map(Number);
    const newDate = new Date(year, mon - 1 + delta, 1);
    const newMonth = newDate.getFullYear() + "-" + String(newDate.getMonth() + 1).padStart(2, "0");
    this.setData({ filterMonth: newMonth });
    this.loadBills();
  },

  changeFilter(e) {
    const key = e.currentTarget.dataset.key;
    const value = e.currentTarget.dataset.value;
    this.setData({ [key]: value });
    this.loadBills();
  },

  async callFunction(type, data = {}) {
    const response = await wx.cloud.callFunction({ name: "accountingFunctions", data: { ...data, action: type } });
    if (!response.result || !response.result.success) {
      throw new Error(response.result?.message || "操作失败");
    }
    return response.result;
  },

  goSearch() {
    wx.navigateTo({ url: "/pages/search/index" });
  },

  onItemTap(e) {
    // TODO: 编辑账单
  }
});
