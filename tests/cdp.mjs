// Minimal browser driver for the real Foundry smoke test. Uses Node's built-in WebSocket.
import {writeFile} from "node:fs/promises";
export class CDP {
  constructor(ws) {
    this.ws=ws;this.next=0;this.pending=new Map();this.events=[];
    ws.addEventListener("message",e=>{
      const m=JSON.parse(e.data);
      if(m.id){const p=this.pending.get(m.id);this.pending.delete(m.id);m.error?p?.reject(Error(JSON.stringify(m.error))):p?.resolve(m.result);}
      else this.events.push(m);
    });
  }
  static async connect(url) {const ws=new WebSocket(url);await new Promise((resolve,reject)=>{ws.addEventListener("open",resolve,{once:true});ws.addEventListener("error",reject,{once:true});});return new CDP(ws);}
  call(method,params={},sessionId) {
    const id=++this.next;
    return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});this.ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
  }
  async eval(expression,sessionId) {
    const r=await this.call("Runtime.evaluate",{expression,awaitPromise:true,returnByValue:true,userGesture:true},sessionId);
    if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);
    return r.result.value;
  }
  async until(expression,sessionId,timeout=30000) {
    const end=Date.now()+timeout;
    while(Date.now()<end){try{const value=await this.eval(expression,sessionId);if(value)return value;}catch{}await new Promise(r=>setTimeout(r,200));}
    throw Error(`Timed out: ${expression}`);
  }
  async page(url,contextId) {
    const {targetId}=await this.call("Target.createTarget",{url,browserContextId:contextId});
    const {sessionId}=await this.call("Target.attachToTarget",{targetId,flatten:true});
    await this.call("Runtime.enable",{},sessionId);await this.call("Page.enable",{},sessionId);
    await this.call("Emulation.setDeviceMetricsOverride",{width:1440,height:1000,deviceScaleFactor:1,mobile:false},sessionId);
    return sessionId;
  }
  async screenshot(path,sessionId) {const r=await this.call("Page.captureScreenshot",{format:"png"},sessionId);await writeFile(path,Buffer.from(r.data,"base64"));}
  close(){this.ws.close();}
}
export async function browser() {return CDP.connect((await (await fetch("http://127.0.0.1:30012/json/version")).json()).webSocketDebuggerUrl);}
