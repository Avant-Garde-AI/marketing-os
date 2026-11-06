import { describe, expect, it } from "vitest";
import { describeAutomation } from "../templates/agents/lib/automation-status";
const now=Date.parse("2026-11-04T15:00:00Z");
const active={grant:{status:"active"},worker:{status:"ok",checkedAt:"2026-11-04T14:55:00Z"}};
describe("automation status describes work, not just consent",()=>{
  it("does not call a stopped active grant healthy",()=>{
    expect(describeAutomation({...active,batches:[{id:"a",phase:"attention",from:"2026-11-07",through:"2026-11-20",detail:"Provider disconnected",scheduled:0}]},now)).toMatchObject({label:"Needs attention",attention:true});
  });
  it("distinguishes unavailable status from disabled automation",()=>{
    expect(describeAutomation({error:"Could not read status"},now).label).toBe("Status unavailable");
    expect(describeAutomation({grant:null},now).label).toBe("Not enabled");
  });
  it("reports missing and stale checks without pretending posts are scheduled",()=>{
    expect(describeAutomation({grant:{status:"active"}},now).attention).toBe(true);
    expect(describeAutomation({...active,worker:{status:"ok",checkedAt:"2026-11-04T14:00:00Z"}},now).label).toBe("Worker needs attention");
  });
  it("shows generating, opt-out review and ready states distinctly",()=>{
    const b={id:"a",phase:"generate",from:"2026-11-07",through:"2026-11-20",scheduled:0,updatedAt:"2026-11-04T14:59:00Z"};
    expect(describeAutomation({...active,batches:[b]},now).label).toBe("Generating media");
    expect(describeAutomation({...active,batches:[{...b,phase:"realize",finishing:{complete:1,total:25}}]},now)).toMatchObject({label:"Finishing media",attention:false});
    expect(describeAutomation({...active,batches:[{...b,phase:"holding"}]},now).label).toBe("Review open · ships automatically");
    expect(describeAutomation({...active,batches:[{...b,phase:"done",scheduled:14}]},now)).toMatchObject({label:"Backlog ready",attention:false});
  });
  it("flags a stuck batch even while cron still ticks, and keeps pause explicit",()=>{
    expect(describeAutomation({...active,batches:[{id:"a",phase:"prepare",from:"2026-11-07",through:"2026-11-20",scheduled:0,updatedAt:"2026-11-01T12:00:00Z"}]},now).label).toBe("Production stalled");
    expect(describeAutomation({grant:{status:"paused"}},now).label).toBe("Paused");
  });
});
