# Independent Qwen writing: account, direct check and DevTools

26 November 2026. This setup needs a Python process and your own hosted Qwen API account; it does not download or run a model and needs no GPU, team API secret, WeChat AppSecret or production database. It supports the existing journal and forum writing actions. A real key and successful model replies are still required; automated checks only verify the integration contract.

## 1. Create the API account

Open [Alibaba Cloud Model Studio / 百炼](https://bailian.console.aliyun.com/), sign in/register and complete the console's account requirements. Choose **华北2（北京）**, create an API key and copy its **API Host**. Enable the models and API billing/quota in that account. Use `qwen-plus` for text and `qwen3-vl-plus` for selected photos, subject to the console's actual model availability/permissions. Keep the key on your computer; do not send it in chat, commit it, put it in the mini-program or include it in screenshots.

Use the console's Beijing API Host followed by `/compatible-mode/v1`, for example `https://llm-YOUR-WORKSPACE.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`. Region/key/host must match. The older DashScope base is still supported by the code; a new account should use the API Host supplied by its console. No coding-plan subscription or GPU rental is required for these ordinary API calls.

Official [key instructions](https://help.aliyun.com/zh/model-studio/get-api-key), [regions/endpoints](https://help.aliyun.com/zh/model-studio/regions) and [HTTP request format](https://help.aliyun.com/en/model-studio/compatibility-of-openai-with-dashscope). Requests here use Python standard-library HTTPS directly to Alibaba Cloud, without an OpenAI service or SDK.

## 2. Prepare the companion source once

Keep the current mini-program project where it is. In another PowerShell terminal, clone the companion source to a separate directory. If this directory already exists, inspect it before updating; do not clone over it or reset local changes.

```powershell
git clone --single-branch --branch fix/forum-media-drafts-0.4.7 https://github.com/NoctisBaguette/bird-assistant.git C:\Workspace\bird-assistant\bird-assistant-ai-test
```

After that command succeeds:

```powershell
& {
    $ErrorActionPreference = 'Stop'
    Set-Location 'C:\Workspace\bird-assistant\bird-assistant-ai-test'
    py -3.12 -m venv .venv
    if ($LASTEXITCODE -ne 0) { throw 'Python environment setup failed.' }
    & .\.venv\Scripts\python.exe -m pip install -e .\backend
    if ($LASTEXITCODE -ne 0) { throw 'Business dependencies did not install.' }
}
```

These are the small business dependencies, without optional GPU/audio runtimes. Existing Python 3.11–3.14 is supported by the project; adapt the `py -3.12` selector to your installed supported Python if necessary. Keep this checkout current with guarded fast-forward updates before later tests.

## 3. Check the provider independently

In the companion checkout, replace `YOUR-API-HOST` with the console's host. The hidden prompt asks for the key; it is kept in memory, not saved. This command makes **one real text API call**, without the shared server or WeChat login:

```powershell
& .\.venv\Scripts\python.exe .\backend\scripts\writing_dev.py --base-url 'https://YOUR-API-HOST/compatible-mode/v1' --check-provider
```

An explicitly chosen image adds one vision-model request:

```powershell
& .\.venv\Scripts\python.exe .\backend\scripts\writing_dev.py --base-url 'https://YOUR-API-HOST/compatible-mode/v1' --check-provider --image 'C:\path\to\your-photo.jpg'
```

Expect validated JSON with title, body and a constrained editable layout choice. Failure exits nonzero; there is no automatic paid retry. Photos are bounded/redrawn and stripped of metadata before sending. These commands can incur API usage; they do not purchase a plan or fund the account. Successful provider output proves this account/model/payload path, not phone connectivity or factual correctness.

## 4. Test the actual mini-program UI

Start the same script without `--check-provider` and keep the terminal open:

```powershell
& .\.venv\Scripts\python.exe .\backend\scripts\writing_dev.py --base-url 'https://YOUR-API-HOST/compatible-mode/v1'
```

It binds only `127.0.0.1:18200`, uses its own writing quota database and does not read the team's `.env`. Starting it makes no provider call. Provider requests start only when you press Generate in the app.

After updating/compiling the private mini-program candidate to 0.4.10, enable this **explicit local mode** in the DevTools app-service console:

```javascript
wx.setStorageSync('bird-assistant.writing.devtools-local.v1', true)
```

The simulator may require its local “Does not verify valid domain names…” setting for loopback HTTP. This setting is for the simulator, not production domain configuration. Open journal writing, enter actual text, generate, inspect the preview, apply and undo. Then test one explicitly selected photo and forum writing. The same production request/response checks are used. Existing drafts/media are retained; do not clear storage.

Disable local writing when finished:

```javascript
wx.removeStorageSync('bird-assistant.writing.devtools-local.v1')
```

The flag is ignored on iPhone/Android/Harmony phone builds. Local testing does not make the current public journal404 or vision502 disappear. Phone use still needs a deployed HTTPS gateway (existing business server or suitable serverless host) with server-only provider credentials and the normal identity/rate limits. It needs no GPU for Qwen writing.

## Optional Doubao / Seedream work

Doubao text/vision APIs can be evaluated separately from [Seedream image generation](https://docs.volcengine.com/docs/ark/image-generation-api?lang=zh). Seedream uses the image-generation endpoint and an authorized Volcengine Ark account/key; a Qwen key cannot call it. An authorized Ark key may cover multiple enabled models. Creating artwork is separate from editable journal text/layout and must preserve original bird photos and observation facts. No Doubao/Seedream migration or paid call has been performed here.
