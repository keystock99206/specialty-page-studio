import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { assertProductCommercialAuthority } from '../../shared/productCommercialAuthority.ts';

const TTL_SECONDS=3600;
const MAX_DOWNLOADS=10;

export default async function(req:Request):Promise<Response>{
  try{
    const base44=createClientFromRequest(req);
    let user:any=null;
    try{user=await base44.auth.me();}catch{}
    if(!user)return Response.json({error:'Unauthorized'},{status:401});
    const {orderId}=await req.json();
    if(!orderId)return Response.json({error:'orderId is required'},{status:400});
    const order=await base44.asServiceRole.entities.StationeryOrder.get(orderId);
    if(!order||order.status!=='delivered'||!order.delivery_asset_id)return Response.json({error:'Delivery is not ready'},{status:409});
    if(user.role!=='admin'&&user.id!==order.created_by_id)return Response.json({error:'Order access denied'},{status:403});
    await assertProductCommercialAuthority(base44,order,user.id);
    // Payment gate: the high-resolution file is only released against a verified,
    // production-authorized entitlement bound to this exact approved proof.
    if(!order.payment_entitlement_id){
      await base44.asServiceRole.entities.SecurityEvent.create({user_id:user.id,order_id:orderId,event_type:'payment_mismatch',severity:'high',details:{reason:'missing_entitlement'},created_at:new Date().toISOString()});
      return Response.json({error:'Payment has not been verified'},{status:403});
    }
    const entitlement=await base44.asServiceRole.entities.PaymentEntitlement.get(order.payment_entitlement_id);
    if(!entitlement||entitlement.order_id!==orderId||entitlement.user_id!==order.created_by_id||entitlement.payment_status!=='verified'||entitlement.production_authorized!==true||entitlement.proof_hash!==order.proof_hash){
      await base44.asServiceRole.entities.SecurityEvent.create({user_id:user.id,order_id:orderId,event_type:'payment_mismatch',severity:'high',details:{reason:'entitlement_invalid',status:entitlement?.payment_status},created_at:new Date().toISOString()});
      return Response.json({error:'Payment has not been verified'},{status:403});
    }
    const asset=await base44.asServiceRole.entities.DeliveryAsset.get(order.delivery_asset_id);
    if(!asset||asset.order_id!==orderId||asset.user_id!==order.created_by_id||!['ready','delivered'].includes(asset.status))return Response.json({error:'Delivery entitlement mismatch'},{status:403});
    if((asset.download_count||0)>=MAX_DOWNLOADS)return Response.json({error:'Download refresh limit reached; contact support for a new entitlement link.'},{status:429});
    const artifact=await base44.asServiceRole.entities.ProductionArtifact.get(asset.production_artifact_id);
    if(!artifact||artifact.status!=='verified'||artifact.qa_passed!==true||artifact.geometry_unchanged!==true||artifact.file_sha256!==asset.file_sha256){
      await base44.asServiceRole.entities.SecurityEvent.create({user_id:user.id,order_id:orderId,event_type:'delivery_denied',severity:'high',details:{reason:'artifact_integrity_gate'},created_at:new Date().toISOString()});
      return Response.json({error:'Delivery integrity verification failed'},{status:409});
    }
    const signed=await base44.asServiceRole.integrations.Core.CreateFileSignedUrl({file_uri:asset.file_uri,expires_in:TTL_SECONDS});
    const expiresAt=new Date(Date.now()+TTL_SECONDS*1000).toISOString();
    await base44.asServiceRole.entities.DeliveryAsset.update(asset.id,{status:'delivered',download_count:(asset.download_count||0)+1,signed_url_expires_at:expiresAt});
    return Response.json({download_url:signed.signed_url,expires_at:expiresAt,file_sha256:asset.file_sha256,page_count:artifact.page_count,render_ppi:artifact.render_ppi});
  }catch(error:any){
    console.error('getPaidDelivery failed',error);
    return Response.json({error:error?.message||'Delivery failed'},{status:error?.status||500});
  }
}
