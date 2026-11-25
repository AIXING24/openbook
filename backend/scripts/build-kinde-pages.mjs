import {mkdir,copyFile,writeFile,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const directory=process.argv[2]?resolve(process.argv[2]):fileURLToPath(new URL('../.pages-output/',import.meta.url));
// Keep the server response and the browser fixture sourced from the same HTML.
const page=await readFile(new URL('../../client/ledger-test.html',import.meta.url),'utf8');
await writeFile(new URL('../ledger-page.mjs',import.meta.url),'// Generated from client/ledger-test.html by the Pages build.\nexport const ledgerTestHtml='+JSON.stringify(page)+';\n');
await mkdir(directory+'/auth',{recursive:true});
await promisify(execFile)(fileURLToPath(new URL('../node_modules/.bin/esbuild',import.meta.url)),[fileURLToPath(new URL('../kinde-pages.mjs',import.meta.url)),'--bundle','--format=esm','--platform=browser','--target=es2022','--outfile='+directory+'/_worker.js']);
await copyFile(new URL('../../client/email-session.mjs',import.meta.url),directory+'/auth/email-session.mjs');
await copyFile(new URL('../../client/kinde-validation.mjs',import.meta.url),directory+'/auth/test-client.mjs');
await promisify(execFile)(fileURLToPath(new URL('../node_modules/.bin/esbuild',import.meta.url)),[fileURLToPath(new URL('../../client/ledger-validation.mjs',import.meta.url)),'--bundle','--format=esm','--platform=browser','--target=es2022','--outfile='+directory+'/auth/ledger-client.mjs']);
await writeFile(directory+'/index.html','<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>GainTrace 连接测试</title><h1>GainTrace 访问正常</h1></html>');
console.log(JSON.stringify({directory,bundle:'_worker.js',authentication:'disabled until explicit pilot configuration'}));
