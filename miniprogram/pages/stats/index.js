const app = getApp();

Page({
  data: {
    currentMonth: "",
    monthExpense: 0,
    monthIncome: 0,
    monthBalance: 0,
    categoryStats: [],
    dailyTrend: [],
    chartType: "expense"
  },

  onLoad() {
    const now = new Date();
    const month = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
    const displayMonth = now.getFullYear() + "年" + (now.getMonth() + 1) + "月";
    this.setData({ currentMonth: month, displayMonth });
  },

  onShow() {
    this.loadStats();
  },

  async loadStats() {
    try {
      const currentFamilyId = app.globalData.currentFamilyId;
      if (!currentFamilyId) return;
      
      const result = await wx.cloud.callFunction({
        name: "accountingFunctions",
        data: {
          action: "getStats",
          familyId: currentFamilyId,
          month: this.data.currentMonth
        }
      });
      
      const stats = result.result;
      this.setData({
        monthExpense: stats.totalExpense,
        monthIncome: stats.totalIncome,
        monthBalance: stats.balance,
        categoryStats: stats.categoryStats || [],
        dailyTrend: stats.dailyTrend || []
      });
    } catch (error) {
      console.error("加载统计失败", error);
    }
  },

  switchMonth(e) {
    const delta = e.currentTarget.dataset.delta;
    const [year, mon] = this.data.currentMonth.split("-").map(Number);
    const newDate = new Date(year, mon - 1 + delta, 1);
    const newMonth = newDate.getFullYear() + "-" + String(newDate.getMonth() + 1).padStart(2, "0");
    this.setData({ currentMonth: newMonth });
    this.loadStats();
  },

  switchChartType(e) {
    this.setData({ chartType: e.currentTarget.dataset.type });
  }
});
