const TYPE_TEXT = { bug: "🐛 Bug", suggestion: "💡 建议", other: "💬 其他" };
const STATUS_TEXT = { pending: "待处理", processing: "处理中", resolved: "已解决", closed: "已关闭" };
const STATUS_OPTIONS = [
  { value: "pending", label: "待处理" },
  { value: "processing", label: "处理中" },
  { value: "resolved", label: "已解决" },
  { value: "closed", label: "已关闭" }
];
const FILTERS = [
  { value: "", label: "全部" },
  { value: "pending", label: "待处理" },
  { value: "processing", label: "处理中" },
  { value: "resolved", label: "已解决" }
];

const formatTime = (value) => {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const buildDeviceText = (info) => {
  if (!info || typeof info !== "object") return "";
  const parts = [];
  const model = [info.brand, info.model].filter(Boolean).join(" ").trim();
  if (model) parts.push(model);
  if (info.system) parts.push(info.system);
  if (info.platform) parts.push(info.platform);
  if (info.version) parts.push("微信" + info.version);
  if (info.SDKVersion) parts.push("基础库" + info.SDKVersion);
  return parts.join(" · ");
};

Page({
  data: {
    filters: FILTERS.map((f) => ({ ...f, count: 0 })),
    currentFilter: "",
    list: [],
    loading: false,
    loadingMore: false,
    hasMore: false,
    page: 1,
    pageSize: 20,
    typeText: TYPE_TEXT,
    statusText: STATUS_TEXT,
    statusOptions: STATUS_OPTIONS,
    showDetail: false,
    detail: null,
    replyText: "",
    saving: false
  },

  onLoad() {
    this.refresh();
    this.refreshPendingCount();
  },

  onPullDownRefresh() {
    this.refresh().then(() => this.refreshPendingCount()).then(() => wx.stopPullDownRefresh());
  },

  async call(action, data = {}) {
    const response = await wx.cloud.callFunction({ name: "feedbackFunctions", data: { ...data, action } });
    if (!response.result?.success) {
      if (response.result?.errorCode === "BAD_REQUEST" && response.result?.message?.includes("无权限")) {
        wx.showModal({ title: "无权限", content: "仅开发者可访问反馈管理", showCancel: false });
      }
      throw new Error(response.result?.message || "操作失败");
    }
    return response.result;
  },

  async refreshPendingCount() {
    try {
      const result = await this.call("listAllFeedback", { status: "pending", page: 1, pageSize: 1 });
      const filters = this.data.filters.map((f) => f.value === "pending" ? { ...f, count: result.total } : f);
      this.setData({ filters });
    } catch (error) {
      console.warn("获取待处理数量失败", error);
    }
  },

  async refresh() {
    this.setData({ loading: true, page: 1 });
    try {
      const result = await this.call("listAllFeedback", {
        status: this.data.currentFilter,
        page: 1,
        pageSize: this.data.pageSize
      });
      this.setData({
        list: this.decorate(result.list),
        hasMore: result.hasMore,
        page: 1
      });
    } catch (error) {
      wx.showToast({ title: error.message || "加载失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },

  decorate(list) {
    return list.map((item) => ({ ...item, createTimeText: formatTime(item.createTime) }));
  },

  switchFilter(event) {
    const value = event.currentTarget.dataset.value;
    if (value === this.data.currentFilter) return;
    this.setData({ currentFilter: value });
    this.refresh();
  },

  async loadMore() {
    if (!this.data.hasMore || this.data.loadingMore) return;
    this.setData({ loadingMore: true });
    const nextPage = this.data.page + 1;
    try {
      const result = await this.call("listAllFeedback", {
        status: this.data.currentFilter,
        page: nextPage,
        pageSize: this.data.pageSize
      });
      this.setData({
        list: this.data.list.concat(this.decorate(result.list)),
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
      this.setData({
        showDetail: true,
        detail: { ...result, createTimeText: formatTime(result.createTime), deviceText: buildDeviceText(result.systemInfo) },
        replyText: result.reply || ""
      });
    } catch (error) {
      wx.showToast({ title: error.message || "加载失败", icon: "none" });
    } finally {
      wx.hideLoading();
    }
  },

  closeDetail() {
    this.setData({ showDetail: false, detail: null, replyText: "" });
  },

  noop() {},

  onReplyInput(event) {
    this.setData({ replyText: event.detail.value });
  },

  selectStatus(event) {
    const value = event.currentTarget.dataset.value;
    this.setData({ "detail.status": value });
  },

  previewImage(event) {
    const url = event.currentTarget.dataset.url;
    const urls = event.currentTarget.dataset.urls;
    wx.previewImage({ current: url, urls });
  },

  copyContact(event) {
    const contact = event.currentTarget.dataset.contact;
    if (!contact) return;
    wx.setClipboardData({
      data: String(contact),
      fail: () => wx.showToast({ title: "复制失败", icon: "none" })
    });
  },

  async saveReply() {
    if (this.data.saving || !this.data.detail) return;
    const reply = this.data.replyText.trim();
    const status = this.data.detail.status;
    if (!reply && status === this.data.detail.status) {
      wx.showToast({ title: "回复或状态至少改一项", icon: "none" });
      return;
    }
    this.setData({ saving: true });
    try {
      await this.call("replyFeedback", { id: this.data.detail.id, reply, status });
      wx.showToast({ title: "已保存", icon: "success" });
      this.setData({ showDetail: false, detail: null, replyText: "" });
      this.refresh();
      this.refreshPendingCount();
    } catch (error) {
      wx.showToast({ title: error.message || "保存失败", icon: "none" });
    } finally {
      this.setData({ saving: false });
    }
  }
});
