import fs from 'fs';
import { neon } from '@neondatabase/serverless';
function loadEnvFile(file){ try{ for(const line of fs.readFileSync(file,'utf8').split(/\r?\n/)){ if(!line||line.startsWith('#')||!line.includes('=')) continue; const i=line.indexOf('='); const k=line.slice(0,i).trim(); if(!process.env[k]) process.env[k]=line.slice(i+1).trim(); } }catch{} }
loadEnvFile('.env.local'); loadEnvFile('.env');
const url=process.env.DATABASE_URL||process.env.NEON_DATABASE_URL; if(!url) throw new Error('DATABASE_URL/NEON_DATABASE_URL missing');
const sql=neon(url);
const wipe = process.argv.includes('--wipe');
if (wipe) {
  await sql`DELETE FROM expenses`; await sql`DELETE FROM revenues`; await sql`DELETE FROM customers`;
  console.log('wiped core tables');
}
const existing = (await sql`SELECT (SELECT count(*)::int FROM customers) c,(SELECT count(*)::int FROM revenues) r,(SELECT count(*)::int FROM expenses) e`)[0];
if (!wipe && (existing.c||existing.r||existing.e)) { console.log('skip seed: data exists', existing); process.exit(0); }

const customers = [
  ['Agos Postpartum Care - Makati','makati@agospc.example','+63 917 100 0001','Agos Makati','active','2025-08-15',185000,'2026-10-28'],
  ['Maria Santos','maria.santos@example.com','+63 917 100 0002',null,'active','2026-01-10',42000,'2026-10-20'],
  ['Luna Families Co.','hello@lunafamilies.example','+63 917 100 0003','Luna Families','potential','2026-09-05',0,null],
  ['WellNest Clinic','ops@wellnest.example','+63 917 100 0004','WellNest','active','2025-11-22',96000,'2026-11-01'],
  ['Inactive Test Account','inactive@example.com',null,null,'inactive','2024-06-01',12000,'2025-02-14'],
];
for (const [name,email,phone,company,status,acq,total,last] of customers) {
  await sql`INSERT INTO customers (name,email,phone,company,status,acquisition_date,total_value,last_purchase_date)
    VALUES (${name},${email},${phone},${company},${status},${acq},${total},${last})
    ON CONFLICT (email) DO NOTHING`;
}
const cust = await sql`SELECT id,name FROM customers ORDER BY id`;
const by = Object.fromEntries(cust.map(c=>[c.name,c.id]));
const revenues = [
  [42000,'Postpartum package', 'service_revenue','2026-11-01','Maria Santos', by['Maria Santos'], '14-day care package'],
  [18500,'Consultation bundle','consulting','2026-10-28','Agos Postpartum Care - Makati', by['Agos Postpartum Care - Makati'],'On-site consults'],
  [9600,'Subscription renewal','subscription','2026-10-15','WellNest Clinic', by['WellNest Clinic'],'Monthly support plan'],
  [25000,'Training session','service_revenue','2026-09-30','WellNest Clinic', by['WellNest Clinic'],'Staff training'],
  [15000,'Product sales','product_sales','2026-08-20','Agos Postpartum Care - Makati', by['Agos Postpartum Care - Makati'],'Care kits'],
];
for (const [amount,source,category,date,cn,cid,desc] of revenues) {
  await sql`INSERT INTO revenues (amount,source,category,date,customer_name,customer_id,description) VALUES (${amount},${source},${category},${date},${cn},${cid||null},${desc})`;
}
const expenses = [
  [12000,'salaries','Care Staff Payroll','2026-11-02','November staffing',null],
  [3500,'office_supplies','MedSupply Co.','2026-10-25','Care supplies',null],
  [2800,'software','SaaS Tools','2026-10-10','Scheduling software',null],
  [8000,'rent','Office Lease','2026-10-01','Clinic space',null],
  [1500,'marketing','Ads Platform','2026-09-18','Local campaign',null],
];
for (const [amount,category,vendor,date,desc,receipt] of expenses) {
  await sql`INSERT INTO expenses (amount,category,vendor,date,description,receipt_url) VALUES (${amount},${category},${vendor},${date},${desc},${receipt})`;
}
const counts = (await sql`SELECT (SELECT count(*)::int FROM customers) c,(SELECT count(*)::int FROM revenues) r,(SELECT count(*)::int FROM expenses) e`)[0];
console.log('seeded', counts);
