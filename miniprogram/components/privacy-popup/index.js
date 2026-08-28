const app = getApp();

Component({
  data: {
    show: false
  },

  lifetimes: {
    attached() {
      if (!wx.getPrivacySetting) return;
      if (app.registerPrivacyPopup) app.registerPrivacyPopup(this);
      wx.getPrivacySetting({
        success: (res) => {
          if (res.needAuthorization) this.open();
        }
      });
    },
    detached() {
      if (app.unregisterPrivacyPopup) app.unregisterPrivacyPopup(this);
    }
  },

  methods: {
    noop() {},

    open() {
      this.setData({ show: true });
      // 上报展示状态，新功能公告等后续弹层会避让，保证隐私指引最先出现
      if (app.setPrivacyPopupOpen) app.setPrivacyPopupOpen(true);
    },

    close() {
      this.setData({ show: false });
      if (app.setPrivacyPopupOpen) app.setPrivacyPopupOpen(false);
    },

    openContract() {
      if (wx.openPrivacyContract) {
        wx.openPrivacyContract({ fail: () => wx.showToast({ title: "暂时无法打开", icon: "none" }) });
      }
    },

    handleAgree() {
      this.close();
      if (app.resolvePrivacyAuthorization) app.resolvePrivacyAuthorization({ event: "agree", buttonId: "agree-btn" });
    },

    handleDisagree() {
      this.close();
      if (app.resolvePrivacyAuthorization) app.resolvePrivacyAuthorization({ event: "disagree" });
    }
  }
});
