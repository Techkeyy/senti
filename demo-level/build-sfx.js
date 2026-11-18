// Packs sfx/*.mp3 into sfx/sfx.js so the level works from file:// (fetch() is blocked there).
const fs=require('fs'),p=require('path');const d=p.join(__dirname,'sfx');
let o='window.SFX={\n';for(const f of fs.readdirSync(d).filter(f=>f.endsWith('.mp3')))o+=JSON.stringify(f.slice(0,-4))+':"'+fs.readFileSync(p.join(d,f)).toString('base64')+'",\n';
fs.writeFileSync(p.join(d,'sfx.js'),o+'};\n');
