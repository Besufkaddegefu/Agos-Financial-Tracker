import { getDb, withTransaction } from './_lib/db.js';
import { requireAuth, json, handleApiError } from './_lib/auth.js';
import { actorName, createApproval, requiresHigherApproval, resolveStoredNames, writeAudit } from './_lib/workflow.js';
function parseId(v){const id=Number(v);return Number.isFinite(id)&&id>0?id:null;}
function toDate(v){if(!v)return null;const s=v instanceof Date?v.toISOString().slice(0,10):String(v).slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:null;}
function toNum(v,d=0){const n=Number(v);return Number.isFinite(n)?n:d;}
const CATS=new Set(['product_sales','service_revenue','subscription','consulting','licensing','other']);
export default async function handler(req,res){
  try{
    const actor=await requireAuth(req); const sql=getDb(); const {method}=req;
    if(method==='GET'){
      const id=parseId(req.query?.id);
      if(id){const rows=await sql`SELECT * FROM revenues WHERE id=${id} LIMIT 1`; if(!rows[0])return json(res,404,{error:'Revenue not found'}); const [record]=await resolveStoredNames(sql,rows); return json(res,200,{data:record});}
      const sort=req.query?.sort==='asc'?'asc':'desc';
      const rows=sort==='asc'
        ? await sql`SELECT * FROM revenues ORDER BY date ASC, id ASC LIMIT 10000`
        : await sql`SELECT * FROM revenues ORDER BY date DESC, id DESC LIMIT 10000`;
      return json(res,200,{data:await resolveStoredNames(sql,rows)});
    }
    if(method==='POST'){
      const b=req.body||{}; const amount=toNum(b.amount,NaN); const date=toDate(b.date)||toDate(new Date().toISOString());
      if(!Number.isFinite(amount)||!date) return json(res,400,{error:'amount and valid date are required'});
      const cat=CATS.has(String(b.category))?String(b.category):'product_sales';
      const rows=await withTransaction(async tx=>{
        const rows=await tx`INSERT INTO revenues (amount,source,category,date,customer_name,customer_id,description,created_by_clerk_id,created_by_name) VALUES (${amount},${b.source||null},${cat},${date},${b.customer_name||null},${parseId(b.customer_id)},${b.description||null},${actor.userId||null},${await actorName(tx, actor)}) RETURNING *`;
        await writeAudit(tx,{actor,action:'created',entityType:'revenues',entityId:rows[0].id,after:rows[0]});
        return rows;
      });
      return json(res,201,{data:rows[0]});
    }
    if(method==='PUT'||method==='PATCH'){
      const id=parseId(req.query?.id||req.body?.id); if(!id) return json(res,400,{error:'Valid id required'});
      const ex=await sql`SELECT * FROM revenues WHERE id=${id} LIMIT 1`; if(!ex[0]) return json(res,404,{error:'Revenue not found'}); const cur=ex[0]; const b=req.body||{};
      const cat=b.category!==undefined?(CATS.has(String(b.category))?String(b.category):cur.category):cur.category;
      const requestedAmount=b.amount!==undefined?toNum(b.amount,NaN):Number(cur.amount);
      if(!Number.isFinite(requestedAmount)) return json(res,400,{error:'A valid amount is required'});
      const nonAmountChanged =
        (b.source!==undefined && String(b.source||'')!==String(cur.source||'')) ||
        (b.category!==undefined && cat!==cur.category) ||
        (b.date!==undefined && (toDate(b.date)||cur.date)!==toDate(cur.date)) ||
        (b.customer_name!==undefined && String(b.customer_name||'')!==String(cur.customer_name||'')) ||
        (b.customer_id!==undefined && (parseId(b.customer_id)||0)!==Number(cur.customer_id||0)) ||
        (b.description!==undefined && String(b.description||'')!==String(cur.description||''));
      if(actor.role==='employee' && nonAmountChanged){
        return json(res,403,{error:'Employees may only request an amount change. Ask an administrator to change other transaction details.'});
      }
      if(requiresHigherApproval(actor,'financial') && requestedAmount!==Number(cur.amount)){
        const requestedData={amount:requestedAmount};
        const approval=await withTransaction(tx=>createApproval(tx,{
          actor,category:'financial',entityType:'revenues',entityId:id,
          operation:'update',requestedData,before:cur,
        }));
        return json(res,202,{data:{pendingApproval:true,approvalId:approval.id}});
      }
      const rows=await withTransaction(async tx=>{
        const rows=await tx`UPDATE revenues SET amount=${b.amount!==undefined?toNum(b.amount,cur.amount):cur.amount}, source=${b.source!==undefined?(b.source||null):cur.source}, category=${cat}, date=${b.date!==undefined?(toDate(b.date)||cur.date):cur.date}, customer_name=${b.customer_name!==undefined?(b.customer_name||null):cur.customer_name}, customer_id=${b.customer_id!==undefined?parseId(b.customer_id):cur.customer_id}, description=${b.description!==undefined?(b.description||null):cur.description}, updated_by_clerk_id=${actor.userId}, updated_by_name=${await actorName(tx, actor)} WHERE id=${id} RETURNING *`;
        if(rows[0]) await writeAudit(tx,{actor,action:'updated',entityType:'revenues',entityId:id,before:cur,after:rows[0]});
        return rows;
      });
      if(!rows[0])return json(res,404,{error:'Revenue not found'});
      return json(res,200,{data:rows[0]});
    }
    if(method==='DELETE'){
      const id=parseId(req.query?.id); if(!id) return json(res,400,{error:'Valid id required'});
      const existing=await sql`SELECT * FROM revenues WHERE id=${id} LIMIT 1`; if(!existing[0])return json(res,404,{error:'Revenue not found'});
      if(actor.role==='employee'){
        const approval=await withTransaction(tx=>createApproval(tx,{
          actor,category:'deletion',entityType:'revenues',entityId:id,
          operation:'delete',requestedData:{},before:existing[0],
        }));
        return json(res,202,{data:{pendingApproval:true,approvalId:approval.id}});
      }
      const rows=await withTransaction(async tx=>{
        const rows=await tx`DELETE FROM revenues WHERE id=${id} RETURNING id`;
        if(rows[0]) await writeAudit(tx,{actor,action:'deleted',entityType:'revenues',entityId:id,before:existing[0]});
        return rows;
      });
      if(!rows[0])return json(res,404,{error:'Revenue not found'});
      return json(res,200,{data:{id}});
    }
    res.setHeader('Allow','GET,POST,PUT,PATCH,DELETE'); return json(res,405,{error:'Method not allowed'});
  }catch(error){return handleApiError(res,error);}
}
