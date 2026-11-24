# 阿里云与 GPU 容器部署

小程序使用 `https://api.auroraliu.cn`。在阿里云 DNS 把主机记录 `api` 的 A 记录改为 `39.103.59.117`。宝塔 Nginx 为该子域名运行独立站点。微信登录和观察记录转到本机 8200，识别请求经本机 18000 转到 GPU。

## 1. 填写微信凭据

在微信公众平台进入项目 AppID `wx6746d0442771cbde` 的开发设置，准备该小程序的 AppSecret。然后在 **Windows PowerShell** 执行以下命令，看到提示后在终端输入 AppSecret，按回车。输入时文字隐藏。服务将凭据保存在阿里云 `/etc/bird-assistant/business.env`，权限为 `0600`。成功时命令退出并返回 PowerShell。

```powershell
ssh -t root@39.103.59.117 "/opt/bird-assistant/venv/bin/python /opt/bird-assistant/backend/deploy/course/configure-business.py wechat && systemctl restart bird-business"
```

## 2. 连接 GPU

在 **WSL** 运行以下命令。需要 Windows 现有的阿里云 SSH 凭据、GPU 容器别名 `bird-gpu-new` 和 GPU 平台的登录密码。脚本会安装运行代码，配置专用隧道账号和签名密钥，并启动模型。切换会中断原测试脚本管理的推理进程几分钟；遇到未知的 8000 端口进程时，脚本会提示检查。容器内的 `/root/shared-nvme/bird-assistant/backend` 和 `/root/venvs/bird-vision` 提供原有模型配置和 Python 环境。

```bash
cd /home/ljc/bird-assistant
bash backend/deploy/course/deploy.sh gpu
```

脚本最后访问公网 `/api/v1/vision/readyz`。看到 `status` 为 `ready`，且 YOLO 与 BioCLIP 的 `device` 均为 `cuda:0`，表示从 HTTPS 到模型的整条链路已就绪。此时可以关闭 WSL。

**容器重启。** 在 GPU 平台的开机任务中添加以下前台命令，让平台每次启动容器时拉起 supervisor，并保留平台提供的 SSH 服务。部署脚本已经为当前容器启动了一份 supervisor；将命令设为下次开机执行即可。

```bash
/base/mambaforge/bin/supervisord -n -c /root/.local/share/bird-personal/deploy/course/gpu-supervisord.conf
```

容器重建会清除本地文件时，需要恢复 GPU Python 环境、挂载共享盘，随后重跑 `deploy.sh gpu`。`/root/.local/share/bird-personal` 存放运行代码和 supervisor 日志。课程机旧版签发的令牌到期或重新打开体验版后，由新服务重新登录。

## 3. 配置微信并真机验收

1. 在公众平台的「开发管理 → 开发设置 → 服务器域名」添加 `request 合法域名` 为 `https://api.auroraliu.cn`，`socket 合法域名` 为 `wss://api.auroraliu.cn`。填写域名即可。照片和帧使用 `wx.request`，实时识别事件使用 `wx.connectSocket`。
2. 在 Windows 微信开发者工具打开 `C:\Users\HP\WeChatProjects\bird-assistant\miniprogram`，确认 AppID。刷新服务器域名，启用域名和 HTTPS 证书校验，上传体验版。Windows 和 WSL 工程的真机默认地址均为 `https://api.auroraliu.cn`。开发者工具模拟器默认走本机联调服务。
3. 用体验成员的手机打开体验版。选取一张鸟图，检查检测框和鸟种候选。再授权相机并开启实时识别，确认画面连续更新。关闭 WSL，切换手机移动数据复测。完成当前 AppID 在微信后台提示的备案、隐私声明、服务类目和提审项目，提交审核，通过后发布。

## 4. 检查、备份与旧机收尾

`api.auroraliu.cn` 由独立的 Nginx 站点 `zz-bird-assistant-api.conf` 处理。宝塔博客站点只绑定博客域名。如果 `nginx -t` 提示 `conflicting server name "api.auroraliu.cn"`，在宝塔博客的「域名管理」里解除 API 子域名的重复绑定，保留 DNS 的 A 记录，再从公网验证就绪接口和微信登录。

| 验收项 | 检查方式 | 预期 |
| --- | --- | --- |
| 博客首页 | 浏览器打开 `https://auroraliu.cn/` | 原网站首页 |
| 登录保护 | 手机浏览器打开 `https://api.auroraliu.cn/api/v1/observations` | `401`，错误码 `AUTH_REQUIRED` |
| GPU 链路 | 手机浏览器打开 `https://api.auroraliu.cn/api/v1/vision/readyz` | `ready` 和 `cuda:0` |
| 微信身份与模型 | 真机先选图，再开启实时识别 | 能登录、收到识别结果和实时更新 |

若模型接口返回 `502`，先在阿里云执行 `curl -fsS http://127.0.0.1:18000/readyz`，再在 GPU 执行 `curl -fsS http://127.0.0.1:8000/readyz`。GPU 本机成功而阿里云失败时，查 GPU 的 supervisor 隧道日志及阿里云 SSH 入站规则。微信登录返回 `503` 时，检查 AppSecret 配置和阿里云到微信 API 的网络；业务日志用 `journalctl -u bird-business -n 50 --no-pager` 查看。

业务 SQLite 数据库在 `/var/lib/bird-business/observations.sqlite3`。使用 SQLite 在线备份或在停写期间备份，另行安全备份 `/etc/bird-assistant/business.env`。识别页当前把用户选定的记录保存在手机本地。若学校服务器曾产生业务数据，应在停用前单独备份并核对。阿里云的 `bird-api-certificate.timer` 每 15 分钟检查项目域名解析及证书，到期前自动续签。

## 重新部署阿里云服务

项目使用 Alibaba Cloud Linux 3 的 Python 3.11 和已有的宝塔 Nginx。Python 3.11 缺失时在服务器执行 `yum install -y python3.11 python3.11-pip certbot`。WSL 执行以下命令可重新安装业务服务和 Nginx 路由；已有凭据与数据库会保留。独立站点配置在 `/www/server/panel/vhost/nginx/zz-bird-assistant-api.conf`。

```bash
cd /home/ljc/bird-assistant
bash backend/deploy/course/deploy.sh server
```
