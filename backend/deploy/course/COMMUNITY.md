# 羽迹社区联调与审核

业务服务在课程机 `49.233.81.227` 的 `127.0.0.1:8200` 运行。小程序通过 `https://api.auroraliu.cn:8080` 使用微信登录、照片上传、地图、讨论和消息接口。Caddy 另将识别请求发给 GPU 容器。关闭 WSL 后，课程机上的两个 systemd 服务仍能工作。

## 用两个微信账号验收

1. 在 Windows 微信开发者工具打开 `C:\Users\HP\WeChatProjects\bird-assistant\miniprogram`，编译并预览。公众平台的 `request`、`uploadFile`、`downloadFile` 合法域名均使用上面的 HTTPS 地址。按当前 AppID 后台提示配置地理位置接口和隐私声明。拒绝定位时仍可在地图上手动选点。
2. 账号 A 拍照或导入照片，在复核页确认一个目标的鸟种，进入「分享观察到社区或地图」。本机拍照记录快门时间和手机型号。相册图片可由用户读取原片的时间和位置，上传服务从保留 EXIF 的原片提取设备、焦距、光圈、曝光时间和 ISO。没有值的字段留空。
3. 点击「只保存为云端私人观察」，从「我的 → 云端私人观察」重新进入。也可在复核后直接选「发布到讨论」和「添加地图鸟讯」。选择是否显示日期、拍摄参数和照片，在预览里核对公开内容后提交。
4. 在「讨论 → 我的发布」查看状态。管理员按下一节审核地图和讨论两条记录。账号 B 可从讨论打开关联鸟讯，再点鸟名查看出现地点和相关讨论。地图按约 0.1° 的网格展示公开位置，私人精确点仅账号 A 可见。
5. 账号 B 可以提出鸟种建议，审核通过后 A 可以采纳。要测试私聊，A 发帖时关闭「匿名署名」，B 从详情点「私聊作者」，A 在「我的 → 鸟友私聊」回复。「我的 → 徽章与成长」展示私人观察和已审核贡献。
6. A 在「我的发布」只撤回地图鸟讯后，B 刷新地图和鸟种地点栏，再确认讨论仍可阅读。

## 在课程机审核

浏览器打开 `https://api.auroraliu.cn:8080/admin/`，账号为 `admin`。首次使用可在 WSL 或 PowerShell 取回独立管理密码：

```bash
ssh ubuntu@49.233.81.227 'sudo cat /etc/bird-assistant/admin-password'
```

在「讨论帖」「地图鸟讯」「回复」选择待审内容，点照片可看大图。点击通过或驳回并确认后，可在「审核记录」核对结果。「举报」展示被举报的内容和理由，允许保留或移除内容。会话有效期为八小时，服务重启后需重新登录。

轮换管理密码时，在课程机执行以下两行，然后重新读取密码。

```bash
sudo python3 /opt/bird-assistant/community-current/deploy/course/admin-credentials.py --rotate
sudo systemctl restart bird-business
```

### 命令行审核

登录 `ssh ubuntu@49.233.81.227` 后执行。审核使用本机接口，凭证由服务器读取。

```bash
review() { sudo env PYTHONPATH=/opt/bird-assistant/community-current/src /opt/bird-assistant/venv/bin/python -m bird_business.moderation "$@"; }
review list
review photo post_实际ID --output /tmp/pending-bird.jpg
review approve post_实际ID
review approve map_实际ID
review approve reply_实际ID
review reject post_实际ID
```

## 外部数据与维护

「讨论 → 外部鸟讯」及首页地图使用 GBIF 的 iNaturalist Research-grade Observations 数据集 `50c9509d-22c7-4a22-a47d-8c48425ef4a7`。当前每天读取中国鸟类 CC0 查询的前 200 条。仅展示能匹配本地鸟种且有可用公开坐标的观察，过滤上游隐藏信息、概化记录和本地名录标出的受威胁物种。每条保留署名、日期、许可和 GBIF 原始记录入口。来源卡可以作为羽迹讨论的引用。上游请求失败保留上次成功快照，成功刷新后撤下已离开窗口的记录。

```bash
systemctl status bird-business community-sync.timer
sudo journalctl -u community-sync.service -n 10
sudo systemctl start community-sync.service
```

从 WSL 根目录重新部署用 `bash backend/deploy/course/deploy-community.sh`。脚本先用 SQLite 在线备份把业务库保存到课程机 `/var/backups/bird-business/` 的本次发布目录，再切换版本并验证 Caddy。发布过程中业务入口检查失败会恢复此前服务配置。

运行 `backend/.venv/bin/python backend/deploy/course/smoke-community.py 鸟类识别预研/results/frames/success_bluetit_f030.jpg` 可用两个临时测试身份经 HTTPS 验证 GPU 推理、照片、私人观察、审核、地图、关联讨论和私聊。验证结束后脚本自动撤回这次产生的公开记录。
