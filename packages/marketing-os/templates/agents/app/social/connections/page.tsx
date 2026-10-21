"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
export default function SocialConnections() {
  const [state,setState]=useState<{account?:{id:string;username:string};connected?:boolean;error?:string}|null>(null);
  const [token,setToken]=useState(""),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  useEffect(()=>{fetch("/api/social/connection",{cache:"no-store"}).then(r=>r.json()).then(setState).catch(()=>setMessage("Connection status unavailable."));},[]);
  async function connect(event:React.FormEvent){
    event.preventDefault();setBusy(true);setMessage("");
    try {const r=await fetch("/api/social/connection",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token})});setToken("");
      const out=await r.json();if(!r.ok||!out.ok)throw Error(out.error??"Reconnect failed");setState({account:out.account,connected:true});setMessage(out.message);
    } catch(e){setMessage(e instanceof Error?e.message:"Reconnect failed");}finally{setToken("");setBusy(false);}
  }
  return <main className="mx-auto max-w-2xl space-y-6 p-6">
    <Link href="/social">← Back to Social</Link>
    <h1 className="font-display text-3xl">Instagram connection</h1>
    {state?.account && <p>Publishing destination: <strong>@{state.account.username}</strong> · {state.connected?"Connected":"Reconnect required"}</p>}
    <p>A password change or Meta security reset can invalidate an otherwise unexpired publishing token. Reconnect the existing account to resume publishing.</p>
    <p>In your existing <a className="underline" href="https://developers.facebook.com/apps/" target="_blank" rel="noopener noreferrer">Meta app dashboard</a>, generate a new Instagram Login token for this account with content publishing permission. Enter it here yourself; it goes directly to the credential broker and is never included in chat or returned by this page.</p>
    {state?.error && <p role="alert">{state.error}</p>}
    {state?.account && <form onSubmit={connect} className="space-y-4">
      <label className="block">New Instagram publishing token<input className="mt-2 block w-full border p-3" name="instagram-token" type="password" autoComplete="off" autoCorrect="off" spellCheck={false} value={token} onChange={e=>setToken(e.target.value)} disabled={busy}/></label>
      <button className="border px-4 py-2" type="submit" disabled={busy||token.length<30}>{busy?"Verifying account…":`Verify and reconnect @${state.account.username}`}</button>
      <p className="text-sm">This replaces only the connection. It does not approve, schedule or publish posts.</p>
    </form>}
    {message && <p role="status">{message}</p>}
  </main>;
}
