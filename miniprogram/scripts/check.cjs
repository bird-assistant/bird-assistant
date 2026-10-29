const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const { TmplGroup } = require('glass-easel-template-compiler');
const { StyleSheetTransformer } = require('glass-easel-stylesheet-compiler');
const root = path.resolve(__dirname, '..');
const appRoot = path.join(root, 'app');
const templates = new TmplGroup();
let templateCount = 0;
let stylesheetCount = 0;
function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? files(target) : [target];
  });
}
for (const file of [
  ...files(appRoot),
  ...files(path.join(root, 'scripts')),
  ...files(path.join(root, 'tests')),
]) {
  if (/\.(js|cjs)$/.test(file)) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/require\(['"]([^'"]+)['"]\)/g)) {
      if (!match[1].startsWith('.')) continue;
      const target = path.resolve(path.dirname(file), match[1]);
      assert.ok(
        [target, target + '.js', target + '.cjs', target + '.json'].some(fs.existsSync),
        `${file}: 找不到 ${match[1]}`,
      );
    }
  }
  if (file.endsWith('.json')) {
    const config = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const target of Object.values(config.usingComponents || {})) {
      for (const extension of ['js', 'json', 'wxml', 'wxss']) {
        assert.ok(
          fs.existsSync(path.resolve(path.dirname(file), `${target}.${extension}`)),
          `${file}: 组件 ${target}.${extension} 缺失`,
        );
      }
    }
  }
  if (file.endsWith('.wxml')) {
    const diagnostics = templates.addTmpl(
      path.relative(appRoot, file).replaceAll('\\', '/'),
      fs.readFileSync(file, 'utf8'),
    );
    assert.equal(diagnostics.filter((item) => item.isError).length, 0, JSON.stringify(diagnostics));
    templateCount += 1;
    const js = fs.readFileSync(file.replace(/\.wxml$/, '.js'), 'utf8');
    for (const match of fs
      .readFileSync(file, 'utf8')
      .matchAll(/(?:bind|catch)[a-z:]+="([A-Za-z][A-Za-z0-9]*)"/g)) {
      assert.ok(
        new RegExp(`\\b${match[1]}\\s*\\(`).test(js),
        `${file}: 事件处理器 ${match[1]} 缺失`,
      );
    }
  }
  if (file.endsWith('.wxss')) {
    for (const match of fs.readFileSync(file, 'utf8').matchAll(/@import\s+['"]([^'"]+)['"]/g)) {
      assert.ok(fs.existsSync(path.resolve(path.dirname(file), match[1])), `${file}: 样式导入缺失`);
    }
    const transformer = new StyleSheetTransformer(
      path.relative(appRoot, file),
      fs.readFileSync(file, 'utf8'),
      undefined,
      1,
      true,
    );
    const diagnostics = transformer.extractWarnings();
    assert.equal(diagnostics.filter((item) => item.isError).length, 0, JSON.stringify(diagnostics));
    stylesheetCount += 1;
    transformer.free();
  }
}
const app = JSON.parse(fs.readFileSync(path.join(appRoot, 'app.json'), 'utf8'));
for (const page of app.pages) {
  for (const extension of ['js', 'json', 'wxml', 'wxss'])
    assert.ok(
      fs.existsSync(path.join(appRoot, `${page}.${extension}`)),
      `${page}.${extension} 缺失`,
    );
}
for (const marker of ['public', 'private'])
  assert.ok(fs.existsSync(path.join(appRoot, `assets/marker-${marker}.png`)));
assert.ok(app.requiredPrivateInfos.includes('getLocation'));
console.log('PASS: JavaScript 语法、相对依赖、JSON、页面入口、WXML 事件和标记资源');
console.log(
  `PASS: 微信团队 glass-easel 编译器检查 ${templateCount} 个 WXML、${stylesheetCount} 个 WXSS（不替代开发者工具与真机验收）`,
);
templates.free();
