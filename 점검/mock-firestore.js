const store = {}; const listeners = []; let autoId = 0;
const colMap = n => (store[n] ||= new Map());
const clone = o => JSON.parse(JSON.stringify(o));
export function initializeApp(c){ return {c}; }
export function initializeFirestore(){ return {mock:true}; }
export function getFirestore(){ return {mock:true}; }
export function persistentLocalCache(){ return {}; }
export function persistentSingleTabManager(){ return {}; }
export function collection(db,name){ return {kind:'col', name}; }
export function doc(a,b,c){ if(a.kind==='col') return {kind:'doc', col:a.name, id:'auto'+(++autoId)+Math.random().toString(36).slice(2,6)}; return {kind:'doc', col:b, id:c}; }
export function orderBy(f,d='asc'){ return {t:'order',f,d}; }
export function limit(n){ return {t:'limit',n}; }
export function where(f,op,v){ return {t:'where',f,op,v}; }
export function query(col,...cs){ return {kind:'q', name:col.name, cs}; }
export const deleteField = ()=>({__del:true});
function run(q){
  let arr=[...colMap(q.name).entries()].map(([id,d])=>({id,d}));
  for(const c of q.cs){
    if(c.t==='where') arr=arr.filter(x=>{const v=x.d[c.f]; return c.op==='<'?v<c.v:c.op==='>='?v>=c.v:c.op==='>'?v>c.v:c.op==='<='?v<=c.v:v===c.v;});
  }
  for(const c of q.cs) if(c.t==='order') arr.sort((a,b)=>{const x=a.d[c.f],y=b.d[c.f]; const r=x<y?-1:x>y?1:0; return c.d==='desc'?-r:r;});
  for(const c of q.cs) if(c.t==='limit') arr=arr.slice(0,c.n);
  return arr;
}
const snapOf = arr => ({ docs: arr.map(x=>({id:x.id, data:()=>clone(x.d), ref:{kind:'doc',col:null,id:x.id}})), docChanges:()=>[1], empty:!arr.length, metadata:{fromCache:false} });
function snapQ(q){ const arr=run(q); const s=snapOf(arr); s.docs.forEach(d=>d.ref.col=q.name); return s; }
export async function getDocs(q){ window.__mockfs.reads++; return snapQ(q); }
export function onSnapshot(ref,...rest){
  const cb = rest.find(x=>typeof x==='function'); 
  const fire = ()=>{
    if(ref.kind==='doc'){ const d=colMap(ref.col).get(ref.id); cb({ exists:()=>!!d, data:()=>d?clone(d):undefined, metadata:{fromCache:false} }); }
    else cb(snapQ(ref.kind==='col'?{name:ref.name,cs:[]}:ref));
  };
  const L={name:ref.kind==='doc'?ref.col:ref.name, fire}; listeners.push(L); setTimeout(fire,0);
  return ()=>{ const i=listeners.indexOf(L); if(i>=0) listeners.splice(i,1); };
}
function notify(name){ setTimeout(()=>listeners.filter(l=>l.name===name).forEach(l=>l.fire()),0); }
function applyPatch(old, patch){
  const o = clone(old||{});
  for(const [k,v] of Object.entries(patch)){
    const path=k.split('.'); let cur=o;
    for(let i=0;i<path.length-1;i++){ cur=(cur[path[i]] ||= {}); }
    const last=path[path.length-1];
    if(v&&v.__del) delete cur[last]; else cur[last]=clone(v);
  }
  return o;
}
function failCheck(ref){ if(window.__mockfs.failWrite && window.__mockfs.failWrite.includes(ref.col)){ const e=new Error('denied'); e.code='permission-denied'; throw e; } }
export async function setDoc(ref,data,opts){ failCheck(ref); window.__mockfs.writes++; const m=colMap(ref.col); m.set(ref.id, opts&&opts.merge?applyPatch(m.get(ref.id),data):clone(data)); notify(ref.col); }
export async function addDoc(col,data){ const r=doc(col); await setDoc(r,data); return r; }
export async function deleteDoc(ref){ failCheck(ref); window.__mockfs.writes++; colMap(ref.col).delete(ref.id); notify(ref.col); }
export async function updateDoc(ref,patch){ failCheck(ref); window.__mockfs.writes++; const m=colMap(ref.col); m.set(ref.id, applyPatch(m.get(ref.id),patch)); notify(ref.col); }
export function writeBatch(){
  const ops=[]; return {
    set:(r,d)=>ops.push(['s',r,d]), update:(r,d)=>ops.push(['u',r,d]), delete:r=>ops.push(['d',r]),
    commit: async()=>{ for(const [t,r,d] of ops){ if(t==='s') await setDoc(r,d); else if(t==='u') await updateDoc(r,d); else await deleteDoc(r);} }
  };
}
window.__mockfs = { store, reads:0, writes:0, failWrite:null,
  seed(col,id,data){ colMap(col).set(id,clone(data)); notify(col); },
  list(col){ return [...colMap(col).entries()].map(([id,d])=>({id,...clone(d)})); },
  count(col){ return colMap(col).size; } };
