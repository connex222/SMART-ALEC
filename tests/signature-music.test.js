'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
test('Smart Alec plays its original lobby theme with legacy bundled fallback',()=>{
 const shared=read('public/shared/client.js');
 const tv=read('public/tv/tv.js');
 assert.match(shared,/ORIGINAL_MUSIC_URLS/);
 assert.match(shared,/mus-lobby-original\.mp3/);
 assert.match(shared,/bundledAudioUrl\(name\)/);
 assert.match(shared,/track\.addEventListener\('error'/);
 assert.match(shared,/track\.loop = true/);
 assert.match(shared,/voiceDucked \? 0\.25 : 1/);
 assert.match(shared,/if \(fallbackMusic\) \{ fallbackMusic\.pause\(\)/);
 assert.match(tv,/if \(screen === 'title'\) SA\.playMusic\('mus-lobby', 0\.18\)/);
 assert.match(tv,/SA\.playMusic\('mus-lobby'\)/);
 assert.doesNotMatch(tv,/Audio\(/);
});
test('shared audio and TV scripts parse',()=>{
 new Function(read('public/shared/client.js'));
 new Function(read('public/tv/tv.js'));
});
