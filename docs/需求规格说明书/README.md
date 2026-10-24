# 羽迹软件需求规格说明书

- 可编辑源文件：`羽迹观鸟助手_软件需求规格说明书_V1.1.md`
- 提交文件：`羽迹观鸟助手_软件需求规格说明书_V1.1.pdf`
- 生成程序：`generate_pdf.py`

重新生成：

```bash
sudo apt-get install fonts-wqy-zenhei  # Debian/Ubuntu；已有中文字体时可跳过
python3 -m pip install reportlab
python3 docs/需求规格说明书/generate_pdf.py
```

PDF 使用仓库可追踪的 Markdown 作为唯一正文来源。修改需求后应递增文档版本、补充修订记录并重新生成 PDF，不应直接编辑 PDF。
