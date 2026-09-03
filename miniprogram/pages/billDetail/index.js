const app = getApp();
const { callFunction } = require("../../utils/api.js");

Page({
  data: { billId: "", familyId: "", bill: null, loading: true, canOperate: false, amountInput: "" },

  async onLoad(options) {
    this.setData({ billId: options.id || "" });
    try {
      await app.ensureInitialized();
      if (!app.globalData.currentFamilyId || !app.globalData.currentFamily) throw new Error("请先确认加入账本");
      this.setData({ familyId: app.globalData.currentFamilyId });
      const result = await this.call("getBill", { familyId: this.data.familyId, billId: this.data.billId });
      const bill = result.bill;
      this.setData({ bill, amountInput: (bill.amount / 100).toFixed(2), canOperate: Boolean(bill.canOperate) });
    } catch (error) {
      wx.showToast({ title: error.message || "加载失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },

  startEdit() {
    if (!this.data.canOperate) return;
    wx.navigateTo({ url: "/pages/addBill/index?billId=" + this.data.billId + "&type=" + this.data.bill.type });
  },
  removeBill() {
    if (!this.data.canOperate) return;
    wx.showModal({ title: "删除账单", content: "删除后不可恢复，确定继续吗？", success: async (result) => {
      if (!result.confirm) return;
      try {
        await this.call("deleteBill", { familyId: this.data.familyId, billId: this.data.billId, version: this.data.bill.version });
        const app = getApp();
        app.globalData.billsDirty = true;
        app.globalData.homeSummaryDirty = true;
        wx.showToast({ title: "已删除" });
        setTimeout(() => wx.navigateBack(), 500);
      } catch (error) { wx.showToast({ title: error.message || "删除失败", icon: "none" }); }
    } });
  },

  call(action, data) { return callFunction("accountingFunctions", action, data); }
});
