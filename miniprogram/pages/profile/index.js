Page({
  data: {
    nickName: "微信用户",
    avatarUrl: "",
    familyName: "我的家庭"
  },

  onShow() {
    // TODO: 加载用户信息
  },

  goFamily() {
    wx.navigateTo({ url: "/pages/family/index" });
  },

  goBudget() {
    wx.navigateTo({ url: "/pages/budget/index" });
  },

  goCategory() {
    wx.navigateTo({ url: "/pages/category/index" });
  },

  goAccount() {
    wx.navigateTo({ url: "/pages/account/index" });
  },

  goImport() {
    wx.navigateTo({ url: "/pages/import/index" });
  },

  goExport() {
    // TODO: 导出数据
  }
});
