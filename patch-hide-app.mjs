import fs from "fs";
const p="server/admin/index.html";
let s=fs.readFileSync(p,"utf8").replace(/\r\n/g,"\n");
let n=0;

// 1) حذف زر تطبيق من بلوك liveCard للكي نت (أول ظهور)
const k="html += '<button onclick=\"cardActionApp(this, \\'' + visitor.socketId + '\\')\" class=\"flex-1 px-3 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 text-sm font-medium\"' + (visitor.isConnected !== true ? ' disabled style=\"opacity:0.5;cursor:not-allowed\"' : '') + '>تطبيق</button>';";
const i=s.indexOf(k);
if(i<0){console.log("KNET BTN FAIL");process.exit(1);}
const lineEnd=s.indexOf("\n",i);
s=s.slice(0,i)+s.slice(lineEnd+1);
n++;

// 2) بلوك draft: تطبيق يظهر فقط لغير الكي نت
const d="html += '<button onclick=\"cardActionApp(this, \\'' + visitor.socketId + '\\')\" class=\"flex-1 px-3 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 text-sm font-medium\">تطبيق</button>';";
const j=s.indexOf(d);
if(j>=0){ s=s.slice(0,j)+"if (!_dKNET) "+s.slice(j); n++; }

fs.writeFileSync(p,s,"utf8");
console.log("EDITS:",n);
