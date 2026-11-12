import fs from "fs";
const p="server/admin/index.html";
let s=fs.readFileSync(p,"utf8").replace(/\r\n/g,"\n");
if(s.includes("selectDisconnectedVisitors")){console.log("ALREADY");process.exit(0);}
let n=0;

const anchor='<button onclick="deleteSelectedVisitors()"';
const i=s.indexOf(anchor);
if(i<0){console.log("BTN ANCHOR FAIL");process.exit(1);}
const lineStart=s.lastIndexOf("\n",i)+1;
const indent=s.slice(lineStart,i);
const btn=indent+'<button onclick="selectDisconnectedVisitors()" class="flex-1 bg-amber-100 text-amber-700 px-3 py-1.5 rounded-lg text-sm hover:bg-amber-200 transition">تحديد غير المتصلين</button>\n';
s=s.slice(0,lineStart)+btn+s.slice(lineStart);
n++;

const fnAnchor="    // Select all visitors";
const j=s.indexOf(fnAnchor);
if(j<0){console.log("FN ANCHOR FAIL");process.exit(1);}
const fn="    // Select disconnected visitors only\n    function selectDisconnectedVisitors() {\n      document.querySelectorAll('.visitor-checkbox').forEach(cb => {\n        const v = visitors.get(cb.dataset.visitorId);\n        cb.checked = !!v && v.isConnected === false;\n      });\n    }\n\n";
s=s.slice(0,j)+fn+s.slice(j);
n++;

fs.writeFileSync(p,s,"utf8");
console.log("EDITS:",n);
