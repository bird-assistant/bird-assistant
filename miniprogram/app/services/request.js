function request(options) {
  return new Promise((resolve, reject) => {
    wx.request({
      timeout: 12000,
      ...options,
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300) resolve(response.data);
        else
          reject(
            new Error(
              response.statusCode === 401
                ? '登录已过期，请重新登录'
                : response.statusCode === 403
                  ? '暂无访问权限'
                  : '服务请求失败，请稍后重试',
            ),
          );
      },
      // 不回显可能含 Key、内部地址的原始平台错误。
      fail() {
        reject(new Error('网络连接失败，请检查网络后重试'));
      },
    });
  });
}

function authHeader() {
  const token = getApp().globalData.accessToken;
  return token ? { Authorization: `Bearer ${token}` } : {};
}
module.exports = { request, authHeader };
