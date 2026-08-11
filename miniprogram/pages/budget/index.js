Page({
  data: {
    monthBudget: "",
    monthExpense: 0,
    percent: 0
  },

  onShow() {
    // TODO: 加载预算和本月支出
  },

  onBudgetInput(e) {
    this.setData({ monthBudget: e.detail.value });
  },

  saveBudget() {
    // TODO: 调用云函数保存
    wx.navigateBack();
  }
});
