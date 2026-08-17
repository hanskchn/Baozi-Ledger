const app = getApp();

Page({
  data: { type: "expense", categories: [], familyId: "", isAdmin: false },
  async onShow() { await app.ensureInitialized(); this.setData({ familyId: app.globalData.currentFamilyId, isAdmin: app.globalData.currentFamily?.role === "admin" }); this.load(); },
  onFamilyChanged() {
    const newFamilyId = app.globalData.currentFamilyId;
    if (newFamilyId && newFamilyId === this.data.familyId) return;
    this.setData({ categories: [], familyId: newFamilyId, isAdmin: app.globalData.currentFamily?.role === "admin" });
    this.load();
  },
  async load() { const result = await this.call("listAllCategories", { familyId: this.data.familyId, type: this.data.type }); const parents = result.categories.filter((item) => !item.parentId); this.setData({ categories: parents.map((parent) => ({ ...parent, id: parent._id, children: result.categories.filter((item) => item.parentId === parent._id).map((item) => ({ ...item, id: item._id })) })) }); },
  switchType(event) { this.setData({ type: event.currentTarget.dataset.type }); this.load(); },
  addCategory1() { wx.showModal({ title: "新增一级分类", editable: true, placeholderText: "分类名称", success: async (result) => { if (!result.confirm || !result.content.trim()) return; try { await this.call("createCategory", { familyId: this.data.familyId, type: this.data.type, name: result.content.trim(), icon: "❓" }); this.load(); } catch (error) { wx.showToast({ title: error.message, icon: "none" }); } } }); },
  addCategory2(event) { wx.showModal({ title: "新增二级分类", editable: true, placeholderText: "分类名称", success: async (result) => { if (!result.confirm || !result.content.trim()) return; try { await this.call("createCategory", { familyId: this.data.familyId, type: this.data.type, parentId: event.currentTarget.dataset.pid, name: result.content.trim(), icon: "❓" }); this.load(); } catch (error) { wx.showToast({ title: error.message, icon: "none" }); } } }); },
  toggleCategory(event) { const enabled = event.currentTarget.dataset.enabled !== false; wx.showModal({ title: enabled ? "删除或停用分类" : "恢复分类", content: enabled ? "未被账单使用的分类将删除，已使用分类将停用且保留历史。确定继续吗？" : "恢复后可在新增账单中重新使用，确定继续吗？", success: async (result) => { if (!result.confirm) return; try { await this.call(enabled ? "deleteCategory" : "setCategoryEnabled", { familyId: this.data.familyId, categoryId: event.currentTarget.dataset.id, enabled: true }); this.load(); } catch (error) { wx.showToast({ title: error.message, icon: "none" }); } } }); },
  editCategory(event) { const current = this.data.categories.find((item) => item.id === event.currentTarget.dataset.id); wx.showModal({ title: "编辑一级分类", editable: true, content: current?.name || "", success: async (result) => { if (!result.confirm || !result.content.trim()) return; try { await this.call("renameCategory", { familyId: this.data.familyId, categoryId: event.currentTarget.dataset.id, name: result.content.trim() }); this.load(); } catch (error) { wx.showToast({ title: error.message, icon: "none" }); } } }); },
  editChildCategory(event) { const current = this.data.categories.flatMap((item) => item.children).find((item) => item.id === event.currentTarget.dataset.id); wx.showModal({ title: "编辑二级分类", editable: true, content: current?.name || "", success: async (result) => { if (!result.confirm || !result.content.trim()) return; try { await this.call("renameCategory", { familyId: this.data.familyId, categoryId: event.currentTarget.dataset.id, name: result.content.trim() }); this.load(); } catch (error) { wx.showToast({ title: error.message, icon: "none" }); } } }); },
  async call(action, data) { const response = await wx.cloud.callFunction({ name: "accountingFunctions", data: { ...data, action } }); if (!response.result?.success) throw new Error(response.result?.message || "操作失败"); return response.result; }
});
