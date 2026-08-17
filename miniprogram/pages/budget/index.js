const app = getApp();

Page({
  data: { month: "", familyId: "", monthBudget: "", monthExpense: "0.00", percent: 0, hasBudget: false },
  async onShow() { await app.ensureInitialized(); const shifted = new Date(Date.now() + 8 * 60 * 60 * 1000); const month = this.data.month || (shifted.getUTCFullYear() + "-" + String(shifted.getUTCMonth() + 1).padStart(2, "0")); this.setData({ familyId: app.globalData.currentFamilyId, month }); await this.load(); },
  onFamilyChanged() {
    const newFamilyId = app.globalData.currentFamilyId;
    if (newFamilyId && newFamilyId === this.data.familyId) return;
    const shifted = new Date(Date.now() + 8 * 60 * 60 * 1000);
    this.setData({ monthBudget: "", monthExpense: "0.00", percent: 0, hasBudget: false, familyId: newFamilyId, month: shifted.getUTCFullYear() + "-" + String(shifted.getUTCMonth() + 1).padStart(2, "0") });
    this.load();
  },
  async load() { const [budgetResult, statsResult] = await Promise.all([this.call("getBudget", { familyId: this.data.familyId, month: this.data.month }), this.call("getStats", { familyId: this.data.familyId, month: this.data.month })]); const amount = budgetResult.budget ? budgetResult.budget.amount / 100 : 0; const expense = Number(statsResult.totalExpense || 0); this.setData({ monthBudget: amount ? amount.toFixed(2) : "", monthExpense: expense.toFixed(2), percent: amount ? Math.round(expense / amount * 100) : 0, hasBudget: Boolean(budgetResult.budget) }); },
  onBudgetInput(event) { this.setData({ monthBudget: event.detail.value }); },
  switchMonth(event) { const [year, value] = this.data.month.split("-").map(Number); const next = new Date(year, value - 1 + Number(event.currentTarget.dataset.delta), 1); this.setData({ month: next.getFullYear() + "-" + String(next.getMonth() + 1).padStart(2, "0") }); this.load(); },
  async saveBudget() { try { await this.call("saveBudget", { familyId: this.data.familyId, month: this.data.month, amount: this.data.monthBudget || "0" }); wx.showToast({ title: "已保存" }); await this.load(); } catch (error) { wx.showToast({ title: error.message, icon: "none" }); } },
  async deleteBudget() { const modal = await new Promise((resolve) => wx.showModal({ title: "删除预算", content: "删除后本月不再显示预算预警。", success: resolve })); if (!modal.confirm) return; try { await this.call("deleteBudget", { familyId: this.data.familyId, month: this.data.month }); wx.showToast({ title: "预算已删除" }); await this.load(); } catch (error) { wx.showToast({ title: error.message || "删除失败", icon: "none" }); } },
  async call(action, data) { const response = await wx.cloud.callFunction({ name: "accountingFunctions", data: { ...data, action } }); if (!response.result?.success) throw new Error(response.result?.message || "操作失败"); return response.result; }
});
