export interface AutomationStatus {
  error?: string;
  grant?: {status:string;policy?:{firstPostDate?:string;firstWindowStart?:string}} | null;
  worker?: {checkedAt:string;status:string;detail?:string} | null;
  batches?: {id:string;phase:string;from:string;through:string;detail?:string;scheduled:number;held?:number;progress?:Record<string,number>;updatedAt?:string}[];
}
export function describeAutomation(s:AutomationStatus | null, now=Date.now()): {label:string;detail:string;attention:boolean} {
  if (!s) return {label:"Checking",detail:"Reading live worker status…",attention:false};
  if (s.error) return {label:"Status unavailable",detail:s.error,attention:true};
  if (!s.grant) return {label:"Not enabled",detail:"Automatic production has not been activated.",attention:true};
  if (s.grant.status !== "active") return {label:"Paused",detail:"Automatic production is paused.",attention:true};
  const b=s.batches?.[0];
  if (b?.phase === "attention") return {label:"Needs attention",detail:b.detail ?? "Production stopped before it could finish.",attention:true};
  if (s.worker && (s.worker.status === "error" || !Number.isFinite(Date.parse(s.worker.checkedAt)) || now-Date.parse(s.worker.checkedAt)>20*60000)) return {label:"Worker needs attention",detail:s.worker.detail ?? "No successful production check in the last 20 minutes.",attention:true};
  if (b && !["done","holding"].includes(b.phase)) {
    if (b.updatedAt && now-Date.parse(b.updatedAt)>2*3600000) return {label:"Production stalled",detail:`No progress since ${b.updatedAt}. ${b.scheduled} scheduled.`,attention:true};
    return {label:b.phase === "generate" ? "Generating media" : "Preparing content",detail:`${b.from.slice(0,10)}–${b.through.slice(0,10)} · ${b.scheduled} scheduled`,attention:false};
  }
  if (b) return {label:b.phase === "holding" ? "Review open · ships automatically" : "Backlog ready",detail:`${b.scheduled} scheduled${b.held?` · ${b.held} held, won’t publish`:""} · ${b.from.slice(0,10)}–${b.through.slice(0,10)}`,attention:false};
  return {label:"Waiting for next window",detail:s.worker ? "Worker is checking automatically; the next batch starts seven days ahead." : "Enabled; awaiting a worker check. Content is not scheduled yet.",attention:!s.worker};
}
