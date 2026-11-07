/* Praetorians mission scripts (Varios/Scripts/*.trg): a small C-like
   language of global variables and triggers.

     Var { handle hTimer; bool bDone = FALSE; float x, y; }
     #include "FunScript.h"
     Trigger "Name" [Activo] ( condition ) Var { locals } Do { statements }

   Statements are declarations, assignments, calls, if/else and blocks; `&x`
   passes a variable to functions that write it (DarPosicionCamara(&x,&y)).
   Each tick every active trigger that is not already running has its
   condition evaluated; when true, its body runs as a coroutine that may block
   on Wait(handle) or WaitBool(expression). In a condition, Wait(h) only
   tests h. Handles, timers and trigger control live here; every other
   function is supplied by the game (`library`, by its original name). */
(function(root,factory){
 const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.PraetoriansScript=api;
})(typeof window!=='undefined'?window:typeof globalThis!=='undefined'?globalThis:null,function(){
 'use strict';
 // ---- Lexer -------------------------------------------------------------------
 const TYPES=new Set(['handle','bool','float','int','string']);
 function tokenize(source){
  const tokens=[],n=source.length;let i=0,line=1;
  const push=(type,value)=>tokens.push({type,value,line});
  while(i<n){
   const c=source[i];
   if(c==='\n'){line++;i++;continue;}
   if(c===' '||c==='\t'||c==='\r'||c==='\f'||c==='\v'||c==='\u00a0'){i++;continue;}
   if(c==='/'&&source[i+1]==='/'){while(i<n&&source[i]!=='\n')i++;continue;}
   if(c==='/'&&source[i+1]==='*'){i+=2;while(i<n&&!(source[i]==='*'&&source[i+1]==='/')){if(source[i]==='\n')line++;i++;}i+=2;continue;}
   if(c==='#'){while(i<n&&source[i]!=='\n')i++;continue;}            // #include "FunScript.h"
   if(c==='"'){
    let s='';i++;
    while(i<n&&source[i]!=='"'){if(source[i]==='\\'&&i+1<n&&source[i+1]==='"'){s+='"';i+=2;continue;}if(source[i]==='\n')line++;s+=source[i++];}
    i++;push('string',s);continue;
   }
   if(/[0-9]/.test(c)||(c==='.'&&/[0-9]/.test(source[i+1]))){
    let j=i;
    if(c==='0'&&/[xX]/.test(source[i+1])){j+=2;while(j<n&&/[0-9a-fA-F]/.test(source[j]))j++;push('number',parseInt(source.slice(i,j),16));i=j;continue;}
    while(j<n&&/[0-9.]/.test(source[j]))j++;
    if(/[eE]/.test(source[j])&&/[-+0-9]/.test(source[j+1])){j++;if(/[-+]/.test(source[j]))j++;while(j<n&&/[0-9]/.test(source[j]))j++;}
    push('number',parseFloat(source.slice(i,j)));
    if(/[fF]/.test(source[j]))j++;
    i=j;continue;
   }
   if(/[A-Za-z_\u00c0-\u00ff]/.test(c)){
    let j=i;while(j<n&&/[A-Za-z0-9_\u00c0-\u00ff]/.test(source[j]))j++;
    push('ident',source.slice(i,j));i=j;continue;
   }
   const two=source.slice(i,i+2);
   if(['==','!=','<=','>=','&&','||'].includes(two)){push('op',two);i+=2;continue;}
   if('(){}[];,=<>!+-*/&'.includes(c)){push('op',c);i++;continue;}
   i++;                                                              // stray byte
  }
  push('eof',null);
  return tokens;
 }
 // ---- Parser --------------------------------------------------------------------
 function parse(source,name='script'){
  const tokens=tokenize(source);let p=0;
  const peek=(k=0)=>tokens[p+k];
  const fail=message=>{throw new Error(`${name}:${peek().line}: ${message} (near ${JSON.stringify(peek().value)})`);};
  const is=(type,value)=>peek().type===type&&(value===undefined||peek().value===value);
  const isWord=value=>peek().type==='ident'&&peek().value.toLowerCase()===value.toLowerCase();
  const take=(type,value)=>{if(!is(type,value))fail(`expected ${value??type}`);return tokens[p++];};
  const accept=(type,value)=>is(type,value)?tokens[p++]:null;
  function declarations(){
   // { type name [= expr] {, name [= expr]} ; }
   const list=[];take('op','{');
   while(!accept('op','}')){
    if(peek().type==='eof')fail('unterminated Var block');
    if(accept('op',';'))continue;
    const type=take('ident').value.toLowerCase();
    do{
     const id=take('ident').value;let init=null;
     if(accept('op','='))init=expression();
     list.push({type,name:id,init});
    }while(accept('op',','));
    take('op',';');
   }
   return list;
  }
  function block(){
   const body=[];take('op','{');
   while(!accept('op','}')){if(peek().type==='eof')fail('unterminated block');body.push(statement());}
   return {kind:'block',body};
  }
  function statement(){
   if(is('op','{'))return block();
   if(accept('op',';'))return {kind:'empty'};
   if(isWord('if')){
    p++;take('op','(');const test=expression();take('op',')');
    const then=statement();let otherwise=null;
    if(isWord('else')){p++;otherwise=statement();}
    return {kind:'if',test,then,otherwise};
   }
   if(peek().type==='ident'&&TYPES.has(peek().value.toLowerCase())&&peek(1).type==='ident'){
    const type=take('ident').value.toLowerCase(),list=[];
    do{const id=take('ident').value;let init=null;if(accept('op','='))init=expression();list.push({type,name:id,init});}while(accept('op',','));
    take('op',';');
    return {kind:'declare',list};
   }
   const expr=expression();
   accept('op',';');                                  // a few lines forget it
   return {kind:'expr',expr};
  }
  // Precedence, low to high: = || && (== !=) (< > <= >=) (+ -) (* /) unary.
  function expression(){
   const left=or();
   if(is('op','=')&&left.kind==='name'){p++;return {kind:'assign',name:left.name,value:expression()};}
   return left;
  }
  const binary=(next,ops)=>()=>{let left=next();while(peek().type==='op'&&ops.includes(peek().value)){const op=tokens[p++].value;left={kind:'binary',op,left,right:next()};}return left;};
  const unary=()=>{
   if(accept('op','!'))return {kind:'not',value:unary()};
   if(accept('op','-'))return {kind:'neg',value:unary()};
   if(accept('op','+'))return unary();
   if(accept('op','&'))return {kind:'ref',name:take('ident').value};
   return primary();
  };
  const multiplicative=binary(unary,['*','/']);
  const additive=binary(multiplicative,['+','-']);
  const relational=binary(additive,['<','>','<=','>=']);
  const equality=binary(relational,['==','!=']);
  const and=binary(equality,['&&']);
  const or=binary(and,['||']);
  function primary(){
   const t=peek();
   if(t.type==='number'){p++;return {kind:'literal',value:t.value};}
   if(t.type==='string'){p++;return {kind:'literal',value:t.value};}
   if(accept('op','(')){const e=expression();take('op',')');return e;}
   if(t.type==='ident'){
    p++;const word=t.value,upper=word.toUpperCase();
    if(upper==='TRUE')return {kind:'literal',value:true};
    if(upper==='FALSE')return {kind:'literal',value:false};
    if(upper==='NULL')return {kind:'literal',value:null};
    if(accept('op','(')){
     const args=[];
     if(!accept('op',')')){do{args.push(expression());}while(accept('op',','));take('op',')');}
     return {kind:'call',name:word,args,line:t.line};
    }
    return {kind:'name',name:word};
   }
   fail('unexpected token');
  }
  const program={globals:[],triggers:[]};
  while(!is('eof')){
   if(isWord('Var')){p++;program.globals.push(...declarations());continue;}
   if(isWord('Trigger')){
    p++;const title=take('string').value;let active=true;
    if(accept('op','[')){active=take('ident').value.toLowerCase()==='activo';take('op',']');}
    take('op','(');const condition=is('op',')')?{kind:'literal',value:true}:expression();take('op',')');
    let locals=[];
    if(isWord('Var')){p++;locals=declarations();}
    if(!isWord('Do'))fail('expected Do');p++;
    program.triggers.push({name:title,active,condition,locals,body:block()});
    continue;
   }
   if(accept('op',';'))continue;
   fail('expected Var or Trigger');
  }
  return program;
 }
 // ---- Interpreter --------------------------------------------------------------------
 const DEFAULTS={handle:null,bool:false,float:0,int:0,string:''};
 const truthy=v=>v!==null&&v!==undefined&&v!==false&&v!==0&&v!=='';
 const numeric=v=>v===true?1:v===false?0:v==null?0:typeof v==='number'?v:Number(v)||0;
 function equal(a,b){
  if(typeof a==='boolean'||typeof b==='boolean')return numeric(a)===numeric(b);
  if(a==null||b==null)return a==null&&b==null||a===0&&b==null||b===0&&a==null;
  if(typeof a==='string'||typeof b==='string')return String(a).toLowerCase()===String(b).toLowerCase();
  return a===b;
 }
 // library: {Name(args...)} supplied by the game; options.clock(): seconds.
 function create(source,library,options={}){
  const program=typeof source==='string'?parse(source,options.name):source;
  const clock=options.clock||(()=>0);
  const log=options.log||(()=>{});
  const missing=new Map();
  const globals=new Map();
  const scopeOf=(scope,name)=>{for(let s=scope;s;s=s.parent)if(s.vars.has(name))return s;return null;};
  const lookup=(scope,name)=>{const s=scopeOf(scope,name);return s?s.vars.get(name):undefined;};
  const assign=(scope,name,value)=>{(scopeOf(scope,name)||root).vars.set(name,value);};
  const root={vars:globals,parent:null};
  // Handles: Bool (set/cleared by the script or the game), timers.
  const handles={
   bool:()=>({type:'Bool',fired:false}),
   timer:ms=>({type:'Timer',at:clock()+numeric(ms)/1000}),
   fired:h=>!!h&&(h.type==='Timer'?clock()>=h.at:!!h.fired)
  };
  const triggers=new Map(program.triggers.map((t,i)=>[t.name.toLowerCase(),{...t,order:i,running:null,destroyed:false}]));
  const findTrigger=name=>triggers.get(String(name).toLowerCase());
  // Functions the language itself provides.
  const core={
   ActivarTrigger:name=>{const t=findTrigger(name);if(t&&!t.destroyed)t.active=true;return !!t;},
   DesactivarTrigger:name=>{const t=findTrigger(name);if(t)t.active=false;return !!t;},
   DestruirTrigger:name=>{const t=findTrigger(name);if(t){t.active=false;t.destroyed=true;}return !!t;},
   CrearTimer:ms=>handles.timer(ms),
   CrearHandle:()=>handles.bool(),
   CrearSemaforo:()=>handles.bool(),
   HandleDisparado:h=>handles.fired(h),
   HandleInicializado:h=>h!=null,
   ActivarHandleBool:h=>{if(h)h.fired=true;},
   DesactivarHandleBool:h=>{if(h&&h.type!=='Timer')h.fired=false;},
   DisposeHandle:ref=>{if(ref?.ref)assign(ref.scope,ref.name,null);},
   Print:(...args)=>log('Print',args.join(' ')),
   DarNumeroAleatorio:(a,b)=>b===undefined?Math.floor(Math.random()*numeric(a)):numeric(a)+Math.random()*(numeric(b)-numeric(a)),
  };
  function call(node,scope){
   const args=node.args.map(a=>a.kind==='ref'?{ref:true,scope,name:a.name,get value(){return lookup(scope,a.name);},set value(v){assign(scope,a.name,v);}}:evaluate(a,scope));
   const fn=core[node.name]||library[node.name];
   if(!fn){
    if(!missing.has(node.name)){missing.set(node.name,0);log('missing',node.name);}
    missing.set(node.name,missing.get(node.name)+1);
    return 0;
   }
   const value=fn(...args);
   return value===undefined?0:value;
  }
  function evaluate(node,scope,inCondition=false){
   switch(node.kind){
    case 'literal':return node.value;
    case 'name':{const v=lookup(scope,node.name);return v===undefined?0:v;}
    case 'assign':{const v=evaluate(node.value,scope);assign(scope,node.name,v);return v;}
    case 'not':return !truthy(evaluate(node.value,scope,inCondition));
    case 'neg':return -numeric(evaluate(node.value,scope,inCondition));
    case 'ref':return lookup(scope,node.name);
    case 'call':
     // In a condition Wait(h) tests h and WaitBool(e) is e.
     if(node.name==='Wait')return handles.fired(evaluate(node.args[0],scope));
     if(node.name==='WaitBool')return truthy(evaluate(node.args[0],scope,true));
     return call(node,scope);
    case 'binary':{
     const op=node.op;
     if(op==='&&')return truthy(evaluate(node.left,scope,inCondition))&&truthy(evaluate(node.right,scope,inCondition));
     if(op==='||')return truthy(evaluate(node.left,scope,inCondition))||truthy(evaluate(node.right,scope,inCondition));
     const a=evaluate(node.left,scope,inCondition),b=evaluate(node.right,scope,inCondition);
     switch(op){
      case '==':return equal(a,b);
      case '!=':return !equal(a,b);
      case '<':return numeric(a)<numeric(b);
      case '>':return numeric(a)>numeric(b);
      case '<=':return numeric(a)<=numeric(b);
      case '>=':return numeric(a)>=numeric(b);
      case '+':return typeof a==='string'||typeof b==='string'?String(a)+String(b):numeric(a)+numeric(b);
      case '-':return numeric(a)-numeric(b);
      case '*':return numeric(a)*numeric(b);
      case '/':{const d=numeric(b);return d?numeric(a)/d:0;}
     }
    }
   }
   throw new Error('Unknown expression '+node.kind);
  }
  function declare(list,scope){
   for(const d of list)scope.vars.set(d.name,d.init?evaluate(d.init,scope):DEFAULTS[d.type]??0);
  }
  // Statements run as generators; a blocking wait yields its predicate.
  function* run(node,scope){
   switch(node.kind){
    case 'block':for(const s of node.body)yield* run(s,scope);return;
    case 'empty':return;
    case 'declare':declare(node.list,scope);return;
    case 'if':
     if(truthy(evaluate(node.test,scope)))yield* run(node.then,scope);
     else if(node.otherwise)yield* run(node.otherwise,scope);
     return;
    case 'expr':{
     const e=node.expr;
     if(e.kind==='call'&&e.name==='Wait'){const h=evaluate(e.args[0],scope);yield ()=>handles.fired(h);return;}
     if(e.kind==='call'&&e.name==='WaitBool'){yield ()=>truthy(evaluate(e.args[0],scope,true));return;}
     evaluate(e,scope);return;
    }
   }
  }
  declare(program.globals,root);
  function start(trigger){
   const scope={vars:new Map(),parent:root};
   declare(trigger.locals,scope);
   trigger.running={iterator:run(trigger.body,scope),waiting:null};
   advance(trigger);
  }
  function advance(trigger){
   const job=trigger.running;
   try{
    while(true){
     if(job.waiting&&!job.waiting())return;
     const step=job.iterator.next();
     if(step.done){trigger.running=null;return;}
     job.waiting=step.value;
    }
   }catch(error){
    trigger.running=null;trigger.active=false;
    log('error',`${trigger.name}: ${error.message}`);
   }
  }
  let ticks=0;
  // One scheduling pass: resume waiting bodies, then start triggers whose
  // condition holds.
  function update(){
   ticks++;
   for(const trigger of [...triggers.values()].sort((a,b)=>a.order-b.order)){
    if(trigger.running){advance(trigger);continue;}
    if(!trigger.active||trigger.destroyed)continue;
    let fire=false;
    try{fire=truthy(evaluate(trigger.condition,root,true));}
    catch(error){trigger.active=false;log('error',`${trigger.name} condition: ${error.message}`);continue;}
    if(fire)start(trigger);
   }
  }
  return {update,triggers,globals,missing,handles,program,
   get running(){return [...triggers.values()].filter(t=>t.running).map(t=>t.name);},
   get ticks(){return ticks;},
   value:name=>globals.get(name)};
 }
 return {tokenize,parse,create,truthy,numeric};
});
