const app = getApp();
const brand = require("../../utils/brand");

Page({
  data: { keyword: "", results: [], loading: false, loadingMore: false, hasMore: true, offset: 0, familyId: "", hasBrandAssets: brand.available, emptyImageFailed: false },
  async onLoad() { await app.ensureInitialized(); this.setData({ familyId: app.globalData.currentFamilyId }); },
  onInput(event) {
    this.setData({ keyword: event.detail.value });
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.onSearch(), 350);
  },
  onSearch() { this.search(false); },
  async search(append) {
    const keyword = this.data.keyword.trim();
    if (!keyword) { this.setData({ results: [], offset: 0, hasMore: true, loading: false, loadingMore: false }); return; }
    const offset = append ? this.data.offset + 20 : 0;
    this.setData(append ? { loadingMore: true } : { loading: true });
    try {
      const result = await this.call("searchBills", { familyId: this.data.familyId, keyword, offset, limit: 20 });
      const mapped = (result.bills || []).map((bill) => ({ ...bill, id: bill._id, icon: bill.category2Icon || "📝", amount: (bill.amount / 100).toFixed(2) }));
      const results = append ? this.data.results.concat(mapped) : mapped;
      this.setData({ results, offset, hasMore: result.hasMore !== false });
    } catch (error) { wx.showToast({ title: error.message || "搜索失败", icon: "none" }); }
    finally { this.setData({ loading: false, loadingMore: false }); }
  },
  onReachBottom() { if (this.data.hasMore && !this.data.loading && !this.data.loadingMore && this.data.results.length) this.search(true); },
  async onPullDownRefresh() { await this.search(false); wx.stopPullDownRefresh(); },
  onItemTap(event) { wx.navigateTo({ url: "/pages/billDetail/index?id=" + event.currentTarget.dataset.id }); },
  async call(action, data) { const response = await wx.cloud.callFunction({ name: "accountingFunctions", data: { ...data, action } }); if (!response.result?.success) throw new Error(response.result?.message || "操作失败"); return response.result; },
  onEmptyImageError() { this.setData({ emptyImageFailed: true }); }
});
