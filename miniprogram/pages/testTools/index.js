const app = getApp();

const OPTIONS = [
  { key: "all", label: "全部数据", desc: "清空所有集合，恢复到全新状态", collections: [], danger: true },
  { key: "bills", label: "账单记录", desc: "只清流水，分类/账户/成员保留", collections: ["bills"] },
  { key: "bills_budgets", label: "账单+预算", desc: "清流水和本月预算", collections: ["bills", "budgets"] },
  { key: "preferences", label: "记账偏好", desc: "记住的默认分类/账户，回到初始状态", collections: ["bill_preferences"] },
  { key: "feedbacks", label: "意见反馈", desc: "清空所有反馈记录", collections: ["feedbacks"] },
  { key: "logs", label: "操作日志", desc: "清空审计日志", collections: ["operation_logs"] }
];

const COLLECTION_LABELS = {
  users: "用户",
  families: "家庭账本",
  family_members: "账本成员",
  family_invites: "邀请码",
  categories: "分类",
  accounts: "账户",
  bills: "账单",
  budgets: "预算",
  bill_preferences: "记账偏好",
  operation_logs: "操作日志",
  initialization_locks: "初始化锁",
  feedbacks: "意见反馈"
};

Page({
  data: {
    options: OPTIONS.map((item) => ({ ...item, counts: "" }))
  },

  async onLoad() {
    try {
      const response = await wx.cloud.callFunction({ name: "feedbackFunctions", data: { action: "whoami" } });
      if (!response.result?.isDeveloper) {
        wx.showModal({
          title: "无权限",
          content: "仅开发者可访问该页面",
          showCancel: false,
          success: () => wx.navigateBack({ fail: () => wx.switchTab({ url: "/pages/index/index" }) })
        });
        return;
      }
    } catch (error) {
      wx.showToast({ title: "权限校验失败", icon: "none" });
      return;
    }
    this.loadCounts();
  },

  async loadCounts() {
    try {
      const response = await wx.cloud.callFunction({ name: "resetTestData", data: { action: "counts" } });
      const counts = response.result?.counts || {};
      const options = this.data.options.map((item) => {
        const targetCollections = item.key === "all"
          ? Object.keys(COLLECTION_LABELS)
          : item.collections;
        const total = targetCollections.reduce((sum, name) => sum + (counts[name] || 0), 0);
        return { ...item, counts: total > 0 ? String(total) : "" };
      });
      this.setData({ options });
    } catch (error) {
      wx.showToast({ title: error.message || "加载失败", icon: "none" });
    }
  },

  async onClear(event) {
    const key = event.currentTarget.dataset.key;
    const option = OPTIONS.find((item) => item.key === key);
    if (!option) return;
    const confirmText = option.danger ? "全部清除" : "确认清除";
    const content = option.danger
      ? "将清空所有用户、账本、账单等全部数据，此操作不可恢复，确定继续吗？"
      : "确定清除" + option.label + "吗？此操作不可恢复。";
    const modal = await new Promise((resolve) => wx.showModal({
      title: "清除数据",
      content,
      confirmText,
      confirmColor: "#D64545",
      success: resolve
    }));
    if (!modal.confirm) return;
    wx.showLoading({ title: "清除中", mask: true });
    try {
      const data = option.key === "all" ? { action: "clear" } : { action: "clear", collections: option.collections };
      const response = await wx.cloud.callFunction({ name: "resetTestData", data });
      if (!response.result?.success) throw new Error("清除失败");
      wx.hideLoading();
      wx.showToast({ title: "已清除", icon: "success" });
      this.loadCounts();
      // 全部数据清除后，重置本地状态，下次进入会重新初始化
      if (option.key === "all") {
        app.clearSession();
        wx.removeStorageSync("pendingInviteCodes");
      }
    } catch (error) {
      wx.hideLoading();
      wx.showToast({ title: error.message || "清除失败", icon: "none" });
    }
  }
});
