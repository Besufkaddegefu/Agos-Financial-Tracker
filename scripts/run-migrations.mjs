import fs from 'fs';
import path from 'path';
import { neon } from '@neondatabase/serverless';
function loadEnvFile(file){ try{ for(const line of fs.readFileSync(file,'utf8').split(/\r?\n/)){ if(!line||line.startsWith('#')||!line.includes('=')) continue; const i=line.indexOf('='); const k=line.slice(0,i).trim(); if(!process.env[k]) process.env[k]=line.slice(i+1).trim(); } }catch{} }
loadEnvFile('.env.local'); loadEnvFile('.env');
const url=process.env.DATABASE_URL||process.env.NEON_DATABASE_URL; if(!url) throw new Error('DATABASE_URL/NEON_DATABASE_URL missing');
const sql=neon(url);
function splitSql(text){const out=[];let cur='',i=0,inD=false;while(i<text.length){if(text.slice(i,i+2)==='$$'){inD=!inD;cur+='$$';i+=2;continue;}const ch=text[i];if(!inD&&ch===';'){const s=cur.trim();if(s)out.push(s);cur='';i++;continue;}cur+=ch;i++;}const s=cur.trim();if(s)out.push(s);return out.filter(s=>s.replace(/--.*$/gm,'').trim());}
const dir=path.join(process.cwd(),'db','migrations');
const files=fs.readdirSync(dir).filter(f=>/.sql$/i.test(f)).sort();
for(const f of files){ for(const st of splitSql(fs.readFileSync(path.join(dir,f),'utf8'))) await sql.query(st); console.log('applied', f); }
const t=await sql`SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`; console.log('tables:', t.map(r=>r.table_name).join(', '));
