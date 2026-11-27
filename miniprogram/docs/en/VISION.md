# Vision connections and acceptance

0.4.7 candidate ·26 November2026 ·[Chinese](../VISION.md) ·[Backlog](BACKLOG.md)

The user's0.4.6 baseline stays unchanged. The review candidate defaults both phones and DevTools to `https://api.auroraliu.cn:8080` with normal WeChat authentication. Normal use needs no personal WSL session, GPU SSH alias or running laptop. This client change does not repair the shared upstream502.

Use `curl.exe --noproxy "*" --max-time 15 -i "https://api.auroraliu.cn:8080/api/v1/vision/readyz"` from Windows to capture HTTP status, including an empty-body502. Public200/model-ready must precede actual inference acceptance. The user confirmed502 on26 November; the earlier readiness snapshot is historical.

The optional local path requires a real existing GPU SSH configuration. From the client package root in WSL, run `python3 scripts/vision-dev.py` and leave it open. It reports started only when the SSH child lives and the forwarded readiness endpoint returns ready. It binds only loopback18000/18001.

In DevTools Console, explicitly opt in with `wx.setStorageSync('bird-assistant.vision.devtools-local.v1', true)` and recompile. Only local development needs the DevTools domain-check exemption. Remove the setting with `wx.removeStorageSync('bird-assistant.vision.devtools-local.v1')` and recompile to return to public mode. Phones ignore that flag; an explicit valid HTTPS origin retains precedence.

The local smoke script explicitly uses the bridge and performs real inference. It is not an ordinary user prerequisite. Offline launcher checks use `python3 -m unittest discover -s tests -p test_vision_dev.py -v`; they use no SSH or model requests.

For recovery, the deployment maintainer checks the active Caddy upstream, campus18000 and GPU8000 readiness plus supervised vision/campus-tunnel processes, including any legacy transition route. The moderation admin console does not control these processes. After repair, prove actual photo/live inference on phone Wi-Fi/mobile with local WSL closed, and restart recovery. Audio/combined inference remains unavailable until its provider is connected; imported video is currently retained privately.
