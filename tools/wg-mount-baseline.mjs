/** Mount the immutable WG0 build beside the isolated WG preview for same-port comparison. */
import { cpSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
const old=resolve('artifacts/wg0-webgl/dist'), current=resolve('artifacts/wg-current/dist');
if(!existsSync(`${old}/garden.html`)||!existsSync(`${current}/garden.html`))throw Error('Build both frozen WG0 and current first');
mkdirSync(`${current}/baseline`,{recursive:true});
for(const file of readdirSync(old))if(file.endsWith('.html'))cpSync(`${old}/${file}`,`${current}/baseline/${file}`);
cpSync(`${old}/assets`,`${current}/assets`,{recursive:true,force:false,errorOnExist:false});
console.log('Frozen WG0: http://127.0.0.1:4801/baseline/garden.html');
