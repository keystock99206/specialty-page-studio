import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { validateGeometryBinding, validateRegistryIntegrity } from './geometryRegistry.ts';
import { loadExactMaskRegistry } from './exactMaskRegistry.ts';
import { renderProductionPdf, sha256Bytes, PRODUCTION_COMPOSITOR_VERSION, PRODUCTION_PPI } from './productionSurfaceCompositor.ts';
import { getOrderAuthority, applyOrderAuthorityEvent } from '../../shared/orderAuthority.ts';
import { assertProductCommercialAuthority } from '../../shared/productCommercialAuthority.ts';

async function shaJson(v:any){return sha256Bytes(new TextEncoder().encode(JSON.stringify(v)));}

export default async function(req:Request):Promise<Response>{
  try{
    const base44=createClientFromRequest(req);
    let user:any=null;
    try{user=await base44.auth.me();}catch{}
    const {orderId}=await req.json();
    if(!orderId)return Response.json({error:'orderId is required'},{status:400});

    const order=await base44.asServiceRole.entities.StationeryOrder.get(orderId);
    if(!order)return Response.json({error:'Order not found'},{status:404});
    const orderOwnerId=order.created_by_id;
    const isTest=order.is_test_order===true;
    if(!user)return Response.json({error:'Unauthorized'},{status:401});
    if(user.role!=='admin'&&user.id!==orderOwnerId)return Response.json({error:'Order access denied'},{status:403});
    let authority=await getOrderAuthority(base44,orderId);
    if(!authority)return Response.json({error:'Canonical order authority not found'},{status:409});
    if(authority.lifecycle_state!=='PAID'&&authority.lifecycle_state!=='IN_PRODUCTION')return Response.json({error:`Entitled production unavailable from authority state ${authority.lifecycle_state}`},{status:409});
    if(!order.payment_entitlement_id||authority.payment_entitlement_id!==order.payment_entitlement_id)return Response.json({error:'Verified fulfillment entitlement authority mismatch'},{status:409});

    const ent=await base44.asServiceRole.entities.PaymentEntitlement.get(order.payment_entitlement_id);
    if(!ent||ent.order_id!==orderId||ent.user_id!==orderOwnerId||ent.payment_status!=='verified'||ent.production_authorized!==true||!ent.entitlement_hash){
      await base44.asServiceRole.entities.SecurityEvent.create({user_id:user.id,order_id:orderId,event_type:'delivery_denied',severity:'high',details:{reason:'entitlement_not_verified'},created_at:new Date().toISOString()});
      return Response.json({error:'Production entitlement is not verified'},{status:403});
    }
    if(ent.proof_hash!==order.proof_hash)return Response.json({error:'Paid entitlement/proof mismatch'},{status:409});

    const receipts=await base44.asServiceRole.entities.ProofApprovalReceipt.filter({order_id:orderId,proof_id:order.proof_id,proof_hash:order.proof_hash,status:'active',geometry_unchanged:true});
    if(receipts.length!==1||receipts[0].approval_hash!==ent.approval_hash)return Response.json({error:'Approved-proof receipt mismatch'},{status:409});

    // Product-master commercial authority is upstream of production/release.
    // Generic SP orders without product_master_id retain their existing authority path.
    await assertProductCommercialAuthority(base44,order,user.id);

    const opKey=`production:${orderId}:${ent.entitlement_hash}`;
    const priorOps=await base44.asServiceRole.entities.OperationReceipt.filter({operation_key:opKey,status:'pass'});
    if(priorOps.length&&order.production_artifact_id){
      const artifact=await base44.asServiceRole.entities.ProductionArtifact.get(order.production_artifact_id);
      return Response.json({status:'already_rendered',artifact_id:artifact?.id||order.production_artifact_id,page_count:artifact?.page_count||null,file_sha256:artifact?.file_sha256||null});
    }
    await base44.asServiceRole.entities.OperationReceipt.create({operation_key:opKey,order_id:orderId,order_number:order.order_number,operation_type:'production_render',input_hash:ent.entitlement_hash,status:'started'});
    if(authority.lifecycle_state==='PAID'){
      authority=await applyOrderAuthorityEvent(base44,{eventId:`production-start:${orderId}:${ent.entitlement_hash}`,orderId,eventType:'PRODUCTION_STARTED',runtime:authority,payload:{}});
    }
    await base44.asServiceRole.entities.StationeryOrder.update(orderId,{status:'in_production'});

    validateRegistryIntegrity();
    const exactMasks=await loadExactMaskRegistry();
    if(exactMasks.size!==145)throw new Error('Exact-mask registry incomplete');
    const mechanismIds=(order.items||[]).map((x:any)=>x.sp_id);
    if(!mechanismIds.length)throw new Error('Order mechanism manifest is empty');
    const rawMechanisms=await base44.asServiceRole.entities.SpecialtyMechanism.filter({sp_id:{$in:mechanismIds},is_active:true});
    const byId=new Map(rawMechanisms.map((m:any)=>[m.sp_id,m]));
    const mechanisms=mechanismIds.map((id:string)=>byId.get(id));
    if(mechanisms.some((m:any)=>!m))throw new Error('One or more paid mechanisms are unavailable');
    const specs=await base44.asServiceRole.entities.ThemeSpec.filter({sp_id:{$in:mechanismIds}});
    const specById=new Map(specs.map((s:any)=>[s.sp_id,s]));
    const locks=mechanismIds.map((spId:string)=>{
      const geometry=validateGeometryBinding(spId,specById.get(spId));
      const mask=exactMasks.get(spId);
      if(!mask||mask.parts.length!==geometry.part_refs.length)throw new Error(`Exact production silhouette mismatch ${spId}`);
      return geometry;
    });
    const theme=await base44.asServiceRole.entities.CustomerTheme.get(order.theme_id);
    if(!theme)throw new Error('Customer theme missing');
    if(theme.ppi_status==='reject')return Response.json({error:'Artwork resolution is below production minimum'},{status:422});

    const rendered=await renderProductionPdf(base44,{mechanisms,theme});
    if(!rendered.geometryUnchanged||rendered.renderPpi!==300)throw new Error('Production render gate failed');
    const file=new File([rendered.pdfBytes],`specialty-pages-${order.order_number}-300ppi.pdf`,{type:'application/pdf'});
    const uploaded=await base44.asServiceRole.integrations.Core.UploadPrivateFile({file});
    const artifact=await base44.asServiceRole.entities.ProductionArtifact.create({
      order_id:orderId,order_number:order.order_number,user_id:orderOwnerId,is_test:isTest,entitlement_hash:ent.entitlement_hash,proof_hash:order.proof_hash,
      mechanism_ids:mechanismIds,engineering_hashes:locks.map((x:any)=>x.engineering_lock_sha256),geometry_bundle_hashes:locks.map((x:any)=>x.geometry_bundle_sha256),
      compositor_version:PRODUCTION_COMPOSITOR_VERSION,render_ppi:PRODUCTION_PPI,file_uri:uploaded.file_uri,file_sha256:rendered.productionSha256,
      page_count:rendered.pageCount,status:'verified',geometry_unchanged:true,qa_passed:true,created_from_entitlement:true,
    });
    const manifestHash=await shaJson({order_id:orderId,artifact_id:artifact.id,file_sha256:rendered.productionSha256,page_count:rendered.pageCount,manifest:rendered.manifest});
    const release=await base44.asServiceRole.entities.ReleaseSnapshot.create({
      order_id:orderId,order_number:order.order_number,user_id:orderOwnerId,is_test:isTest,proof_hash:order.proof_hash,approval_hash:ent.approval_hash,entitlement_hash:ent.entitlement_hash,
      production_artifact_id:artifact.id,production_sha256:rendered.productionSha256,delivery_manifest_sha256:manifestHash,
      engineering_hashes:locks.map((x:any)=>x.engineering_lock_sha256),geometry_bundle_hashes:locks.map((x:any)=>x.geometry_bundle_sha256),released_at:new Date().toISOString(),status:'active'
    });
    const delivery=await base44.asServiceRole.entities.DeliveryAsset.create({
      order_id:orderId,order_number:order.order_number,user_id:orderOwnerId,is_test:isTest,production_artifact_id:artifact.id,file_uri:uploaded.file_uri,file_sha256:rendered.productionSha256,
      delivery_manifest_sha256:manifestHash,status:'ready',download_count:0
    });
    await base44.asServiceRole.entities.DriveArchiveOutbox.create({
      order_id:orderId,order_number:order.order_number,is_test:isTest,release_snapshot_id:release.id,production_artifact_id:artifact.id,source_file_uri:uploaded.file_uri,
      source_sha256:rendered.productionSha256,target_path:`Specialty Page Studio/Orders/${order.order_number}/specialty-pages-${order.order_number}-300ppi.pdf`,status:'blocked_connector',attempts:0,last_error:'Google Drive connector not authorized; customer delivery is unaffected.'
    });
    authority=await applyOrderAuthorityEvent(base44,{
      eventId:`release-bound:${orderId}:${artifact.id}`,
      orderId,
      eventType:'RELEASE_PACKAGE_BOUND',
      runtime:authority,
      payload:{production_artifact_id:artifact.id,production_sha256:rendered.productionSha256,release_snapshot_id:release.id},
    });
    authority=await applyOrderAuthorityEvent(base44,{
      eventId:`delivery-released:${orderId}:${delivery.id}`,
      orderId,
      eventType:'DELIVERY_RELEASED',
      runtime:authority,
      payload:{delivery_asset_id:delivery.id},
    });
    const deliveredOrder=await base44.asServiceRole.entities.StationeryOrder.update(orderId,{production_artifact_id:artifact.id,delivery_asset_id:delivery.id,status:'delivered',delivered_at:new Date().toISOString()});
    const outputHash=await shaJson({artifact_id:artifact.id,release_id:release.id,delivery_id:delivery.id,file_sha256:rendered.productionSha256});
    const started=await base44.asServiceRole.entities.OperationReceipt.filter({operation_key:opKey,status:'started'});
    if(started[0])await base44.asServiceRole.entities.OperationReceipt.update(started[0].id,{status:'pass',output_hash:outputHash,completed_at:new Date().toISOString()});
    return Response.json({status:'delivered',artifact_id:artifact.id,delivery_asset_id:delivery.id,page_count:rendered.pageCount,file_sha256:rendered.productionSha256,render_ppi:300,drive_archive:'blocked_connector',order:deliveredOrder});
  }catch(error:any){
    console.error('renderPaidProduction failed',error);
    return Response.json({error:error?.message||'Entitled production failed'},{status:error?.status||500});
  }
}
