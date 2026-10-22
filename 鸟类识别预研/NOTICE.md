# 第三方组件与数据来源 / Third-party notices

本项目只做**可行性预研**，代码仓库不包含任何第三方模型权重或原始素材（见 `.gitignore`），
运行时通过 `python scripts/fetch_assets.py` 获取。以下是各方的授权与出处，**上线前必须逐项确认**。

## 1. 模型

| 组件 | 版本 / 文件 | 许可 | 出处 | 对项目的影响 |
|---|---|---|---|---|
| YOLO11n / YOLO11x | `yolo11n.pt` (5.4 MB)、`yolo11x.pt` (109 MB) | **AGPL-3.0** | [ultralytics/ultralytics](https://github.com/ultralytics/ultralytics) | 闭源分发（含小程序）可能触发开源义务；商用需购买 Ultralytics 商业许可，或改用 Apache/MIT 系检测器 |
| BirdNET v2.4 | `BirdNET_GLOBAL_6K_V2.4_Model_FP32.tflite` (49.3 MB)、6522 类标签 | **CC BY-NC-SA 4.0** | [kahst/BirdNET-Analyzer](https://github.com/kahst/BirdNET-Analyzer)，Cornell Lab of Ornithology | **禁止商用**；仅可用于非商业验证。产品化需自训练模型 |
| ResNet50 (IMAGENET1K_V2) | torchvision 权重 (97.8 MB) | BSD-3-Clause（torchvision 代码）+ ImageNet 权重条款 | [pytorch/vision](https://github.com/pytorch/vision) | 仅作链路验证，词表不含目标鸟种 |
| EfficientNet-B0 (IMAGENET1K_V1) | torchvision 权重 (20.5 MB) | 同上 | 同上 | 同上 |

## 2. 测试数据

| 素材 | 许可 | 出处 |
|---|---|---|
| `V1_feeder_slovakia.webm`（喂食器，1280×720） | CC BY-SA（Wikimedia Commons） | [File:Bird feeder in the mountains of Slovakia.webm](https://commons.wikimedia.org/wiki/File:Bird_feeder_in_the_mountains_of_Slovakia.webm) |
| `V2_koolmees_feeders.webm`（山雀喂食器，720×576） | CC BY-SA | [File:Koolmees op vogelfeeders-4961804.webm](https://commons.wikimedia.org/wiki/File:Koolmees_op_vogelfeeders-4961804.webm) |
| `A1`–`A5` 鸟鸣（xeno-canto 录音，经 Commons 转载） | 随各 xeno-canto 记录的 CC 许可 | XC125792、XC129643、XC131316、XC457076、XC489277 |
| `N1_speech.ogg` | CC BY-SA | [File:Watt Wikipedia article spoken version.ogg](https://commons.wikimedia.org/wiki/File:Watt_Wikipedia_article_spoken_version.ogg) |
| `N2_traffic.ogg` | CC BY-SA | [File:Sunday in the city street noise1.ogg](https://commons.wikimedia.org/wiki/File:Sunday_in_the_city_street_noise1.ogg) |
| `N3_wind_synthetic.wav` | 本项目生成（1/f 粉红噪声） | `experiments/prepare_audio.py` |

素材仅用于学术可行性评估，仓库不转存原始文件；转载/再发布请遵守各自许可（尤其 CC BY-SA 的署名与相同方式共享要求，
以及 xeno-canto 录音本身的非商业条款）。

## 3. 运行时与工具

| 组件 | 许可 |
|---|---|
| PyTorch / torchvision | BSD-3-Clause |
| Ultralytics | AGPL-3.0 |
| ai-edge-litert (LiteRT) | Apache-2.0 |
| OpenCV (`opencv-python`) | Apache-2.0 |
| NumPy / SciPy / soundfile / Pillow | BSD 系 |
| imageio-ffmpeg（内含 FFmpeg 二进制） | imageio-ffmpeg: BSD-2；**FFmpeg: LGPL/GPL 取决于构建** |
| mss（屏幕采集） | MIT |
| PyInstaller（打包） | GPL-2.0 **含例外条款**（打包产物不受 GPL 约束） |

## 4. 本项目代码

预研代码的许可证**尚未确定**（由项目负责人决定）。在选定之前，默认按"保留所有权利"处理，
请勿直接用于商业产品。若决定开源，建议：

- 代码：MIT 或 Apache-2.0；
- 同时保留本文件，因为 AGPL 的 YOLO11 与 CC BY-NC-SA 的 BirdNET 会限制整体分发方式。

## 5. 快速核对清单（立项/上线前）

- [ ] 确认 YOLO11 的 AGPL 义务：购买商业许可 / 换检测器 / 仅在服务端使用并开源相应服务
- [ ] 确认 BirdNET 的非商业限制：替换为自训练模型或限定非商业版本
- [ ] 确认 FFmpeg 构建的 LGPL/GPL 状态是否可接受
- [ ] 若再发布测试素材，补齐 CC BY-SA 署名与许可链接
- [ ] 为仓库添加 LICENSE 文件
