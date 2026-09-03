const TYPE_OPTIONS = [
  { value: "bug", label: "🐛 Bug" },
  { value: "suggestion", label: "💡 建议" },
  { value: "other", label: "💬 其他" }
];
const TYPE_TEXT = { bug: "🐛 Bug", suggestion: "💡 建议", other: "💬 其他" };
const STATUS_TEXT = { pending: "待处理", processing: "处理中", resolved: "已解决", closed: "已关闭" };
const MAX_IMAGES = 3;

const formatTime = (value) => {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
const { callFunction } = require("../../utils/api.js");

Page({
  data: {
    activeTab: "submit",
    typeOptions: TYPE_OPTIONS,
    typeText: TYPE_TEXT,
    statusText: STATUS_TEXT,
    maxImages: MAX_IMAGES,
    form: { type: "bug", content: "", contact: "", images: [] },
    submitting: false,
    unreadCount: 0,
    mineList: [],
    loadingMine: false,
    loadingMore: false,
    hasMore: false,
    page: 1,
    pageSize: 20,
    isDeveloper: false,
    identity: ""
  },

  onLoad() {
    this.fetchWhoami();
    this.fetchUnreadCount();
  },

  onShow() {
    this.fetchUnreadCount();
    if (this.data.activeTab === "mine" && this.data.mineList.length > 0) {
      this.refreshMine();
    }
  },

  onPullDownRefresh() {
    if (this.data.activeTab === "mine") {
      this.refreshMine().then(() => wx.stopPullDownRefresh());
    } else {
      this.fetchUnreadCount().then(() => wx.stopPullDownRefresh());
    }
  },

  copyIdentity() {
    if (!this.data.identity) return;
    wx.setClipboardData({ data: this.data.identity, success: () => wx.showToast({ title: "已复制身份ID", icon: "none" }) });
  },

  call(action, data = {}) { return callFunction("feedbackFunctions", action, data); },

  async fetchWhoami() {
    try {
      const result = await this.call("whoami");
      this.setData({ isDeveloper: Boolean(result.isDeveloper), identity: result.identity || "" });
    } catch (error) {
      console.warn("获取身份失败", error);
    }
  },

  async fetchUnreadCount() {
    try {
      const result = await this.call("getUnreadCount");
      this.setData({ unreadCount: result.count || 0 });
    } catch (error) {
      console.warn("获取未读数失败", error);
    }
  },

  switchTab(event) {
    const tab = event.currentTarget.dataset.tab;
    if (tab === this.data.activeTab) return;
    this.setData({ activeTab: tab });
    if (tab === "mine" && this.data.mineList.length === 0) {
      this.refreshMine();
    }
  },

  selectType(event) {
    this.setData({ "form.type": event.currentTarget.dataset.value });
  },

  onContentInput(event) {
    this.setData({ "form.content": event.detail.value });
  },

  onContactInput(event) {
    this.setData({ "form.contact": event.detail.value });
  },

  chooseImage() {
    const remain = MAX_IMAGES - this.data.form.images.length;
    if (remain <= 0) return;
    wx.chooseMedia({
      count: remain,
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      sizeType: ["compressed"],
      success: (res) => {
        const paths = res.tempFiles.map((f) => f.tempFilePath);
        this.setData({ "form.images": this.data.form.images.concat(paths).slice(0, MAX_IMAGES) });
      }
    });
  },

  removeImage(event) {
    const index = event.currentTarget.dataset.index;
    const images = this.data.form.images.slice();
    images.splice(index, 1);
    this.setData({ "form.images": images });
  },

  getEnvInfo() {
    let appVersion = "";
    let envVersion = "";
    try {
      const accountInfo = wx.getAccountInfoSync();
      appVersion = accountInfo.miniProgram?.version || "";
      envVersion = accountInfo.miniProgram?.envVersion || "";
    } catch (error) {
      console.warn("获取版本信息失败", error);
    }
    let systemInfo = {};
    try {
      const device = wx.getDeviceInfo ? wx.getDeviceInfo() : {};
      const base = wx.getAppBaseInfo ? wx.getAppBaseInfo() : {};
      systemInfo = { ...device, ...base };
    } catch (error) {
      try { systemInfo = wx.getSystemInfoSync(); } catch (e) { systemInfo = {}; }
    }
    return { appVersion, envVersion, systemInfo };
  },

  getSourcePagePath() {
    const pages = getCurrentPages();
    if (pages.length >= 2) return "/" + pages[pages.length - 2].route;
    return pages.length ? "/" + pages[pages.length - 1].route : "";
  },

  async uploadImages(localPaths) {
    const fileIds = [];
    for (let i = 0; i < localPaths.length; i++) {
      const filePath = localPaths[i];
      const match = filePath.match(/\.(\w+)(?:\?|$)/);
      const ext = (match && match[1] ? match[1] : "jpg").toLowerCase();
      const cloudPath = "feedbacks/" + Date.now() + "-" + Math.random().toString(36).slice(2, 8) + "." + ext;
      const uploaded = await wx.cloud.uploadFile({ cloudPath: cloudPath, filePath: filePath });
      if (uploaded.fileID) fileIds.push(uploaded.fileID);
    }
    return fileIds;
  },

  async submit() {
    if (this.data.submitting) return;
    const content = this.data.form.content.trim();
    if (content.length < 10) {
      wx.showToast({ title: "描述至少 10 个字", icon: "none" });
      return;
    }
    this.setData({ submitting: true });
    wx.showLoading({ title: "提交中...", mask: true });
    try {
      const imageFileIds = await this.uploadImages(this.data.form.images);
      const envInfo = this.getEnvInfo();
      await this.call("submitFeedback", {
        type: this.data.form.type,
        content,
        contact: this.data.form.contact.trim(),
        images: imageFileIds,
        pagePath: this.getSourcePagePath(),
        ...envInfo
      });
      wx.hideLoading();
      wx.showToast({ title: "提交成功，感谢反馈", icon: "success" });
      this.setData({
        form: { type: "bug", content: "", contact: "", images: [] },
        mineList: [],
        page: 1
      });
      setTimeout(() => {
        this.setData({ activeTab: "mine" });
        this.refreshMine();
      }, 800);
    } catch (error) {
      wx.hideLoading();
      wx.showToast({ title: error.message || "提交失败", icon: "none" });
    } finally {
      this.setData({ submitting: false });
    }
  },

  async refreshMine() {
    this.setData({ loadingMine: true, page: 1 });
    try {
      const result = await this.call("listMyFeedback", { page: 1, pageSize: this.data.pageSize });
      this.setData({
        mineList: this.decorateList(result.list),
        hasMore: result.hasMore,
        page: 1
      });
      this.fetchUnreadCount();
    } catch (error) {
      wx.showToast({ title: error.message || "加载失败", icon: "none" });
    } finally {
      this.setData({ loadingMine: false });
    }
  },

  decorateList(list) {
    return list.map((item) => ({
      ...item,
      createTimeText: formatTime(item.createTime)
    }));
  },

  async loadMoreMine() {
    if (!this.data.hasMore || this.data.loadingMore) return;
    this.setData({ loadingMore: true });
    const nextPage = this.data.page + 1;
    try {
      const result = await this.call("listMyFeedback", { page: nextPage, pageSize: this.data.pageSize });
      this.setData({
        mineList: this.data.mineList.concat(this.decorateList(result.list)),
        hasMore: result.hasMore,
        page: nextPage
      });
    } catch (error) {
      wx.showToast({ title: error.message || "加载失败", icon: "none" });
    } finally {
      this.setData({ loadingMore: false });
    }
  },

  async openDetail(event) {
    const id = event.currentTarget.dataset.id;
    wx.showLoading({ title: "加载中...", mask: true });
    try {
      const result = await this.call("getFeedbackDetail", { id });
      wx.hideLoading();
      if (Array.isArray(result.images) && result.images.length > 0) {
        wx.previewImage({ urls: result.images });
      }
      this.refreshMine();
    } catch (error) {
      wx.hideLoading();
      wx.showToast({ title: error.message || "加载失败", icon: "none" });
    }
  }
});
