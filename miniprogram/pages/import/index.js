const app = getApp();
const brand = require("../../utils/brand");

Page({
  data: { fileName: "", fileID: "", previewData: [], memberMappings: [], importing: false, previewing: false, familyId: "", total: 0, lastBatchId: "", hasBrandAssets: brand.available, emptyImageFailed: false, doneImageFailed: false },
  async onLoad() { await app.ensureInitialized(); this.setData({ familyId: app.globalData.currentFamilyId }); },
  chooseFile() {
    wx.chooseMessageFile({ count: 1, type: "file", extension: ["xlsx"], success: async (selected) => {
      const file = selected.tempFiles[0];
      if (!file || !/\.xlsx$/i.test(file.name)) { wx.showToast({ title: "请选择 xlsx 文件", icon: "none" }); return; }
      this.setData({ previewing: true, previewData: [], fileName: file.name });
      try {
        const uploaded = await wx.cloud.uploadFile({ cloudPath: "imports/" + Date.now() + "-" + file.name, filePath: file.path });
        const result = await this.call("previewImport", { familyId: this.data.familyId, fileID: uploaded.fileID });
        this.setData({ fileID: uploaded.fileID, previewData: result.rows || [], memberMappings: result.memberMappings || [], total: result.total || 0 });
      } catch (error) { wx.showToast({ title: error.message || "文件解析失败", icon: "none" }); this.setData({ fileName: "", fileID: "", memberMappings: [] }); }
      finally { this.setData({ previewing: false }); }
    } });
  },
  async confirmImport() {
    if (!this.data.fileID || this.data.importing) return;
    this.setData({ importing: true });
    try {
      const result = await this.call("confirmImport", { familyId: this.data.familyId, fileID: this.data.fileID });
      wx.showModal({ title: "导入完成", content: "成功导入 " + result.imported + " 条，跳过 " + result.skipped + " 条重复或无效账单。", showCancel: false });
      this.setData({ fileName: "", fileID: "", previewData: [], memberMappings: [], total: 0, lastBatchId: result.batchId });
    } catch (error) {
      if (error.batchId) {
        this.setData({ lastBatchId: error.batchId, fileName: "", fileID: "" });
        wx.showModal({ title: "导入未完全完成", content: "已导入 " + (error.imported || 0) + " 条后中断，可撤销本次已导入的账单。", showCancel: false });
      } else {
        wx.showToast({ title: error.message || "导入失败", icon: "none" });
      }
    }
    finally { this.setData({ importing: false }); }
  },
  async rollbackLastImport() {
    if (!this.data.lastBatchId) return;
    const confirmed = await new Promise((resolve) => wx.showModal({ title: "撤销本次导入", content: "只会删除本次导入的账单，确定继续吗？", success: resolve }));
    if (!confirmed.confirm) return;
    try { const result = await this.call("rollbackImport", { familyId: this.data.familyId, batchId: this.data.lastBatchId }); wx.showToast({ title: "已撤销 " + result.removed + " 条" }); this.setData({ lastBatchId: "" }); } catch (error) { wx.showToast({ title: error.message || "撤销失败", icon: "none" }); }
  },
  async call(action, data) { const response = await wx.cloud.callFunction({ name: "accountingFunctions", data: { ...data, action } }); if (!response.result?.success) { const err = new Error(response.result?.message || "操作失败"); err.batchId = response.result?.batchId || ""; err.imported = response.result?.imported; throw err; } return response.result; },
  onEmptyImageError() { this.setData({ emptyImageFailed: true }); },
  onDoneImageError() { this.setData({ doneImageFailed: true }); }
});
