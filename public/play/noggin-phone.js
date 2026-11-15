'use strict';
/**
 * Phone controls for the NOGGIN mini-games and Showdowns, ported from NOGGIN's
 * play.js with as few changes as possible. Smart Alec's play.js calls update()
 * whenever a new room state arrives during a mini-game or Showdown.
 */
window.NogginPhone = function NogginPhone(opts) {
  const socket = opts.socket;
  const U = {request: SA.request};
  const $ = id => document.getElementById(id);
  const error = msg => opts.onError(msg || '');
  let roomState = null, howto = {};
  fetch('/shared/howto.json').then(r => r.json()).then(j => { howto = j; }).catch(() => {});
  let currentDeadline = null, clockServer = null, clockLocal = null;
  let entryDraft = {key: null, text: ''};
  let interactionKey = null;
  function howToSteps(id){const e=howto[id];if(id==='colour-clash'&&roomState?.settings?.colourBlindSafe&&e?.colourBlindSteps)return e.colourBlindSteps;
    // G9: Classic-only wording where Showtime adds a twist.
    if(roomState?.settings?.rules!=='showtime'&&e?.classicSteps)return e.classicSteps;return e?.steps;}
  function howToList(id){const steps=howToSteps(id);if(!steps)return null;const list=document.createElement('ol');list.className='phone-howto';
    for(const [icon,text] of steps){const li=document.createElement('li');const i=document.createElement('span');i.textContent=icon;i.setAttribute('aria-hidden','true');li.append(i,document.createTextNode(' '+text));list.append(li);}return list;}
  function controlKey(player,b){
    if(b.step==='minigame'&&b.minigame){
      const m=b.minigame;
      // D6: everything that changes WHICH controls this phone shows. Text-only
      // changes (counters, scores, clocks) are patched in place without a rebuild.
      const blocked=Boolean(m.blocked?.[player.id]&&m.blocked[player.id]>roomState.serverNow);
      // D7: Quick Draw's WAIT→DRAW switch happens on the phone itself, so the server's
      // own switch must not rebuild the button just as someone taps it.
      const phase=m.id==='quick-draw'&&['wait','play'].includes(m.phase)?'quick':m.phase;
      return [b.step,m.id,phase,m.roundKey,m.private?.role,m.private?.strokesLeft,
        m.private?.prompt,m.answered?.includes(player.id),m.voted?.includes(player.id),
        m.eliminated?.includes(player.id),blocked,
        m.display?.keypadReady,m.display?.partnerId,m.display?.progress?.join?.(','),
        m.display?.cut?.join?.(','),m.display?.options?.length].join('|');
    }
    if(b.step==='showdown'&&b.showdown){
      const m=b.showdown;
      return [b.step,m.kind,m.phase,m.roundKey,m.private?.qid,m.myCheer,m.cheerOpen,
        m.display?.turnId,m.display?.bidderId,m.display?.bid,m.display?.answerId,m.display?.banks?.includes(player.id),
        m.display?.answered?.includes(player.id),m.display?.buzzed?.includes(player.id)].join('|');
    }
    return [b.step,b.turn,b.paused,b.round?.rolls?.[player.id]?1:0,b.round?.directors?.[player.id]?1:0,b.routePlan?1:0].join('|');
  }
  async function sendTap(btn,event,payload,vibrate=35){
    if(!socket.connected||btn.dataset.busy==='1')return;
    btn.dataset.busy='1';btn.disabled=true;
    try{const r=await U.request(socket,event,payload);delete btn.dataset.busy;btn.disabled=!socket.connected;opts.onState(r.state);error('');if(vibrate&&navigator.vibrate)navigator.vibrate(vibrate);}
    catch(e){delete btn.dataset.busy;btn.disabled=!socket.connected;error(e.message);}
  }
  function gameButton(text,event,payload={},style='button-blue') {
    const btn=document.createElement('button');btn.type='button';btn.textContent=text;btn.className=style;
    btn.disabled=!socket.connected;
    btn.onclick=()=>sendTap(btn,event,payload);
    $('gameButtons').append(btn);
  }
  function numericOrWordControl(m,integer) {
    const form=document.createElement('form');form.className='mini-answer';
    const input=document.createElement('input');input.type=integer?'number':'text';input.required=true;input.autocomplete='off';input.autocapitalize=integer?'off':'characters';
    input.inputMode=integer?'numeric':'text';input.placeholder=integer?'YOUR NUMBER':'TYPE THE WORD';input.maxLength=40;
    if(integer){input.min='0';input.max='100000000';input.step='1';}
    input.setAttribute('aria-label',integer?'Your numerical guess':'Unscrambled word');
    const submit=document.createElement('button');submit.type='submit';submit.className='button-primary';submit.textContent='LOCK IN ANSWER';
    form.append(input,submit);form.onsubmit=async e=>{
      e.preventDefault();const value=integer?Number(input.value):input.value.trim();
      if(integer&&(!Number.isSafeInteger(value)||input.value.trim()==='')){error('Enter a valid whole number.');return;}
      submit.disabled=true;
      try{const r=await U.request(socket,'game:input',{value,roundKey:m.roundKey});submit.disabled=false;if(!integer)input.select();error('');opts.onState(r.state);}
      catch(err){error(err.message);submit.disabled=false;}
    };
    $('gameButtons').append(form);
  }

  const phase4Ids=new Set(['sketch-sabotage','noise-annoys','caption-this','fib-factory','mind-meld','majority-rules','relay-sums','bomb-squad']);
  function p4Entry(m,{label='TYPE AN ANSWER',numeric=false,max=90,placeholder='YOUR ANSWER'}={}){
    const wrap=document.createElement('form');wrap.className='mini-answer p4-form';
    const input=document.createElement('input');input.type=numeric?'number':'text';input.maxLength=max;input.required=true;input.autocomplete='off';input.inputMode=numeric?'numeric':'text';input.placeholder=placeholder;
    if(numeric){input.min='0';input.max='9999';input.step='1';}
    input.setAttribute('aria-label',placeholder);
    const k=`${m.id}:${m.phase}:${m.roundKey}`;
    if(entryDraft.key===k)input.value=entryDraft.text;
    input.oninput=()=>{entryDraft={key:k,text:input.value};};
    const button=document.createElement('button');button.type='submit';button.className='button-primary';button.textContent=label;
    wrap.append(input,button);
    wrap.onsubmit=async(e)=>{
      e.preventDefault();const v=numeric?Number(input.value):input.value.trim();
      if(numeric&&(!Number.isSafeInteger(v)||input.value.trim()==='')){error('Enter a whole number.');return;}
      button.disabled=true;
      try{const r=await U.request(socket,'game:input',{value:v,roundKey:m.roundKey});entryDraft={key:null,text:''};input.value='';button.disabled=false;opts.onState(r.state);error('');}
      catch(ex){error(ex.message);button.disabled=false;}
    };
    $('gameButtons').append(wrap);
  }
  function p4DrawCanvas(m){
    const label=document.createElement('div');label.className='mini-help';label.textContent=m.private?.role==='saboteur'?`SECRET SABOTEUR · ${m.private.strokesLeft} misleading strokes left`:`ARTIST · DRAW ${m.private?.word||'YOUR WORD'}`;$('gameButtons').append(label);
    const canvas=document.createElement('canvas');canvas.className='sketch-canvas';canvas.width=1000;canvas.height=700;canvas.setAttribute('aria-label','Draw here with a finger or mouse');
    canvas.dataset.strokeCount=String((m.display.strokes||[]).length);canvas.dataset.drawing='false';
    const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,1000,700);ctx.lineWidth=9;ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle='#152447';
    function paint(points){if(points.length<2)return;ctx.beginPath();ctx.moveTo(...points[0].map(v=>v*1));for(let i=1;i<points.length;i++)ctx.lineTo(points[i][0],points[i][1]);ctx.stroke();}
    for(const stroke of m.display.strokes||[])paint(stroke.points);
    let points=[],drawing=false,started=0;
    const relative=(ev)=>{const r=canvas.getBoundingClientRect();return [Math.max(0,Math.min(1000,Math.round((ev.clientX-r.left)/r.width*1000))),Math.max(0,Math.min(1000,Math.round((ev.clientY-r.top)/r.height*700)))]};
    canvas.onpointerdown=ev=>{if(!socket.connected)return;drawing=true;canvas.dataset.drawing='true';started=Date.now();points=[relative(ev)];canvas.setPointerCapture(ev.pointerId);ev.preventDefault();};
    canvas.onpointermove=ev=>{if(!drawing)return;const pt=relative(ev),last=points.at(-1);if(points.length>=70||Math.hypot(pt[0]-last[0],pt[1]-last[1])<8)return;points.push(pt);ctx.beginPath();ctx.moveTo(last[0],last[1]);ctx.lineTo(pt[0],pt[1]);ctx.stroke();ev.preventDefault();};
    canvas.onpointerup=async(ev)=>{if(!drawing)return;drawing=false;canvas.dataset.drawing='false';const end=relative(ev);if(points.length===1)points.push([Math.min(1000,end[0]+2),end[1]]);const payload={points,roundKey:m.roundKey};points=[];try{const r=await U.request(socket,'game:draw',payload);opts.onState(r.state);error('');}catch(ex){error(ex.message);opts.rerender();}};
    canvas.onpointercancel=()=>{drawing=false;canvas.dataset.drawing='false';points=[];};
    $('gameButtons').append(canvas);
  }
  function renderPhase4(player,m){
    const id=player.id,host=roomState.board.activeId;
    $('gameHeadline').textContent=`${m.title.toUpperCase()}${m.totalRounds>1?` · ${m.round}/${m.totalRounds}`:''}`;
    $('gameDescription').textContent=m.rule;
    currentDeadline=m.phase==='intro'?m.introUntil:m.deadline;clockServer=roomState.serverNow;clockLocal=Date.now();
    if(m.phase==='intro'){const list=howToList(m.id);if(list){$('gameButtons').replaceChildren(list);}else $('gameButtons').textContent='GET READY! WATCH THE TV FOR THE RULES';return;}
    const info=(text)=>{const d=document.createElement('div');d.className='mini-help';d.textContent=text;$('gameButtons').append(d);};
    const sent=m.answered.includes(id),voted=m.voted?.includes(id);
    // Q4: private feedback on your last guess. "Close!" never reveals the answer.
    const guessFeedback=(mm)=>{const fb=mm.private?.guessFeedback;if(!fb)return;
      const d=document.createElement('div');d.className=`mini-help guess-feedback ${fb.result}`;
      d.textContent=fb.result==='close'?'🔥 CLOSE! You share a word with the answer — keep going.':'✗ NOT IT — TRY AGAIN.';$('gameButtons').append(d);};
    const pick=(text,value,style='button-blue')=>gameButton(text,'game:input',{value,roundKey:m.roundKey},style);
    if(m.id==='sketch-sabotage'){
      if(m.private?.role==='artist'||m.private?.role==='saboteur'){
        if(m.private.role==='saboteur'&&m.private.strokesLeft===0){info('THREE SABOTAGE STROKES USED — NOW WATCH THE TV');return;}
        p4DrawCanvas(m);
      }else{info(`Category: ${m.display.category}`);guessFeedback(m);p4Entry(m,{label:'GUESS THE DRAWING',placeholder:'WHAT IS IT?',max:55});}
    }else if(m.id==='noise-annoys'){
      if(id===host){info(`YOUR SECRET SOUND: ${m.private?.clue||'Look for your clue'}`);info('Make the noise aloud. No words and no miming.');}
      else{info('LISTEN TO THE HOST IN THE ROOM');guessFeedback(m);p4Entry(m,{label:'SUBMIT GUESS',placeholder:'WHAT WAS THAT SOUND?',max:65});}
    }else if(m.id==='caption-this'){
      info('SCENE: '+m.question);
      if(m.phase==='play'){if(sent)info('CAPTION LOCKED IN — WAIT FOR VOTING');else p4Entry(m,{label:'SEND YOUR CAPTION',placeholder:'YOUR FUNNIEST CAPTION',max:110});}
      else if(voted)info('YOUR VOTE IS LOCKED IN');
      else (m.display.options||[]).forEach((c,i)=>{if(m.private?.myEntryIndex===i)return;pick(`${i+1}. ${c}`,i,'button-blue small');});
    }else if(m.id==='fib-factory'){
      info(m.question);
      if(m.phase==='play'){if(sent)info('YOUR FIB IS LOCKED IN');else p4Entry(m,{label:'SUBMIT YOUR FIB',placeholder:'A CONVINCING FAKE ANSWER',max:65});}
      else if(voted)info('YOUR CHOICE IS LOCKED IN');
      else (m.display.options||[]).forEach((c,i)=>{if(m.private?.myEntryIndex===i)return;pick(`${i+1}. ${c}`,i,'button-blue small');});
    }else if(m.id==='mind-meld'){
      info(m.question);
      // G6: everyone plays in pairs (or one group of three).
      const name=pid=>roomState.players.find(p=>p.id===pid)?.name||'Contestant';
      const groups=m.display.groups||(m.display.partnerId?[[host,m.display.partnerId]]:[]),gi=groups.findIndex(g=>g.includes(id)),mine=gi>=0?groups[gi]:null;
      const matched=(m.display.matched||[]).includes(gi);
      if(m.phase==='partner'){
        if(id!==host)info('THE HOST IS PICKING A PARTNER · EVERYONE ELSE IS PAIRED BY SEAT');
        else (m.display.partners||[]).forEach((pid,i)=>pick(`PARTNER: ${name(pid)}`,i));
      }else{
        if(mine)info(`YOUR ${mine.length>2?'GROUP':'PARTNER'}: ${mine.filter(x=>x!==id).map(name).join(' & ')}`);
        if(m.phase==='reveal'){const r=(m.lastResult?.groups||[]).find(g=>g.ids.includes(id));if(r)info(`YOUR WORDS: ${r.words.join(' / ')}`);info(matched?'★ YOU MATCHED!':'ANOTHER ATTEMPT STARTS SHORTLY');}
        else if(matched)info('★ YOU MATCHED! WAIT FOR THE OTHERS.');
        else if(mine){if(sent)info(`WORD LOCKED IN — DON’T TELL YOUR ${mine.length>2?'GROUP':'PARTNER'}!`);else p4Entry(m,{label:'LOCK IN WORD',placeholder:'ONE WORD OR SHORT PHRASE',max:32});}
        else info('WATCH THE TV');
      }
    }else if(m.id==='majority-rules'){
      info(m.question);if(sent)info('SECRET VOTE LOCKED IN');else (m.display.options||[]).forEach((v,i)=>pick(v,i,'button-primary'));
    }else if(m.id==='relay-sums'){
      const team=m.display.teams.findIndex(ids=>ids.includes(id));info(`YOU ARE TEAM ${team+1} · ${m.display.progress[team]}/${m.display.totals[team]} SUMS DONE`);
      if(m.private?.role==='relay-solver'){info(m.private.prompt);p4Entry(m,{label:'SUBMIT SUM',numeric:true,max:4,placeholder:'YOUR ANSWER'});}
      else info('WAIT FOR YOUR TURN IN THE RELAY');
    }else if(m.id==='bomb-squad'){
      for(const clue of m.private?.clues||[])info(clue);
      if(id===host){
        if(!m.display.keypadReady){info('CUT THE WIRES IN THE ORDER REVEALED BY YOUR TEAM');for(const wire of m.display.wires||[])if(!m.display.cut.includes(wire))pick(`✂ CUT ${wire} WIRE`,wire,'button-blue');}
        else{info('ALL WIRES CUT! ENTER THE FOUR-DIGIT CODE.');p4Entry(m,{label:'DEFUSE THE BOMB',numeric:false,max:4,placeholder:'4-DIGIT CODE'});}
      }else info('READ YOUR CLUE(S) ALOUD TO THE HOST!');
    }
    if(entryDraft.key===`${m.id}:${m.phase}:${m.roundKey}` && document.activeElement?.tagName==='BODY'){
      // Do not pop the keyboard open when a user has not started typing.
    }
  }

  let buzzSeen={key:null,at:0};
  function renderShowdown(player,m){
    const mine=m.participants.includes(player.id);
    const info=t=>{const x=document.createElement('div');x.className='mini-help';x.textContent=t;$('gameButtons').append(x);};
    const choose=(label,value)=>gameButton(label,'game:input',{value,roundKey:m.roundKey},'button-primary');
    const numberForm=(label,placeholder,numeric=true)=>{
      const form=document.createElement('form');form.className='mini-answer p4-form';
      const input=document.createElement('input');input.type=numeric?'number':'text';input.placeholder=placeholder;input.required=true;input.autocomplete='off';input.inputMode=numeric?'numeric':'text';input.maxLength=70;
      const button=document.createElement('button');button.className='button-primary';button.type='submit';button.textContent=label;
      form.append(input,button);form.onsubmit=async e=>{e.preventDefault();const v=numeric?Number(input.value):input.value.trim();if(numeric&&(!Number.isSafeInteger(v)||v<0||!input.value.trim())){error('Enter a valid whole number.');return;}
        const value=m.kind==='tug'?{answer:v,qid:m.private?.qid}:v;button.disabled=true;
        try{const r=await U.request(socket,'game:input',{value,roundKey:m.roundKey});input.value='';button.disabled=false;opts.onState(r.state);error('');if(navigator.vibrate)navigator.vibrate(35);}
        catch(e){error(e.message);button.disabled=false;}
      };$('gameButtons').append(form);
    };
    $('gameHeadline').textContent=m.title;
    $('gameDescription').textContent=m.question;
    currentDeadline=m.deadline;clockServer=roomState.serverNow;clockLocal=Date.now();
    if(m.kind==='bid' && m.phase==='review'){
      // D10: duellists never judge. The TV or ANY other player decides; first tap counts.
      const said=m.display.review?.text||m.display.review?.answer||'';
      if(mine){info(`“${said}” IS NOT ON THE LIST — IT IS BEING JUDGED.`);info('THE TV OR ANOTHER PLAYER WILL JUDGE.');return;}
      info(`CATEGORY: ${m.question}`);
      info(`PROPOSED ANSWER: “${said}”`);
      gameButton('✓ ACCEPT ANSWER','game:bid-review',{accept:true},'button-primary');
      gameButton('✕ REJECT ANSWER','game:bid-review',{accept:false},'button-blue');
      info('YOU ARE A JUDGE · THE FIRST DECISION COUNTS');
      return;
    }
    if(!mine){
      if(m.kind==='tiebreak'){info('SUDDEN DEATH — WATCH THE FINALISTS');return;}
      // G2: Spotlight Picks work in both modes. Classic pays a catch-up Spark.
      info(roomState.settings.rules==='showtime'
        ?'🎬 SPOTLIGHT PICK · Back the winner BEFORE the duel. Earn 1 Director Cue if correct (max 2); no Sparks at risk.'
        :'🎬 SPOTLIGHT PICK · Back the winner BEFORE the duel. Correct pick: +1 Spark if you are outside the top two. No Sparks at risk.');
      if(m.myCheer)info(`PREDICTION LOCKED: ${roomState.players.find(p=>p.id===m.myCheer)?.name||'CHALLENGER'}`);
      else if(m.cheerOpen)for(const id of m.participants){
        const contestant=roomState.players.find(p=>p.id===id);
        gameButton(`🎬 BACK ${contestant?.name||'CHALLENGER'}`,'game:cheer',{targetId:id},'button-blue');
      }else info('PREDICTIONS LOCKED — WATCH THE SHOWDOWN');
      return;
    }
    if(m.phase==='intro'){const list=howToList(m.kind);if(list)$('gameButtons').append(list);info('THE SHOWDOWN STARTS AFTER THE COUNTDOWN.');return;}
    if(m.kind==='buzzer'){
      info(`QUESTION ${m.round}/${m.totalRounds||5} · FIRST TO 3 · ${Object.entries(m.display.points).map(([id,v])=>`${roomState.players.find(p=>p.id===id)?.name}: ${v}`).join(' vs ')}`);
      if(m.phase==='buzz'){
        // D7: time the buzz from when the question appeared on THIS phone.
        if(buzzSeen.key!==m.roundKey)buzzSeen={key:m.roundKey,at:performance.now()};
        if(m.display.buzzed?.includes(player.id))info('BUZZED! CHECKING WHO WAS QUICKEST…');
        else{const btn=document.createElement('button');btn.type='button';btn.className='button-primary';btn.textContent='⚡ BUZZ!';btn.disabled=!socket.connected;
          btn.onclick=()=>sendTap(btn,'game:input',{value:{action:'buzz',reactionMs:Math.round(performance.now()-buzzSeen.at)},roundKey:m.roundKey},60);
          $('gameButtons').append(btn);}
      }
      else if(m.display.answerId===player.id){info('YOU BUZZED FIRST. ANSWER NOW!');m.display.choices.forEach((choice,i)=>choose(choice,i));}
      else info('WAIT — THE OTHER CHALLENGER IS ANSWERING.');
    }else if(m.kind==='tug'){
      info(`ROPE POSITION: ${m.display.rope}`);info(m.private?.prompt||'WAIT FOR THE NEXT SUM');
      if(m.private?.prompt)numberForm('PULL THE ROPE','YOUR ANSWER');
    }else if(m.kind==='bid'){
      info(`CURRENT BID: ${m.display.bid} · MAXIMUM: ${m.display.max}`);
      if(m.phase==='auction'){
        if(m.display.turnId!==player.id){info('OTHER PLAYER IS BIDDING.');return;}
        if(!m.display.bidderId)info('YOU BID FIRST — HOW MANY CAN YOU NAME?');
        for(let n=m.display.bid+1;n<=Math.min(m.display.max,m.display.bid+4);n++)choose(`I CAN NAME ${n}`,{action:'bid',count:n});
        if(m.display.bidderId)choose('CHALLENGE THAT BID!',{action:'challenge'});
      }else if(m.phase==='name'){
        info(`${m.display.correct}/${m.display.bid} CORRECT · ${m.display.invalid}/3 INVALID`);
        if(m.display.bidderId===player.id)numberForm('SUBMIT CATEGORY ANSWER','TYPE ONE ITEM',false);
        else info('THE HIGH BIDDER IS NAMING THEIR ITEMS.');
      }
    }else if(m.kind==='nerve'){
      info(`CURRENT COUNTER: ${m.display.number}`);
      if(m.display.banks.includes(player.id))info('BANKED! WAIT FOR THE OTHER PLAYER.');
      else choose('🏦 BANK NOW','bank');
    }else if(m.kind==='tiebreak'){
      info(`ENTER YOUR CLOSEST GUESS (${m.display.unit||'NUMBER'})`);
      if((m.display.attempt||1)>1)info('FINAL REPLAY — IF STILL LEVEL, THE FIRST ANSWER IN WINS.');
      if(m.display.answered.includes(player.id))info('GUESS LOCKED IN');
      else numberForm('LOCK IN MY GUESS','YOUR BEST NUMBER');
    }
  }

  // D7: Quick Draw times each player's reaction on their OWN phone, from the moment
  // this phone showed DRAW (worked out from the server's DRAW time and clock).
  let quickDraw={key:null,shownAt:null,timer:null};
  const QD_WAIT='✋ WAIT FOR DRAW!',QD_GO='⚡ DRAW! TAP NOW!';
  function quickDrawButton(m){
    if(quickDraw.key!==m.roundKey){clearTimeout(quickDraw.timer);quickDraw={key:m.roundKey,shownAt:null,timer:null};}
    const localOpen=clockLocal+(m.openAt-clockServer);
    const go=()=>{
      if(quickDraw.shownAt===null)quickDraw.shownAt=performance.now()-Math.max(0,Date.now()-localOpen);
      for(const b of document.querySelectorAll('#gameButtons .quick-draw-button')){b.textContent=QD_GO;b.classList.add('drawn');}
      if(navigator.vibrate)navigator.vibrate(40);
    };
    const drawn=quickDraw.shownAt!==null||Date.now()>=localOpen||m.phase==='play';
    const btn=document.createElement('button');btn.type='button';btn.className='button-primary quick-draw-button'+(drawn?' drawn':'');
    btn.textContent=drawn?QD_GO:QD_WAIT;btn.disabled=!socket.connected;
    if(drawn&&quickDraw.shownAt===null)quickDraw.shownAt=performance.now()-Math.max(0,Date.now()-localOpen);
    if(!drawn&&!quickDraw.timer)quickDraw.timer=setTimeout(go,Math.max(0,localOpen-Date.now()));
    btn.onclick=()=>{
      // A tap while WAIT shows is a misfire: no reaction time is sent.
      const value=quickDraw.shownAt===null?{value:1}:{value:1,reactionMs:Math.round(performance.now()-quickDraw.shownAt)};
      sendTap(btn,'game:input',{value,roundKey:m.roundKey});
    };
    $('gameButtons').append(btn);
  }
  // D8: Shape Clash draws the shape word inside a DIFFERENT outline shape.
  function shapeSvg(shape,word){
    const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 100 100');svg.setAttribute('class','shape-clash');svg.setAttribute('role','img');svg.setAttribute('aria-label',`The word ${word} inside a ${shape.toLowerCase()}`);
    const star=Array.from({length:10},(_,i)=>{const r=i%2?20:46,a=-Math.PI/2+i*Math.PI/5;return `${(50+r*Math.cos(a)).toFixed(1)},${(53+r*Math.sin(a)).toFixed(1)}`;}).join(' ');
    const el=shape==='CIRCLE'?['circle',{cx:50,cy:50,r:43}]:shape==='SQUARE'?['rect',{x:9,y:9,width:82,height:82}]:shape==='TRIANGLE'?['polygon',{points:'50,6 95,92 5,92'}]:['polygon',{points:star}];
    const outline=document.createElementNS(ns,el[0]);for(const [k,v] of Object.entries(el[1]))outline.setAttribute(k,v);outline.setAttribute('class','shape-outline');
    const text=document.createElementNS(ns,'text');text.setAttribute('x','50');text.setAttribute('y',shape==='TRIANGLE'?'72':'57');text.setAttribute('text-anchor','middle');text.setAttribute('class','shape-word');text.textContent=word;
    svg.append(outline,text);return svg;
  }
  function renderMiniGame(player,m) {
    const eligible=m.participants.includes(player.id)&&!m.eliminated.includes(player.id);
    const answered=m.answered.includes(player.id);
    $('gameHeadline').textContent=`${m.title.toUpperCase()} · ${m.round}/${m.totalRounds}`;
    $('gameDescription').textContent=m.rule+'  '+m.question;
    currentDeadline=m.phase==='intro'?m.introUntil:m.deadline;clockServer=roomState.serverNow;clockLocal=Date.now();
    if(m.phase==='intro'){$('gameDescription').textContent=m.rule;const list=howToList(m.id);if(list)$('gameButtons').replaceChildren(list);else $('gameButtons').textContent='GET READY — WATCH THE TV DEMO';return;}
    if(m.phase==='reveal'){
      const result=m.lastRoundResult||{},answer=result.answer;
      $('gameDescription').textContent=answer===undefined?'ROUND COMPLETE':`CORRECT ANSWER: ${answer}`;
      const win=(result.winners||[]).includes(player.id);
      const mine=(result.guesses||[]).find(g=>g.id===player.id);
      const extra=mine?` · YOUR GUESS ${Number(mine.guess).toLocaleString('en-GB')} (${mine.distance===0?'SPOT ON':`OFF BY ${Number(mine.distance).toLocaleString('en-GB')}`})`:'';
      $('gameButtons').textContent=(win?'★ YOU WON THIS ROUND! ★':m.finalReveal?'GAME OVER — RESULTS NEXT':'ROUND OVER — NEXT ONE STARTS SHORTLY')+extra;return;
    }
    if(!eligible){$('gameButtons').textContent='YOU ARE OUT — WATCH THE TV';return;}
    if(answered){$('gameButtons').textContent='✓ LOCKED IN — WATCH THE TV';return;}
    const send=(text,value,style='button-blue')=>gameButton(text,'game:input',{value,roundKey:m.roundKey},style);
    if(m.id==='quick-draw'){
      quickDrawButton(m);
    } else if(m.phase==='flash'){
      $('gameButtons').textContent='👀 WATCH THE TV FIRST';
    } else if(m.id==='count-flash'||m.id==='close-call') numericOrWordControl(m,true);
    else if(m.id==='unscramble') numericOrWordControl(m,false);
    else if(m.id==='odd-spot'){
      // A wrong tap locks this player's grid for three seconds.
      const locked=Boolean(m.blocked[player.id]&&m.blocked[player.id]>roomState.serverNow);
      const grid=document.createElement('div');grid.className='mini-grid';
      Array.from({length:36},(_,i)=>i).forEach(i=>{const btn=document.createElement('button');btn.type='button';btn.className='mini-grid-button';const glyph=document.createElement('span');glyph.textContent=m.display.grid[i];btn.append(glyph);const style=m.display.styles?.[i];if(style?.rotation)glyph.style.transform=`rotate(${style.rotation}deg)`;if(style?.tone)glyph.style.color=style.tone;if(style?.scale)glyph.style.transform=`scale(${style.scale})`;btn.setAttribute('aria-label',`Square ${i+1}: ${m.display.grid[i]}`);btn.disabled=!socket.connected||locked;
        btn.onclick=()=>sendTap(btn,'game:input',{value:i,roundKey:m.roundKey},0);grid.append(btn);});
      $('gameButtons').append(grid);
    }else if(m.id==='colour-clash'&&m.display.mode==='shape'){
      $('gameButtons').append(shapeSvg(m.display.shape,m.display.word));
      ['● CIRCLE','■ SQUARE','▲ TRIANGLE','★ STAR'].forEach((v,i)=>send(v,i));
    }else if(m.id==='colour-clash'){
      const word=document.createElement('div');word.className='stroop-word';word.textContent=m.display.word;word.style.color=({RED:'#ff7284',BLUE:'#78c7ff',GREEN:'#a5f480',YELLOW:'#ffe37a'})[m.display.ink];$('gameButtons').append(word);
      ['RED','BLUE','GREEN','YELLOW'].forEach((v,i)=>send(v,i));
    } else if(m.id==='higher-lower'){
      const strikes=document.createElement('div');strikes.className='mini-help';strikes.textContent=`STRIKES: ${m.strikes?.[player.id]||0}/2 · SECOND WRONG ANSWER ELIMINATES`; $('gameButtons').append(strikes);
      ['HIGHER','LOWER'].forEach((v,i)=>send(v,i,'button-primary'));
    } else if(m.id==='memory-lane'){
      const prog=m.progress[player.id]||0;
      const hint=document.createElement('div');hint.className='mini-help';hint.textContent=`${m.display.reverse?'FINAL ROUND — REPEAT THE PATTERN BACKWARDS!':'Repeat in the same order'} · ${prog} of ${m.display.sequenceLength} pads`;
      $('gameButtons').append(hint);const grid=document.createElement('div');grid.className='memory-pads';
      const symbols=['●','◆','▲','■','★','✦'];
      symbols.forEach((v,i)=>{const btn=document.createElement('button');btn.type='button';btn.className=`memory-pad pad-${i}`;btn.textContent=v;btn.disabled=!socket.connected;btn.onclick=()=>sendTap(btn,'game:input',{value:i,roundKey:m.roundKey},20);grid.append(btn);});
      $('gameButtons').append(grid);
    }
    if(m.blocked[player.id]&&m.blocked[player.id]>roomState.serverNow){
      const notice=document.createElement('div');notice.className='mini-help';notice.textContent='Wrong answer — short penalty before another try.';$('gameButtons').append(notice);
    }
  }
  const shortInstructions=Object.freeze({
    'quick-draw':'Wait for DRAW, then tap faster than everyone else.',
    'count-flash':'Remember the objects, then count the requested type.',
    'odd-spot':'Find the odd symbol; tap the same square.',
    'colour-clash':'Tap the ink colour, not the written word.',
    'higher-lower':'Guess higher or lower; two mistakes knock you out.',
    'memory-lane':'Repeat the pads; reverse the final sequence in Showtime.',
    'close-call':'Guess the number; the closest answer scores most.',
    'unscramble':'Unscramble the word using its category clue.',
    'sketch-sabotage':'Sketch or guess the word; watch for sneaky strokes.',
    'noise-annoys':'Make or guess sounds; do not use words.',
    'caption-this':'Write a funny caption, then vote for another.',
    'fib-factory':'Invent a believable fib, then spot the truth.',
    'mind-meld':'Everyone plays in pairs: write the same word as your partner.',
    'majority-rules':'Vote secretly; matching the majority earns points.',
    'relay-sums':'Solve your sum to unlock the next teammate.',
    'bomb-squad':'Share clues, cut wires in order, then enter the code.'
  });
  // D6: compare a freshly drawn set of controls with what is on screen. If the
  // layout is the same, keep every existing button/form/canvas (so a tap that is
  // already landing is never lost) and only swap plain text. Otherwise rebuild.
  function isInteractive(node){return node.nodeType===1&&(node.matches('button,form,input,select,canvas')||Boolean(node.querySelector('button,input,select,canvas')));}
  function signature(node){return node.nodeType===1?`${node.tagName}.${node.className}#${isInteractive(node)?node.querySelectorAll('button,input,select,canvas').length:''}`:'#text';}
  function syncButton(old,fresh){
    // A button whose label changed is a different control: replace it outright.
    if(old.textContent!==fresh.textContent){old.replaceWith(fresh);return;}
    if(old.dataset.busy!=='1')old.disabled=fresh.disabled;
    if(old.className!==fresh.className)old.className=fresh.className;
  }
  function syncInteractive(old,fresh){
    if(old.tagName==='BUTTON'){syncButton(old,fresh);return;}
    if(old.tagName==='FORM'||old.tagName==='CANVAS'||old.tagName==='INPUT'||old.tagName==='SELECT')return; // keep typing and drawing
    const a=[...old.children],z=[...fresh.children];
    if(a.length!==z.length||a.some((n,i)=>signature(n)!==signature(z[i]))){old.replaceWith(fresh);return;}
    a.forEach((n,i)=>isInteractive(n)?syncInteractive(n,z[i]):(n.outerHTML!==z[i].outerHTML&&n.replaceWith(z[i])));
  }
  function patchControls(real,scratch){
    const a=[...real.childNodes],z=[...scratch.childNodes];
    if(a.length!==z.length||a.some((n,i)=>signature(n)!==signature(z[i]))){real.replaceChildren(...z);return;}
    a.forEach((old,i)=>{
      const fresh=z[i];
      if(old.nodeType!==1){if(old.textContent!==fresh.textContent)old.textContent=fresh.textContent;return;}
      if(isInteractive(old))syncInteractive(old,fresh);
      else if(old.outerHTML!==fresh.outerHTML)old.replaceWith(fresh);
    });
  }
  // Draw the controls into a hidden stand-in that temporarily owns the id, then patch.
  function drawControlsPatched(draw){
    const real=$('gameButtons'),scratch=document.createElement('div');
    scratch.className=real.className;scratch.hidden=true;
    real.id='gameButtonsLive';scratch.id='gameButtons';real.after(scratch);
    try{draw();}
    finally{scratch.remove();scratch.id='';real.id='gameButtons';}
    patchControls(real,scratch);
  }

  /** Draw (or patch) this player's controls for the current mini-game or Showdown. */
  function update(state, player) {
    roomState = state;
    const b = state.board;
    const priorInput = $('gameButtons').querySelector('form input');
    const priorFocused = Boolean(priorInput && document.activeElement === priorInput);
    const activeCanvas = $('gameButtons').querySelector('canvas.sketch-canvas');
    const freshKey = controlKey(player, b);
    const sameControls = !b.paused && freshKey === interactionKey;
    clockServer = state.serverNow; clockLocal = Date.now();
    if (sameControls && activeCanvas) {
      const m = b.minigame;
      if (m && activeCanvas.dataset.drawing !== 'true') {
        const strokes = m.display?.strokes || [], seen = Number(activeCanvas.dataset.strokeCount || 0);
        if (strokes.length > seen) {
          const ctx = activeCanvas.getContext('2d'); ctx.strokeStyle = '#152447'; ctx.lineWidth = 9; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
          for (const stroke of strokes.slice(seen)) {
            if (!Array.isArray(stroke.points) || stroke.points.length < 2) continue;
            ctx.beginPath(); ctx.moveTo(...stroke.points[0]); for (const point of stroke.points.slice(1)) ctx.lineTo(...point); ctx.stroke();
          }
          activeCanvas.dataset.strokeCount = String(strokes.length);
        }
      }
      return;
    }
    if (!sameControls) interactionKey = freshKey;
    if (priorInput) entryDraft = {key: entryDraft.key, text: priorInput.value};
    const draw = () => {
      if (b.paused) { $('gameHeadline').textContent = 'Paused'; $('gameDescription').textContent = 'The game is paused on the TV.'; return; }
      if (b.step === 'showdown' && b.showdown) { renderShowdown(player, b.showdown); return; }
      if (b.step === 'minigame' && b.minigame) {
        if (phase4Ids.has(b.minigame.id)) {
          renderPhase4(player, b.minigame);
          if (priorFocused) { const el = $('gameButtons').querySelector('.p4-form input'); if (el) { el.focus(); if (el.type === 'text') el.setSelectionRange(el.value.length, el.value.length); } }
        } else renderMiniGame(player, b.minigame);
      }
    };
    if (sameControls) { drawControlsPatched(draw); return; }
    $('gameButtons').replaceChildren();
    draw();
  }
  function reset() { interactionKey = null; }
  return {update, reset};
};
