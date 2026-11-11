import { getDb, withTransaction } from './_lib/db.js';
import { requireAuth, json, handleApiError } from './_lib/auth.js';
import { actorName, createApproval, requiresHigherApproval, resolveStoredNames, writeAudit } from './_lib/workflow.js';
function parseId(v){const id=Number(v);return Number.isFinite(id)&&id>0?id:null;}
function toDate(v){if(!v)return null;const s=v instanceof Date?v.toISOString().slice(0,10):String(v).slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:null;}
function toNum(v,d=0){const n=Number(v);return Number.isFinite(n)?n:d;}
const CATS=new Set(['office_supplies','marketing','software','travel','utilities','rent','salaries','equipment','professional_services','other']);
export default async function handler(req,res){
  try{
    const actor=await requireAuth(req); const sql=getDb(); const {method}=req;
    if(method==='GET'){
      const id=parseId(req.query?.id);
      if(id){const rows=await sql`SELECT * FROM expenses WHERE id=${id} LIMIT 1`; if(!rows[0])return json(res,404,{error:'Expense not found'}); const [record]=await resolveStoredNames(sql,rows); return json(res,200,{data:record});}
      const sort=req.query?.sort==='asc'?'asc':'desc';
      const rows=sort==='asc'
        ? await sql`SELECT * FROM expenses ORDER BY date ASC, id ASC LIMIT 10000`
        : await sql`SELECT * FROM expenses ORDER BY date DESC, id DESC LIMIT 10000`;
      return json(res,200,{data:await resolveStoredNames(sql,rows)});
    }
    if(method==='POST'){
      const b=req.body||{}; const amount=toNum(b.amount,NaN); const date=toDate(b.date)||toDate(new Date().toISOString());
      if(!Number.isFinite(amount)||!date) return json(res,400,{error:'amount and valid date are required'});
      const cat=CATS.has(String(b.category))?String(b.category):'other';
      const rows=await withTransaction(async tx=>{
        const rows=await tx`INSERT INTO expenses (amount,category,vendor,date,description,receipt_url,created_by_clerk_id,created_by_name) VALUES (${amount},${cat},${b.vendor||null},${date},${b.description||null},${b.receipt_url||null},${actor.userId||null},${await actorName(tx, actor)}) RETURNING *`;
        await writeAudit(tx,{actor,action:'created',entityType:'expenses',entityId:rows[0].id,after:rows[0]});
        return rows;
      });
      return json(res,201,{data:rows[0]});
    }
    if(method==='PUT'||method==='PATCH'){
      const id=parseId(req.query?.id||req.body?.id); if(!id) return json(res,400,{error:'Valid id required'});
      const ex=await sql`SELECT * FROM expenses WHERE id=${id} LIMIT 1`; if(!ex[0]) return json(res,404,{error:'Expense not found'}); const cur=ex[0]; const b=req.body||{};
      const cat=b.category!==undefined?(CATS.has(String(b.category))?String(b.category):cur.category):cur.category;
      const requestedAmount=b.amount!==undefined?toNum(b.amount,NaN):Number(cur.amount);
      if(!Number.isFinite(requestedAmount)) return json(res,400,{error:'A valid amount is required'});
      const nonAmountChanged =
        (b.category!==undefined && cat!==cur.category) ||
        (b.vendor!==undefined && String(b.vendor||'')!==String(cur.vendor||'')) ||
        (b.date!==undefined && (toDate(b.date)||cur.date)!==toDate(cur.date)) ||
        (b.description!==undefined && String(b.description||'')!==String(cur.description||'')) ||
        (b.receipt_url!==undefined && String(b.receipt_url||'')!==String(cur.receipt_url||''));
      if(actor.role==='employee' && nonAmountChanged){
        return json(res,403,{error:'Employees may only request an amount change. Ask an administrator to change other transaction details.'});
      }
      if(requiresHigherApproval(actor,'financial') && requestedAmount!==Number(cur.amount)){
        const requestedData={amount:requestedAmount};
        const approval=await withTransaction(tx=>createApproval(tx,{
          actor,category:'financial',entityType:'expenses',entityId:id,
          operation:'update',requestedData,before:cur,
        }));
        return json(res,202,{data:{pendingApproval:true,approvalId:approval.id}});
      }
      const rows=await withTransaction(async tx=>{
        const rows=await tx`UPDATE expenses SET amount=${b.amount!==undefined?toNum(b.amount,cur.amount):cur.amount}, category=${cat}, vendor=${b.vendor!==undefined?(b.vendor||null):cur.vendor}, date=${b.date!==undefined?(toDate(b.date)||cur.date):cur.date}, description=${b.description!==undefined?(b.description||null):cur.description}, receipt_url=${b.receipt_url!==undefined?(b.receipt_url||null):cur.receipt_url}, updated_by_clerk_id=${actor.userId}, updated_by_name=${await actorName(tx, actor)} WHERE id=${id} RETURNING *`;
        if(rows[0]) await writeAudit(tx,{actor,action:'updated',entityType:'expenses',entityId:id,before:cur,after:rows[0]});
        return rows;
      });
      if(!rows[0])return json(res,404,{error:'Expense not found'});
      return json(res,200,{data:rows[0]});
    }
    if(method==='DELETE'){
      const id=parseId(req.query?.id); if(!id) return json(res,400,{error:'Valid id required'});
      const existing=await sql`SELECT * FROM expenses WHERE id=${id} LIMIT 1`; if(!existing[0])return json(res,404,{error:'Expense not found'});
      if(actor.role==='employee'){
        const approval=await withTransaction(tx=>createApproval(tx,{
          actor,category:'deletion',entityType:'expenses',entityId:id,
          operation:'delete',requestedData:{},before:existing[0],
        }));
        return json(res,202,{data:{pendingApproval:true,approvalId:approval.id}});
      }
      const rows=await withTransaction(async tx=>{
        const rows=await tx`DELETE FROM expenses WHERE id=${id} RETURNING id`;
        if(rows[0]) await writeAudit(tx,{actor,action:'deleted',entityType:'expenses',entityId:id,before:existing[0]});
        return rows;
      });
      if(!rows[0])return json(res,404,{error:'Expense not found'});
      return json(res,200,{data:{id}});
    }
    res.setHeader('Allow','GET,POST,PUT,PATCH,DELETE'); return json(res,405,{error:'Method not allowed'});
  }catch(error){return handleApiError(res,error);}
}
