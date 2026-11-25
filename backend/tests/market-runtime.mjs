import {marketCloseAt,assessValuationEvidence} from '../market-evidence.mjs';
import {ecbReferenceRates} from '../ecb-fx.mjs';
export default {async fetch(request){
  const input=await request.json();
  if(input.kind==='close')return Response.json({at:new Date(marketCloseAt(input.date,input.market,input.time)).toISOString()});
  if(input.kind==='fx')return Response.json(ecbReferenceRates(input.csv,input.context));
  if(input.kind==='assess')return Response.json(assessValuationEvidence(input.evidence));
  return Response.json({error:'Unknown local test action'},{status:400});
}};
