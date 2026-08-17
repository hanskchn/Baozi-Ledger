const app = getApp();
const brand = require("../../utils/brand");

Page({
  data: { keyword: "", results: [], loading: false, familyId: "", hasBrandAssets: brand.available, emptyImageFailed: false },
  async onLoad() { await app.ensureInitialized(); this.setData({ familyId: app.globalData.currentFamilyId }); },
  onInput(event) {
    this.setData({ keyword: event.detail.value });
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.onSearch(), 350);
  },
  async onSearch() {
    const keyword = this.data.keyword.trim();
    if (!keyword) { this.setData({ results: [] }); return; }
    this.setData({ loading: true });
    try {
      const result = await this.call("searchBills", { familyId: this.data.familyId, keyword });
      this.setData({ results: (result.bills || []).map((bill) => ({ ...bill, id: bill._id, icon: bill.category2Icon || "📝", amount: (bill.amount / 100).toFixed(2) })) });
    } catch (error) { wx.showToast({ title: error.message || "搜索失败", icon: "none" }); }
    finally { this.setData({ loading: false }); }
  },
  onItemTap(event) { wx.navigateTo({ url: "/pages/billDetail/index?id=" + event.currentTarget.dataset.id }); },
  async call(action, data) { const response = await wx.cloud.callFunction({ name: "accountingFunctions", data: { ...data, action } }); if (!response.result?.success) throw new Error(response.result?.message || "操作失败"); return response.result; },
  onEmptyImageError() { this.setData({ emptyImageFailed: true }); }
});
