const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
function loadPage(name, overrides = {}, wx = {}) {
  const filename = path.join(root, 'app/pages', name, 'index.js');
  const actualRequire = createRequire(filename);
  let definition;
  const app = { globalData: { accessToken: '', mapView: null } };
  vm.runInNewContext(
    fs.readFileSync(filename, 'utf8'),
    {
      require: (id) => (Object.hasOwn(overrides, id) ? overrides[id] : actualRequire(id)),
      Page: (value) => {
        definition = value;
      },
      wx,
      getApp: () => app,
      setTimeout,
      clearTimeout,
      console,
    },
    { filename },
  );
  const instance = {
    data: structuredClone(definition.data),
    setData(patch) {
      Object.assign(this.data, structuredClone(patch));
    },
  };
  for (const [key, value] of Object.entries(definition)) {
    if (typeof value === 'function') instance[key] = value.bind(instance);
  }
  return { page: instance, app };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
function loadComponent(name, wx = {}) {
  const filename = path.join(root, 'app/components', name, 'index.js');
  let definition;
  vm.runInNewContext(
    fs.readFileSync(filename, 'utf8'),
    {
      Component: (value) => {
        definition = value;
      },
      wx,
    },
    { filename },
  );
  const component = {
    data: structuredClone(definition.data || {}),
    setData(patch) {
      Object.assign(this.data, structuredClone(patch));
    },
  };
  for (const [name, method] of Object.entries(definition.methods || {}))
    component[name] = method.bind(component);
  return { component, definition };
}
module.exports = { loadPage, loadComponent, deferred, tick, root };
