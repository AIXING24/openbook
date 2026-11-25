import {validDate} from './validation.mjs';
function csvRows(text){
  if(typeof text!=='string'||new TextEncoder().encode(text).length>24000)throw Error('ECB response exceeds bounded daily parser');
  const rows=[];let row=[],field='',quoted=false;
  const finishField=()=>{row.push(field);field='';if(row.length>40)throw Error('ECB field limit exceeded');};
  const finishRow=()=>{finishField();if(row.some(value=>value!==''))rows.push(row);row=[];if(rows.length>25)throw Error('ECB daily row limit exceeded');};
  text=text.replace(/^\uFEFF/,'');
  for(let index=0;index<text.length;index++){
    const character=text[index];
    if(character==='"'){
      if(quoted&&text[index+1]==='"'){field+='"';index++;}
      else if(quoted)quoted=false;
      else if(field==='')quoted=true;
      else throw Error('Invalid ECB quoting');
    }else if(character===','&&!quoted)finishField();
    else if((character==='\n'||character==='\r')&&!quoted){finishRow();if(character==='\r'&&text[index+1]==='\n')index++;}
    else field+=character;
    if(field.length>1000)throw Error('ECB field too long');
  }
  if(quoted)throw Error('Truncated ECB quoted field');
  if(field||row.length)finishRow();
  return rows;
}
export function ecbReferenceRates(text,{date,observedAt}){
  if(!validDate(date)||!Number.isFinite(observedAt)||observedAt<Date.parse(date+'T00:00:00Z'))throw Error('Invalid ECB reference context');
  const [header,...rows]=csvRows(text),required=['KEY','FREQ','CURRENCY','CURRENCY_DENOM','EXR_TYPE','EXR_SUFFIX','TIME_PERIOD','OBS_VALUE','OBS_STATUS'];
  if(!header||new Set(header).size!==header.length||required.some(name=>!header.includes(name)))throw Error('Unsupported ECB CSV header');
  const values=new Map();
  for(const fields of rows){
    if(fields.length!==header.length)throw Error('Incomplete ECB observation');
    const row=Object.fromEntries(header.map((name,index)=>[name,fields[index]])),currency=row.CURRENCY,number=Number(row.OBS_VALUE);
    if(!['CNY','USD','HKD'].includes(currency)||row.KEY!=='EXR.D.'+currency+'.EUR.SP00.A'||row.FREQ!=='D'||row.CURRENCY_DENOM!=='EUR'||row.EXR_TYPE!=='SP00'||row.EXR_SUFFIX!=='A'||row.TIME_PERIOD!==date||row.OBS_STATUS!=='A'||!row.OBS_VALUE.trim()||!Number.isFinite(number)||number<=0||values.has(currency))throw Error('Unverified ECB observation');
    values.set(currency,number);
  }
  if(values.size!==3)throw Error('Incomplete ECB currency set');
  const rates={CNY:1,USD:values.get('CNY')/values.get('USD'),HKD:values.get('CNY')/values.get('HKD')};
  if(!Object.values(rates).every(value=>Number.isFinite(value)&&value>0))throw Error('ECB cross rate out of range');
  return {provider:'ecb-reference',basis:'ECB_REFERENCE',asOfDate:date,rates,approximate:false,method:'EUR-cross-rate',observedAt,sourceUrl:'https://data-api.ecb.europa.eu/service/data/EXR/D.USD+CNY+HKD.EUR.SP00.A',isExecutionRate:false};
}
