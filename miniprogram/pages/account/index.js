const app = getApp();

Page({
  data: { accounts: [], familyId: "" },
  async onShow() { await app.ensureInitialized(); this.setData({ familyId: app.globalData.currentFamilyId }); this.load(); },
  onFamilyChanged() {
    const newFamilyId = app.globalData.currentFamilyId;
    if (newFamilyId && newFamilyId === this.data.familyId) return;
    this.setData({ accounts: [], familyId: newFamilyId });
    this.load();
  },
  async load() { const result = await this.call("listAllAccounts", { familyId: this.data.familyId }); this.setData({ accounts: (result.accounts || []).map((item) => ({ ...item, id: item._id })) }); },
  addAccount() { wx.showModal({ title: "新增账户", editable: true, placeholderText: "账户名称", success: async (result) => { if (!result.confirm || !result.content.trim()) return; try { await this.call("createAccount", { familyId: this.data.familyId, name: result.content.trim() }); this.load(); } catch (error) { wx.showToast({ title: error.message, icon: "none" }); } } }); },
  editAccount(event) { const current = this.data.accounts.find((item) => item.id === event.currentTarget.dataset.id); wx.showModal({ title: "编辑账户", editable: true, content: current?.name || "", success: async (result) => { if (!result.confirm || !result.content.trim()) return; try { await this.call("renameAccount", { familyId: this.data.familyId, accountId: event.currentTarget.dataset.id, name: result.content.trim() }); this.load(); } catch (error) { wx.showToast({ title: error.message, icon: "none" }); } } }); },
  toggleAccount(event) { const enabled = event.currentTarget.dataset.enabled !== false; wx.showModal({ title: enabled ? "删除或停用账户" : "恢复账户", content: enabled ? "未被账单使用的账户将删除，已使用账户将停用且保留历史。确定继续吗？" : "恢复后可在新增账单中重新使用，确定继续吗？", success: async (result) => { if (!result.confirm) return; try { await this.call(enabled ? "deleteAccount" : "setAccountEnabled", { familyId: this.data.familyId, accountId: event.currentTarget.dataset.id, enabled: true }); this.load(); } catch (error) { wx.showToast({ title: error.message, icon: "none" }); } } }); },
  async call(action, data) { const response = await wx.cloud.callFunction({ name: "accountingFunctions", data: { ...data, action } }); if (!response.result?.success) throw new Error(response.result?.message || "操作失败"); return response.result; }
});
