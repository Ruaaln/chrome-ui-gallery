/* DevLens Manifest V3 service worker: local per-tab buffers and panel message bus. */
'use strict';
let panelWindowId=null;
let panelTabId=null;
let sourceTabId=null;
const tabBuffers=new Map();
const MAX=500;
function buffer(tabId) {
  if(!tabBuffers.has(tabId))tabBuffers.set(tabId,{events:[],url:''});
  return tabBuffers.get(tabId);
}
function sendToPanel(message) {
  if(panelWindowId===null)return;
  chrome.runtime.sendMessage(message).catch(()=>{});
}
function selectTab(tabId) {
  if(typeof tabId!=='number')return;
  sourceTabId=tabId;
  chrome.storage.session.set({devlens_active_tab:tabId}).catch(()=>{});
}
function openPanel(tabId) {
  selectTab(tabId);
  const data=tabId!==null?buffer(tabId):{events:[],url:''};
  if(panelWindowId!==null){
    chrome.windows.get(panelWindowId).then(()=>{
      chrome.windows.update(panelWindowId,{focused:true}).catch(()=>{});
      sendToPanel({action:'panelSourceChanged',sourceTabId,events:data.events,url:data.url});
    }).catch(()=>{panelWindowId=null;panelTabId=null;createPanel()});
    return;
  }
  createPanel();
}
function createPanel() {
  chrome.windows.create({url:chrome.runtime.getURL('panel/panel.html'),type:'popup',width:1100,height:660},win=>{
    if(chrome.runtime.lastError||!win)return;
    panelWindowId=win.id;
    panelTabId=win.tabs?.[0]?.id??null;
  });
}
chrome.runtime.onMessage.addListener((msg,sender,respond)=>{
  if(!msg||typeof msg.action!=='string')return false;
  if(msg.action==='logEntry'){
    const tabId=sender.tab?.id;
    if(typeof tabId!=='number'||!msg.entry)return false;
    const b=buffer(tabId);
    b.events.push(msg.entry);
    if(b.events.length>MAX)b.events.shift();
    if(tabId===sourceTabId)sendToPanel({action:'newEntry',sourceTabId:tabId,entry:msg.entry});
    return false;
  }
  if(msg.action==='openPanel'){
    const tabId=sender.tab?.id??null;
    if(tabId!==null){
      const b=buffer(tabId);
      b.events=Array.isArray(msg.events)?msg.events.slice(-MAX):b.events;
      b.url=typeof msg.url==='string'?msg.url.slice(0,4000):b.url;
    }
    openPanel(tabId);
    return false;
  }
  if(msg.action==='openPanelFromPopup'){
    chrome.tabs.query({active:true,lastFocusedWindow:true}).then(tabs=>openPanel(tabs[0]?.id??null)).catch(()=>openPanel(null));
    return false;
  }
  if(msg.action==='getPanelData'){
    (async()=>{
      const stored=await chrome.storage.session.get('devlens_active_tab');
      const id=sourceTabId??stored.devlens_active_tab??null;
      if(typeof id==='number')sourceTabId=id;
      const b=typeof id==='number'?buffer(id):{events:[],url:''};
      // If the worker was suspended, retrieve the current content-script buffer.
      if(typeof id==='number'&&!b.events.length){
        try {
          const live=await chrome.tabs.sendMessage(id,{action:'getEvents'});
          if(Array.isArray(live?.events)){
            b.events=live.events.slice(-MAX);
            b.url=live.url||b.url;
          }
        }catch(_){}
      }
      respond({sourceTabId:id,events:b.events,url:b.url});
    })().catch(()=>respond({sourceTabId:null,events:[],url:''}));
    return true;
  }
  if(msg.action==='clearLogs'){
    const id=typeof msg.sourceTabId==='number' ? msg.sourceTabId : (sender.tab?.id===panelTabId ? sourceTabId : (sender.tab?.id??sourceTabId));
    if(typeof id==='number'){
      buffer(id).events=[];
      chrome.tabs.sendMessage(id,{action:'clearLogs'}).catch(()=>{});
    }
    sendToPanel({action:'clearLogs',sourceTabId:id});
    return false;
  }
  if(msg.action==='updateSettings'||msg.action==='toggleHUD'){
    chrome.tabs.query({active:true,lastFocusedWindow:true}).then(tabs=>{
      if(tabs[0])chrome.tabs.sendMessage(tabs[0].id,msg).catch(()=>{});
    }).catch(()=>{});
    return false;
  }
  return false;
});
chrome.windows.onRemoved.addListener(windowId=>{
  if(windowId===panelWindowId){panelWindowId=null;panelTabId=null;sourceTabId=null}
});
chrome.tabs.onRemoved.addListener(tabId=>{
  tabBuffers.delete(tabId);
  if(tabId===sourceTabId)sourceTabId=null;
});
