const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
for (const [source, target] of [
  ['project.config.example.json', 'project.config.json'],
  ['app/config/local.example.js', 'app/config/local.js'],
]) {
  const destination = path.join(root, target);
  if (fs.existsSync(destination)) {
    console.log(`保留已有配置：${target}`);
  } else {
    fs.copyFileSync(path.join(root, source), destination);
    console.log(`创建本地配置：${target}`);
  }
}
