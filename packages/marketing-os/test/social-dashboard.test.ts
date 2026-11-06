import {describe,it,expect,vi} from 'vitest';
const q=vi.hoisted(()=>vi.fn());
vi.mock('../templates/agents/lib/platform-db',()=>({safeQuery:q,tenantIdForShop:async()=> 'tenant-one'}));
vi.mock('../templates/agents/lib/tenant-context',()=>({getTenant:()=>({shop:'one.myshopify.com'})}));
import {dashboardPost,readSocialDashboard,type DashboardRow} from '../templates/agents/lib/social/dashboard';
const row:DashboardRow={id:'2026-11-07-one',channel:'instagram',status:'proposed',copy:'Art',scheduled_at:null,planned_at:'2026-11-07T16:00:00Z',published_at:null,platform_id:null,platform_permalink:null,failure:null,thumbnail_url:null};
describe('social dashboard read model',()=>{
 it('does not label drafts or unreceipted publications as live',()=>{
  expect(dashboardPost(row).workflow.stage).toBe('draft');
  expect(dashboardPost({...row,status:'published'}).workflow.stage).toBe('attention');
  const live=dashboardPost({...row,status:'published',platform_id:'123',platform_permalink:'https://instagram.com/p/one/',published_at:'2026-11-01T16:00:00Z'});
  expect(live.workflow.stage).toBe('published');expect(live.post.platform?.permalink).toContain('/one/');
 });
 it('keeps replaced unfinished automation out of current work while retaining live receipts',()=>{
  expect(dashboardPost({...row,inactive_automation:true}).workflow.stage).toBe('closed');
  expect(dashboardPost({...row,status:'published',platform_id:'123',inactive_automation:true}).workflow.stage).toBe('published');
 });
 it('bounds the post query and scopes both reads to the resolved tenant without artifact IO',async()=>{
  q.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
  expect(await readSocialDashboard('2026-11','active',2)).toEqual({summary:[],rows:[]});
  expect(q.mock.calls.every(c=>c[2][0]==='tenant-one')).toBe(true);
  expect(q.mock.calls[1][1]).toContain('LIMIT 24 OFFSET $4');
  expect(q.mock.calls[1][2]).toEqual(['tenant-one','2026-11','active',24]);
 });
});
