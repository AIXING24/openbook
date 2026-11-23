// Optional diagnostic-only DNS resolution. Keeps original HTTPS SNI and CA checks.
import {Agent,setGlobalDispatcher} from 'undici';
import {lookup} from 'node:dns';
export async function configureValidationDns(hostname) {
  if(process.env.GAINTRACE_USE_DOH !== '1')return {mode:'system-dns'};
  const response=await fetch('https://cloudflare-dns.com/dns-query?name='+encodeURIComponent(hostname)+'&type=A',{headers:{accept:'application/dns-json'}});
  const data=await response.json();
  const addresses=(data.Answer||[]).filter(x=>x.type===1 && x.name===hostname).map(x=>x.data);
  if(!response.ok || !addresses.length)throw new Error('Official DNS query failed');
  setGlobalDispatcher(new Agent({connect:{lookup:(host,options,callback)=>{
    if(host!==hostname)return lookup(host,options,callback);
    return options.all?callback(null,addresses.map(address=>({address,family:4}))):callback(null,addresses[0],4);
  }}}));
  return {mode:'diagnostic Cloudflare DNS-over-HTTPS',host:hostname,addresses,certificateValidation:'enabled; original hostname preserved',productionBrowserAccessProven:false};
}
