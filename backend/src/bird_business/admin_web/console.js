"use strict";

const labels = {observation:"待审观察", reply:"回复", reports:"举报", history:"审核记录"};
const results = {approved:"已通过", rejected:"已驳回", report_kept:"保留被举报内容", report_removed:"已移除被举报内容"};
const get = id => document.getElementById(id);
const state = {csrf:"", tab:"observation", page:1, version:0, saving:false};

function element(tag, text, className) {
  const node = document.createElement(tag);
  node.textContent = text || "";
  if (className) node.className = className;
  return node;
}

function button(text, action, className) {
  const node = element("button",text,className);
  node.type = "button";
  node.addEventListener("click",action);
  return node;
}

function notice(text) {
  get("notice").textContent = text;
  get("notice").hidden = !text;
}

function signedIn(csrf) {
  state.csrf = csrf;
  get("dashboard").hidden = !csrf;
  get("logout").hidden = !csrf;
  get("login").hidden = Boolean(csrf);
  if (!csrf) {
    state.version++;
    get("list").replaceChildren();
    get("tabs").replaceChildren();
  }
}

async function api(path, body) {
  const options = {credentials:"same-origin",cache:"no-store"};
  if (body !== undefined) {
    options.method = "POST";
    options.headers = {"Content-Type":"application/json", "X-Review-CSRF":state.csrf};
    options.body = JSON.stringify(body);
  }
  const response = await fetch("/admin/" + path, options);
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401 && path !== "login") signedIn("");
    if ([404,409].includes(response.status)) throw new Error("这条记录已发生变化，请刷新队列。");
    throw new Error(result.error?.message || "请求未完成，请重试。");
  }
  return result;
}

function selectTab(tab,page) {
  state.tab = tab;
  state.page = page;
  notice("");
  void refresh();
}

async function decide(item,status,label,kind) {
  if (state.saving) return;
  let reason = "";
  if (status === "rejected" && kind === "pending") {
    reason = window.prompt(`退回「${item.title || item.id}」的原因（作者可见）`)?.trim();
    if (!reason) return;
    if (reason.length > 400) { notice("退回原因最多 400 字。"); return; }
  } else if (!window.confirm(`确定${label}「${item.title || item.id}」？`)) return;
  state.saving = true;
  try {
    await api(`actions/${kind}/${encodeURIComponent(item.id)}`, {status,reason});
    notice(`处理成功，已${label}。`);
    await refresh();
  } catch(error) { notice(error.message); }
  finally { state.saving = false; }
}

function observationCard(item) {
  const node=element('article');
  const channel=item.channels.find(entry=>entry.status==='pending' && entry.photo);
  const layout=element('div','','observation-layout');
  if(channel){
    const image=document.createElement('img');
    const link=element('a','','photo');
    link.href='/admin/photos/'+encodeURIComponent(channel.id);
    link.target='_blank';link.rel='noopener noreferrer';
    image.src=link.href;image.loading='lazy';image.alt='放大观察照片';link.append(image);layout.append(link);
  }
  const channels=element('div');
  for(const entry of item.channels){
    const name=entry.channel==='map'?'地图鸟讯':'讨论帖';
    const section=element('section','','review-channel');
    section.append(element('h3',name+' · '+(entry.title||entry.species||'待鉴定')));
    if(entry.body)section.append(element('p',entry.body));
    section.append(element('p',[entry.author,entry.species,entry.date,entry.photo?'公开照片':'隐藏照片',entry.point?`公开区域 ${entry.point.latitude}, ${entry.point.longitude}`:'隐藏地点'].filter(Boolean).join(' · '),'meta'));
    if(entry.status==='pending'){
      const actions=element('div','','actions');
      for(const choice of [['通过','approved'],['退回','rejected']])actions.append(button(choice[0]+name,()=>decide(entry,choice[1],choice[0]+name,'pending'),choice[1]==='approved'?'primary':'danger'));
      section.append(actions);
    }else section.append(element('p',(results[entry.status]||'已撤回')+(entry.reason?' · '+entry.reason:'')));
    channels.append(section);
  }
  layout.append(channels);node.append(layout);return node;
}

function card(item,tab) {
  if(tab==='observation')return observationCard(item);
  const node = element("article");
  const title = tab === "history" ? results[item.status] || item.status : item.title || labels[tab];
  node.append(element("h3",title));
  const created = new Date(item.created).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai",hour12:false});
  node.append(element("div",[created+"（北京时间）",item.author,item.species,item.reviewer].filter(Boolean).join(" · "),"meta"));
  if (item.body) node.append(element("p",item.body));
  if (item.date) node.append(element("p","观察日期　"+item.date,"meta"));
  if (item.point) node.append(element("p",`公开区域中心　${item.point.latitude}，${item.point.longitude}`,"meta"));
  if (item.photo) {
    const link = element("a", "", "photo");
    link.href = "/admin/photos/" + encodeURIComponent(item.id);
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    const image = document.createElement("img");
    image.src = link.href;
    image.loading = "lazy";
    image.alt = "查看提交的观察照片";
    link.append(image);
    node.append(link);
  }
  for (const reason of item.reasons || []) node.append(element("p","举报理由　" + reason));
  node.append(element("div",item.id,"record-id"));
  if (tab !== "history") {
    const reported = tab === "reports";
    const kind = reported ? "report" : "pending";
    const accept = reported ? "保留内容" : "通过";
    const reject = reported ? "移除内容" : "驳回";
    const actions = element("div","","actions");
    actions.append(button(accept,()=>decide(item,"approved",accept,kind),"primary"),
                   button(reject,()=>decide(item,"rejected",reject,kind),"danger"));
    node.append(actions);
  }
  return node;
}

async function refresh() {
  const version = ++state.version;
  const tab = state.tab;
  try {
    const result = await api(`queue?tab=${tab}&page=${state.page}`);
    if (version !== state.version) return;
    state.page = result.page;
    const tabs = Object.entries(labels).map(([name,title])=>{
      const entry = button(title + " " + result.counts[name],()=>selectTab(name,1));
      if (name === tab) entry.setAttribute("aria-current","page");
      return entry;
    });
    get("tabs").replaceChildren(...tabs);
    get("queue-title").textContent = ["post","map","reply"].includes(tab) ? "待审核的"+labels[tab] : labels[tab];
    get("list").replaceChildren(...result.items.map(item=>card(item,tab)));
    if (!result.items.length) get("list").append(element("div","当前没有记录。","empty"));
    get("pages").hidden = result.pages < 2;
    get("page").textContent = `${result.page} / ${result.pages}`;
    get("prev").disabled = result.page === 1;
    get("next").disabled = result.page === result.pages;
  } catch(error) { if (version === state.version || !state.csrf) notice(error.message); }
}

get("credentials").addEventListener("submit",async event=>{
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector("button");
  submit.disabled = true;
  try {
    const result = await api("login",{username:form.elements.username.value,password:form.elements.password.value});
    form.elements.password.value = "";
    signedIn(result.csrf);
    selectTab("observation",1);
  } catch(error) { notice(error.message); }
  finally { submit.disabled = false; }
});
get("logout").addEventListener("click",async()=>{
  try { await api("logout",{}); signedIn(""); notice("已退出管理平台。"); }
  catch(error) { notice(error.message); }
});
get("reload").addEventListener("click",()=>selectTab(state.tab,state.page));
get("prev").addEventListener("click",()=>selectTab(state.tab,state.page-1));
get("next").addEventListener("click",()=>selectTab(state.tab,state.page+1));
api("session").then(result=>{ signedIn(result.csrf); return refresh(); }).catch(error=>{
  signedIn("");
  if(error.message !== "请登录管理平台") notice(error.message);
});
