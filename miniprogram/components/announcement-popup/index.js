const app = getApp();

// 新功能上线一次性通知弹窗。
// 展示条件由 App.shouldShowAnnouncement 控制（本地一次性标记），
// 任意关闭路径（知道了 / 去开启）都会写入已读标记，之后不再弹出。
// 展示时序：隐私保护指引 → 欢迎页 → 公告（见 openIfNeeded 中的三道门槛）。
const SETTLE_DELAY = 1500;

Component({
  data: {
    show: false
  },

  lifetimes: {
    attached() {
      if (app.registerAnnouncementPopup) app.registerAnnouncementPopup(this);
      // 冷启动时序：App.onShow 可能早于页面组件 attached，这里补一次兜底。
      // 延迟片刻再判定，让隐私授权 / 欢迎页的展示状态落定，保证顺序不串。
      this.openIfNeeded(SETTLE_DELAY);
    },
    detached() {
      if (this._showTimer) clearTimeout(this._showTimer);
      if (app.unregisterAnnouncementPopup) app.unregisterAnnouncementPopup(this);
    }
  },

  methods: {
    noop() {},

    // 供 App.onShow / 隐私授权完成 / 欢迎页关闭后重新调度。
    // delay>0 时延后判定，避开冷启动时隐私授权、欢迎页尚未落定的窗口期。
    openIfNeeded(delay) {
      if (delay && delay > 0) {
        if (this._showTimer) clearTimeout(this._showTimer);
        this._showTimer = setTimeout(() => this.openIfNeeded(0), delay);
        return;
      }
      if (this.data.show) return;
      if (this._shouldSkip()) return;
      this.setData({ show: true });
    },

    // 展示门槛：隐私保护指引在展示/待授权 → 跳过；欢迎页在展示 → 跳过（等它关掉后重调）；
    // 已看过公告（本地一次性标记）→ 跳过。
    _shouldSkip() {
      const g = app.globalData || {};
      if (g.privacyPopupOpen === true) return true;
      if (app.privacyAuthorizationResolve) return true;
      if (g.welcomeActive === true) return true;
      // 欢迎页内存态：用户已触发欢迎页但还没看完（云函数初始化期间），公告同样让位
      try {
        if (wx.getStorageSync("welcomePending") && wx.getStorageSync("hasSeenWelcome") !== true) return true;
      } catch (error) {
        // 存储异常继续按已看过处理
      }
      if (app.shouldShowAnnouncement && !app.shouldShowAnnouncement()) return true;
      return false;
    },

    close() {
      this.setData({ show: false });
    },

    handleClose() {
      this.close();
      if (app.markAnnouncementSeen) app.markAnnouncementSeen();
    },

    // 「去开启提醒」：标记已读并跳转「我的」页（提醒设置入口所在）
    handleEnable() {
      this.close();
      if (app.markAnnouncementSeen) app.markAnnouncementSeen();
      wx.switchTab({ url: "/pages/profile/index" });
    }
  }
});
