// Free hostname connectivity probe and the same mock-only API. No production frontend.
import backend from './worker.mjs';
export default {
  fetch(request,env,context){
    if(new URL(request.url).pathname==='/' && request.method==='GET')return new Response('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GainTrace 连接测试</title><body style="font:17px system-ui;max-width:480px;margin:18vh auto;padding:24px;color:#163b2b"><h1>GainTrace 访问正常</h1><p>这是模拟环境的连接测试，不包含你的持仓或交易数据。</p></body></html>',{headers:{'content-type':'text/html;charset=utf-8','cache-control':'no-store'}});
    return backend.fetch(request,env,context);
  }
};
