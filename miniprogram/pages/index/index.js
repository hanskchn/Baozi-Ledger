const app = getApp();

Page({
  data: {
    familyName: "",
    todayExpense: 0,
    monthExpense: 0,
    monthIncome: 0,
    monthBalance: 0,
    recentBills: [],
    loading: true,
    errorMessage: ""
  },

  async onShow() {
    this.setData({ loading: true, errorMessage: "" });
    try {
      await app.ensureInitialized();
      await Promise.all([this.loadFamilyInfo(), this.loadHomeData()]);
    } catch (error) {
      this.setData({ errorMessage: error.message || "初始化失败，请重试" });
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadFamilyInfo() {
    const currentFamilyId = app.globalData.currentFamilyId;
    if (!currentFamilyId) {
      this.setData({ familyName: "未加入家庭" });
      return;
    }
    
    try {
      const result = await wx.cloud.callFunction({
        name: "ledgerFunctions",
        data: { type: "getFamilyDetail", familyId: currentFamilyId }
      });
      this.setData({ familyName: result.result.family.name });
    } catch (error) {
      console.error("加载家庭信息失败", error);
    }
  },

  async loadHomeData() {
    try {
      const currentFamilyId = app.globalData.currentFamilyId;
      if (!currentFamilyId) return;
      
      // 获取所有账单
      const result = await wx.cloud.callFunction({
        name: "accountingFunctions",
        data: { action: "listBills", familyId: currentFamilyId }
      });
      
      const bills = result.result.bills || [];
      
      // 计算统计数据
      let todayExpense = 0;
      let monthExpense = 0;
      let monthIncome = 0;
      
      const now = new Date();
      const today = this.formatDate(now);
      const month = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
      
      const recentBills = bills
        .filter(b => !b.deleted)
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 10)
        .map(bill => ({
          ...bill,
          displayAmount: (bill.amount / 100).toFixed(2)
        }));
      
      bills.forEach(bill => {
        const amount = bill.amount / 100;
        const billDate = bill.date.substring(0, 10);
        const billMonth = billDate.substring(0, 7);
        
        if (bill.type === "expense") {
          if (billDate === today) todayExpense += amount;
          if (billMonth === month) monthExpense += amount;
        } else {
          if (billMonth === month) monthIncome += amount;
        }
      });
      
      this.setData({
        todayExpense: todayExpense.toFixed(2),
        monthExpense: monthExpense.toFixed(2),
        monthIncome: monthIncome.toFixed(2),
        monthBalance: (monthIncome - monthExpense).toFixed(2),
        recentBills
      });
    } catch (error) {
      console.error("加载首页数据失败", error);
    }
  },

  formatDate(date) {
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  },

  retryInitialize() {
    app.initializePromise = null;
    wx.removeStorageSync("currentFamilyId");
    this.onShow();
  },

  goAddBill(e) {
    const type = e?.currentTarget?.dataset?.type || "expense";
    wx.navigateTo({ url: `/pages/addBill/index?type=${type}` });
  },

  goFamily() {
    wx.navigateTo({ url: "/pages/family/index" });
  }
});
