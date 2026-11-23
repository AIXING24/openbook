export const read=(db,sql,...v)=>db.prepare(sql).bind(...v).first();
export const all=async(db,sql,...v)=>(await db.prepare(sql).bind(...v).all()).results;
export const run=(db,sql,...v)=>db.prepare(sql).bind(...v).run();
export const statement=(db,sql,...v)=>db.prepare(sql).bind(...v);
