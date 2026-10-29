Component({
  data: { visible: false, contractName: '小程序用户隐私保护指引', error: '' },
  lifetimes: {
    attached() {
      this.activate();
    },
    detached() {
      this.active = false;
    },
  },
  pageLifetimes: {
    show() {
      this.activate();
    },
    hide() {
      this.active = false;
    },
  },
  methods: {
    activate() {
      this.active = true;
      if (!wx.onNeedPrivacyAuthorization) return;
      // 该监听覆盖前一个注册；当前显示页面在 show 时重新注册。
      wx.onNeedPrivacyAuthorization((resolve) => {
        if (!this.active) return;
        this.resolvePrivacy = resolve;
        this.setData({ visible: true, error: '' });
        if (wx.getPrivacySetting)
          wx.getPrivacySetting({
            success: (result) => {
              this.setData({
                contractName: result.privacyContractName || '小程序用户隐私保护指引',
              });
            },
          });
      });
    },
    openContract() {
      wx.openPrivacyContract({
        fail: () => this.setData({ error: '隐私指引未配置或暂不可用，可拒绝并继续手动浏览' }),
      });
    },
    agree() {
      if (this.resolvePrivacy)
        this.resolvePrivacy({ event: 'agree', buttonId: 'location-privacy-agree' });
      this.resolvePrivacy = null;
      this.setData({ visible: false });
    },
    disagree() {
      if (this.resolvePrivacy) this.resolvePrivacy({ event: 'disagree' });
      this.resolvePrivacy = null;
      this.setData({ visible: false });
    },
  },
});
