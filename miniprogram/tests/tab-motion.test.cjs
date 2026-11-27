const {test} = require('node:test');
const assert = require('node:assert/strict');
const {selectTab} = require('../.test-build/services/tabs.js');

test('taps animate the destination tab, repeat on the current tab and skip failed navigation', () => {
  let component, navigation;
  global.Component = value => { component = value; };
  global.wx = {switchTab:options => { navigation = options; }, showToast(){}};
  require('../.test-build/custom-tab-bar/index.js');
  const bar = () => ({...component.methods,data:{...component.data},setData(values,done){Object.assign(this.data,values);done?.();}});
  const source = bar(), destination = bar();
  const page = {data:{view:'live'},getTabBar:() => destination,setData(){}};
  const tap = index => ({currentTarget:{dataset:{index}}});
  source.switchTab(tap(2));assert.equal(navigation.url,'/pages/identify/index');
  selectTab(page,2);assert.equal(destination.data.pulse,2);
  navigation = undefined;
  destination.switchTab(tap(2));assert.equal(destination.data.pulse,2);assert.equal(navigation,undefined);
  destination.switchTab(tap(4));navigation.fail();
  selectTab(page,4);assert.equal(destination.data.pulse,2);
});
