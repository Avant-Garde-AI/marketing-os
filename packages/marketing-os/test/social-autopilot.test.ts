import { describe, it, expect } from "vitest";
import { socialAutopilotPolicySchema, autopilotWindow, dueAutopilotWindow, assertBatchSpend, assertAutopilotRelease, socialWallTime } from "../templates/agents/lib/social/autopilot";
const policy = socialAutopilotPolicySchema.parse({schemaVersion:1,enabled:true,account:{id:"123",username:"store"},firstPostDate:"2026-11-01",timeZone:"America/Chicago",localTime:"10:00",batchDays:14,leadDays:7,maximumCredits:125,maximumJobCredits:20,minimumReviewHours:24,requireSlackNotice:true,publishUnlessPaused:true,recipeIds:["artwork-loop","real-home"]});
describe("rolling social production policy",()=>{
 it("prepares non-overlapping fortnights seven calendar days before their first post",()=>{
   expect(dueAutopilotWindow(policy,new Date("2026-10-24T17:00:00Z"))).toBeNull();
   const first=dueAutopilotWindow(policy,new Date("2026-10-25T17:00:00Z"))!;
   expect(first).toMatchObject({from:"2026-11-01",through:"2026-11-14",prepareOn:"2026-10-25"});
   expect(dueAutopilotWindow(policy,new Date("2026-11-07T17:00:00Z"))!.id).toBe(first.id);
   expect(dueAutopilotWindow(policy,new Date("2026-11-08T17:00:00Z"))).toMatchObject({from:"2026-11-15",through:"2026-11-28"});
 });
 it("keeps ten AM local across daylight savings and rejects nonexistent/ambiguous times",()=>{
   const batch=autopilotWindow(policy,0);expect(batch.slots[0].scheduledAt).toBe("2026-11-01T16:00:00.000Z");
   expect(socialWallTime("2026-10-31","10:00","America/Chicago")).toBe("2026-10-31T15:00:00.000Z");
   expect(()=>socialWallTime("2026-03-08","02:30","America/Chicago")).toThrow("does not exist");
   expect(()=>socialWallTime("2026-11-01","01:30","America/Chicago")).toThrow("ambiguous");
 });
 it("rejects invalid dates, unbounded spend and enabled policies without a budget",()=>{
   expect(socialAutopilotPolicySchema.safeParse({...policy,firstPostDate:"2026-02-30"}).success).toBe(false);
   expect(socialAutopilotPolicySchema.safeParse({...policy,maximumCredits:null}).success).toBe(false);
   expect(dueAutopilotWindow({...policy,enabled:false,maximumCredits:null})).toBeNull();
   expect(()=>assertBatchSpend(policy,[{id:"a",maximumCredits:20},{id:"a",maximumCredits:20}])).toThrow("unique");
   expect(()=>assertBatchSpend(policy,[{id:"a",maximumCredits:21}])).toThrow("per-job");
   expect(()=>assertBatchSpend(policy,Array.from({length:7},(_,i)=>({id:String(i),maximumCredits:20})))).toThrow("credit cap");
   expect(assertBatchSpend(policy,[{id:"a",maximumCredits:20}])).toBe(20);
   expect(assertBatchSpend({...policy,maximumJobCredits:8},Array.from({length:28},(_,i)=>({id:`job-${i}`,maximumCredits:i<21?3:8})))).toBe(119);
 });
 it("requires an actual Slack receipt, full ready batch, exact account and review interval",()=>{
   const batch=autopilotWindow(policy,0),now=new Date("2026-10-26T17:00:00Z");
   const slots=batch.slots.map(s=>({...s,ready:true,accountId:"123"}));
   const notice={deliveredAt:"2026-10-25T17:00:00Z",channel:"C123"};
   expect(()=>assertAutopilotRelease(policy,batch,notice,slots,now)).not.toThrow();
   expect(()=>assertAutopilotRelease(policy,batch,{...notice,deliveredAt:null},slots,now)).toThrow("Slack");
   expect(()=>assertAutopilotRelease(policy,batch,notice,slots.slice(1),now)).toThrow("fourteen");
   expect(()=>assertAutopilotRelease(policy,batch,notice,[{...slots[0],ready:false},...slots.slice(1)],now)).toThrow("unfinished");
   expect(()=>assertAutopilotRelease(policy,batch,notice,[{...slots[0],accountId:"456"},...slots.slice(1)],now)).toThrow("another account");
   expect(()=>assertAutopilotRelease(policy,batch,{...notice,deliveredAt:"2026-11-01T15:00:00Z"},slots,new Date("2026-11-01T15:10:00Z"))).toThrow("lead time");
   expect(()=>assertAutopilotRelease({...policy,enabled:false},batch,notice,slots,now)).toThrow("paused");
 });
 it("rejects forged release windows and catches half-hour daylight-saving ambiguity",()=>{
   const batch=autopilotWindow(policy,0),notice={channel:"C123",deliveredAt:"2026-10-25T17:00:00Z"},slots=batch.slots.map(s=>({...s,ready:true,accountId:"123"}));
   expect(()=>assertAutopilotRelease(policy,{...batch,id:"forged"},notice,slots,new Date("2026-10-26T17:00:00Z"))).toThrow("authorized policy");
   expect(()=>socialWallTime("2026-04-05","01:45","Australia/Lord_Howe")).toThrow("ambiguous");
   expect(()=>assertBatchSpend(policy,[{id:"../escape",maximumCredits:1}])).toThrow("unique and bounded");
 });

});
