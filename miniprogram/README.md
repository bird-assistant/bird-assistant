# 羽迹原生微信小程序 · 0.4.14候选

[真机修订与复测](docs/PHONE-REVIEW-0.4.14.md) · [English](docs/en/README.md) · [下一步](docs/NEXT-STEPS.md)

包含首页地图、手帐、识别、讨论、我的五个原生Tab。基于团队已合并0.4.13；本候选尚未原生Compile、上传体验版或部署服务。

## 运行

需要Node.js22.18+或24。在包含package.json的**外层miniprogram目录**依次运行 `npm ci`、`npm run setup`、`npm run verify`，再由开发者工具导入该外层目录。内层miniprogram是打包根，不是工程根。setup保留已有AppID；新克隆先用tourist模板占位，维护者再设置有效AppID及开发者权限。原生Compile和复测通过后再上传。

升级不清存储，保留手帐、编辑历史、草稿和原照片。本机配置、依赖、生成JS、测试缓存、gallery、环境文件和密钥不提交。现有Windows写作助手无需因本轮客户端修订重启；手机使用共享HTTPS服务。

## 本轮范围及限制

本轮增加轻量手帐牌组与整页PNG缩略图、原图导入／快门及持久私人复核、地图定位与稳定排序选项、内容测量弹层、出行折叠、独立收藏卡、常规分享及受保护的纸张手势、布局预算和手机写作就绪检查。

公网手帐路由仍404、视觉readyz502、音频404。全局地图分页需当前业务服务。实际相机尺寸、手势冲突、热量／电量和真机流畅度待验收。等候已实现自适应采样及有限返回帧恢复；完整预拍缓存、连续声音与融合未完成。

客户端329项通过、0失败／跳过；团队后端493通过／51跳过，覆盖率87.02%，模型调用为mock。浏览器布局投影及渲染数据量代理测量不代表原生FPS或Compile通过。用户已上传的是0.4.13，不能作为0.4.14打包成功证据。

源码在 `miniprogram/pages/`、`components/`、`services/` 及field分包；验证工具在tests和scripts。本轮证据见 `docs/PHONE-REVIEW-0.4.14.evidence.json`；`docs/SOURCE-CHECKPOINT.json`只记录历史0.2.9导出。

团队后端部署交接见仓库根目录 `backend/deploy/course/JOURNAL-WRITING.md`。通过任务分支和PR评阅，不直接改团队main。公开团队交接用中文，英文工作说明同步；原48项及R系列继续跟踪。
