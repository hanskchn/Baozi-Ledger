const app = getApp();

const getShanghaiMonth = () => {
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return now.getUTCFullYear() + "-" + String(now.getUTCMonth() + 1).padStart(2, "0");
};

const formatMonthLabel = (month) => {
  const [y, m] = month.split("-");
  return Number(y) + "年" + Number(m) + "月";
};

const getPrevMonth = (month) => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0");
};

Page({
  data: {
    familyId: "",
    month: "",
    monthLabel: "",
    isCurrentMonth: false,
    isAdmin: false,
    isFutureMonth: false,
    budgetAmount: "",
    savedAmount: "",
    monthExpense: "0.00",
    percent: 0,
    remain: "0.00",
    hasBudget: false,
    prevMonthHasBudget: false,
    canCopyPrev: false,
    loading: false
  },

  async onShow() {
    await app.ensureInitialized();
    const familyId = app.globalData.currentFamilyId;
    const isAdmin = app.globalData.currentFamily?.role === "admin";
    const currentMonth = getShanghaiMonth();
    if (!this.data.month) {
      this.setData({ familyId, isAdmin, month: currentMonth });
    } else {
      this.setData({ familyId, isAdmin });
    }
    this.load();
  },

  onFamilyChanged() {
    const newFamilyId = app.globalData.currentFamilyId;
    if (newFamilyId && newFamilyId === this.data.familyId) return;
    this.setData({
      familyId: newFamilyId,
      isAdmin: app.globalData.currentFamily?.role === "admin",
      budgetAmount: "",
      savedAmount: "",
      monthExpense: "0.00",
      percent: 0,
      remain: "0.00",
      hasBudget: false
    });
    this.load();
  },

  _updateMonthMeta() {
    const currentMonth = getShanghaiMonth();
    const [cy, cm] = currentMonth.split("-").map(Number);
    const [y, m] = this.data.month.split("-").map(Number);
    const isCurrentMonth = y === cy && m === cm;
    const isFutureMonth = (y > cy) || (y === cy && m > cm);
    this.setData({
      monthLabel: formatMonthLabel(this.data.month),
      isCurrentMonth,
      isFutureMonth
    });
  },

  async load() {
    if (!this.data.familyId || !this.data.month) return;
    this._updateMonthMeta();
    this.setData({ loading: true });
    try {
      const res = await this.call("getBudgetPageData", {
        familyId: this.data.familyId,
        month: this.data.month
      });
      const budget = res.budget;
      const amount = budget ? (budget.amount / 100).toFixed(2) : "";
      const expense = Number(res.totalExpense || 0);
      const budgetNum = budget ? budget.amount / 100 : 0;
      const percent = budgetNum > 0 ? Math.round((expense / budgetNum) * 100) : 0;
      const remain = budgetNum - expense;
      this.setData({
        savedAmount: amount,
        budgetAmount: amount,
        monthExpense: expense.toFixed(2),
        percent,
        remain: remain.toFixed(2),
        hasBudget: Boolean(budget),
        prevMonthHasBudget: Boolean(res.prevBudget),
        canCopyPrev: Boolean(res.prevBudget),
        loading: false
      });
    } catch (error) {
      this.setData({ loading: false });
      wx.showToast({ title: error.message || "加载失败", icon: "none" });
    }
  },

  onBudgetInput(event) {
    let value = event.detail.value || "";
    value = value.replace(/[^\d.]/g, "");
    const parts = value.split(".");
    if (parts.length > 2) value = parts[0] + "." + parts.slice(1).join("");
    if (parts[1] && parts[1].length > 2) value = parts[0] + "." + parts[1].slice(0, 2);
    if (Number(value) > 99999999.99) value = "99999999.99";
    this.setData({ budgetAmount: value });
  },

  switchMonth(event) {
    const delta = Number(event.currentTarget.dataset.delta);
    this._changeMonthByDelta(delta);
  },

  _changeMonthByDelta(delta) {
    if (this._hasUnsavedChanges()) {
      wx.showModal({
        title: "提示",
        content: "当前预算尚未保存，是否放弃修改？",
        confirmText: "放弃",
        cancelText: "继续编辑",
        success: (res) => {
          if (res.confirm) {
            this._applyMonthChange(delta);
          }
        }
      });
    } else {
      this._applyMonthChange(delta);
    }
  },

  _applyMonthChange(delta) {
    const [y, m] = this.data.month.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    const newMonth = d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0");
    this.setData({ month: newMonth });
    this.load();
  },

  onMonthPickerChange(event) {
    const newMonth = event.detail.value;
    if (newMonth === this.data.month) return;
    if (this._hasUnsavedChanges()) {
      wx.showModal({
        title: "提示",
        content: "当前预算尚未保存，是否放弃修改？",
        confirmText: "放弃",
        cancelText: "继续编辑",
        success: (res) => {
          if (res.confirm) {
            this.setData({ month: newMonth });
            this.load();
          }
        }
      });
    } else {
      this.setData({ month: newMonth });
      this.load();
    }
  },

  _hasUnsavedChanges() {
    const current = (this.data.budgetAmount || "").trim();
    const saved = this.data.savedAmount || "";
    return current !== saved;
  },

  copyPrevBudget() {
    if (!this.data.canCopyPrev) return;
    wx.showLoading({ title: "加载中" });
    this.call("getBudget", {
      familyId: this.data.familyId,
      month: getPrevMonth(this.data.month)
    }).then((res) => {
      wx.hideLoading();
      if (res.budget) {
        const amount = (res.budget.amount / 100).toFixed(2);
        this.setData({ budgetAmount: amount });
      }
    }).catch((error) => {
      wx.hideLoading();
      wx.showToast({ title: error.message || "复制失败", icon: "none" });
    });
  },

  async saveBudget() {
    const amount = (this.data.budgetAmount || "").trim();
    if (!amount || Number(amount) <= 0) {
      wx.showToast({ title: "请输入预算金额", icon: "none" });
      return;
    }
    try {
      await this.call("saveBudget", {
        familyId: this.data.familyId,
        month: this.data.month,
        amount
      });
      wx.showToast({ title: "已保存" });
      app.globalData.homeSummaryDirty = true;
      this.load();
    } catch (error) {
      wx.showToast({ title: error.message || "保存失败", icon: "none" });
    }
  },

  deleteBudget() {
    wx.showModal({
      title: "删除预算",
      content: "删除后本月不再显示预算预警，确定删除？",
      confirmColor: "#E0503C",
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await this.call("deleteBudget", {
            familyId: this.data.familyId,
            month: this.data.month
          });
          wx.showToast({ title: "已删除" });
          app.globalData.homeSummaryDirty = true;
          this.load();
        } catch (error) {
          wx.showToast({ title: error.message || "删除失败", icon: "none" });
        }
      }
    });
  },

  async call(action, data) {
    const response = await wx.cloud.callFunction({
      name: "accountingFunctions",
      data: { ...data, action }
    });
    if (!response.result?.success) {
      throw new Error(response.result?.message || "操作失败");
    }
    return response.result;
  }
});
