import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { enforceProofToken } from '../../shared/proofTokenGuard.ts';
import { getOrderAuthority, applyOrderAuthorityEvent } from '../../shared/orderAuthority.ts';

export default async function(req: Request): Promise<Response> {
  let stage='start';
  try {
    stage='create-client';
    const base44=createClientFromRequest(req);
    let user:any=null;
    stage='auth-me';
    try{user=await base44.auth.me();}catch{}
    stage='read-body';
    const {orderId,proofId,proofHash,confirmed}=await req.json();
    if(!orderId||!proofId||!proofHash) return Response.json({error:'orderId, proofId, and proofHash are required'},{status:400});
    // G5 — explicit confirmation flag required. Without it, persist the rejection
    // receipt (binding proof_id + proof_hash + timestamp + reason) and return the
    // confirmation-required rejection. Authority state is NOT changed.
    if(!confirmed){
      await base44.asServiceRole.entities.QaGateReceipt.create({
        gate:'G5_APPROVAL_REJECTED_CONFIRMATION',proof_id:proofId,proof_hash:proofHash,order_id:orderId,
        reason:'Explicit confirmation flag missing',timestamp:new Date().toISOString(),
      });
      return Response.json({error:'Explicit confirmation is required to approve this proof',confirmation_required:true},{status:409});
    }
    stage='load-order-proof';
    const [order,proof]=await Promise.all([
      base44.asServiceRole.entities.StationeryOrder.get(orderId),
      base44.asServiceRole.entities.ThemeProof.get(proofId),
    ]);
    if(!order||!proof) return Response.json({error:'Order or proof not found'},{status:404});
    if(!user) return Response.json({error:'Unauthorized'},{status:401});
    if(user.role!=='admin'&&order.created_by_id!==user.id) return Response.json({error:'Order access denied'},{status:403});
    stage='proof-token';
    const tokenGuard=enforceProofToken(req,order,user);
    if(tokenGuard) return tokenGuard;
    if(order.proof_id!==proofId||order.proof_hash!==proofHash||proof.proof_hash!==proofHash||proof.order_number!==order.order_number||proof.theme_id!==order.theme_id){
      return Response.json({error:'Proof/order integrity mismatch'},{status:409});
    }
    if(proof.status!=='pending') return Response.json({error:`Proof is ${proof.status}`},{status:409});
    const snap:any=(proof as any).config_snapshot;
    if(!snap||!snap.composition_manifest||!snap.composition_manifest.entries?.length||!snap.theme_content_hash){
      return Response.json({error:'Approval requires a full-product proof (composition manifest + theme hash bound). Regenerate the proof.'},{status:409});
    }
    stage='get-authority';
    const authority=await getOrderAuthority(base44,orderId);
    if(!authority) return Response.json({error:'Canonical order authority not found'},{status:409});
    if(authority.lifecycle_state!=='PROOF_STORED'||authority.proof_id!==proofId||authority.proof_sha256!==proofHash) return Response.json({error:'Canonical proof authority mismatch'},{status:409});
    const orderIds=(order.items||[]).map((x:any)=>x.sp_id);
    const proofIds=(proof.mechanism_ids||[]).map((x:string)=>x);
    if(!orderIds.length||JSON.stringify(orderIds)!==JSON.stringify(proofIds)) return Response.json({error:'Proof/order mechanism manifest mismatch'},{status:409});
    stage='load-mechanisms';
    const [selected,allActive]=await Promise.all([
      base44.asServiceRole.entities.SpecialtyMechanism.filter({sp_id:{$in:orderIds},is_active:true}),
      base44.asServiceRole.entities.SpecialtyMechanism.filter({is_active:true}),
    ]);
    if(selected.length!==orderIds.length) return Response.json({error:'One or more mechanisms are unavailable'},{status:409});
    const byId=new Map(selected.map((m:any)=>[m.sp_id,m]));
    const ordered=orderIds.map((id:string)=>byId.get(id));
    const familyCounts:any={}; for(const m of allActive) familyCounts[m.family_key]=(familyCounts[m.family_key]||0)+1;
    const groups:any={}; for(const m of ordered) groups[m.family_key]=(groups[m.family_key]||0)+1;
    const familyKeys=Object.keys(groups), count=ordered.length;
    const catalogCount=allActive.length;
    const completeLibrary=count===catalogCount&&familyKeys.every((key:string)=>groups[key]===familyCounts[key]);
    const oneFullFamily=!completeLibrary&&familyKeys.length===1&&groups[familyKeys[0]]===familyCounts[familyKeys[0]]&&count>1;
    const allocate=(total:number)=>{const cents=Math.round(total*100), base=Math.floor(cents/count), remainder=cents-base*count;return ordered.map((m:any,index:number)=>({sp_id:m.sp_id,name:m.name,family_key:m.family_key,price:(base+(index<remainder?1:0))/100}));};
    const familyPackTotal=(key:string,n:number)=>({pockets:129,envelopes:89,flaps:119,popups:109,mechanical:119,windows:89,inserts:109} as Record<string,number>)[key]??(n>=30?129:n>=23?109:89);
    let authoritativeTier:string;
    if(completeLibrary){authoritativeTier='complete_library';} else if(oneFullFamily){authoritativeTier='family_pack';} else {authoritativeTier=count===1?'single':'custom_multi';}
    const lineItems:any[]=ordered.map((m:any)=>({sp_id:m.sp_id,name:m.name,family_key:m.family_key,price:12}));
    const subtotal=Math.round(lineItems.reduce((sum:number,x:any)=>sum+x.price,0)*100)/100;
    stage='load-render-audit';
    const audits=await base44.asServiceRole.entities.ProofRenderAudit.filter({proof_hash:proofHash,order_number:order.order_number,status:'pass',geometry_unchanged:true});
    if(audits.length!==1) return Response.json({error:'Verified render audit not found'},{status:409});
    const approvedAt=new Date().toISOString();
    const approvalSeed=`${orderId}|${proofId}|${proofHash}|${user.id}|${approvedAt}`;
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(approvalSeed));
    const approvalHash=Array.from(new Uint8Array(digest)).map((b)=>b.toString(16).padStart(2,'0')).join('');
    stage='load-prior-receipts';
    const priorReceipts=await base44.asServiceRole.entities.ProofApprovalReceipt.filter({order_id:orderId,status:'active'});
    for(const r of priorReceipts) await base44.asServiceRole.entities.ProofApprovalReceipt.update(r.id,{status:'superseded'});
    stage='create-receipt';
    await base44.asServiceRole.entities.ProofApprovalReceipt.create({order_id:orderId,order_number:order.order_number,proof_id:proofId,proof_hash:proofHash,approval_hash:approvalHash,approved_by_user_id:user.id,approved_at:approvedAt,geometry_unchanged:true,status:'active'});
    stage='apply-authority';
    await applyOrderAuthorityEvent(base44,{eventId:`approval:${orderId}:${proofId}:${approvalHash}`,orderId,eventType:'APPROVAL_CAPTURED',runtime:authority,occurredAt:approvedAt,payload:{proof_sha256:proofHash,approval_hash:approvalHash}});
    stage='update-proof';
    await base44.asServiceRole.entities.ThemeProof.update(proofId,{status:'approved'});
    stage='update-order';
    const updated=await base44.asServiceRole.entities.StationeryOrder.update(orderId,{status:'proof_approved',approved_at:approvedAt,items:lineItems,pricing_tier:authoritativeTier,subtotal,proof_fee:0,total_price:subtotal});
    return Response.json({order:updated,proof_id:proofId,proof_hash:proofHash,approval_hash:approvalHash,status:'proof_approved'});
  }catch(error:any){
    console.error('approveThemeProofV2 failed',error);
    return Response.json({error:error?.message||'Proof approval failed',stage},{status:500});
  }
}
