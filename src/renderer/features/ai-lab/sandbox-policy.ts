import {
  AI_LAB_BRIDGE_CHANNEL,
  AI_LAB_COPY_LAST_ERROR_METHOD,
  AI_LAB_IMAGE_EDIT_METHOD,
} from '@shared/ai-lab-bridge';

/** Adds a network-deny CSP without trusting model-authored policy. */
export function applySandboxPolicy(html: string): string {
  const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; media-src data: blob:; object-src 'none'; base-uri 'none'; form-action 'none'">`;
  const bridge = `<script>${hostBridgeSource()}</script>`;
  if (/<head(?:\s[^>]*)?>/i.test(html)) {
    return html.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}${policy}${bridge}`);
  }
  return html.replace(/<html(?:\s[^>]*)?>/i, (root) => `${root}<head>${policy}${bridge}</head>`);
}

/** Trusted bootstrap injected ahead of model-authored scripts. */
function hostBridgeSource(): string {
  const channel = JSON.stringify(AI_LAB_BRIDGE_CHANNEL);
  const method = JSON.stringify(AI_LAB_IMAGE_EDIT_METHOD);
  const copyMethod = JSON.stringify(AI_LAB_COPY_LAST_ERROR_METHOD);
  return `(()=>{const C=${channel},M=${method},E=${copyMethod},T=190000;function call(method,payload,timeoutMessage){return new Promise((resolve,reject)=>{const requestId=globalThis.crypto?.randomUUID?.()??String(Date.now())+Math.random();const timer=setTimeout(()=>{cleanup();reject(new Error(timeoutMessage));},T);function cleanup(){clearTimeout(timer);removeEventListener('message',onMessage);}function onMessage(event){const data=event.data;if(event.source!==parent||!data||data.channel!==C||data.kind!=='response'||data.requestId!==requestId)return;cleanup();data.ok?resolve(data.result):reject(new Error(data.error||'Host request failed.'));}addEventListener('message',onMessage);parent.postMessage({channel:C,kind:'request',requestId,method,payload},'*');});}function editImage(payload){return call(M,payload,'Image generation timed out.')}function copyLastError(){return call(E,{},'Copying the error timed out.')}Object.defineProperty(globalThis,'yoda',{configurable:false,writable:false,value:Object.freeze({ai:Object.freeze({editImage,copyLastError})})});})();`;
}
