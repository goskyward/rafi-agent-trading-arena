import assert from "node:assert/strict";
import { planEvaluationAlarm } from "../src/alarm-lifecycle.js";

const now=1_000_000,interval=15_000,active={campaign:{id:"campaign-preserved",status:"ACTIVE"},agents:{CODY:{cashUsd:1_000_000},ATLAS:{cashUsd:1_000_000}},score:{CODY:60,ATLAS:0}};
assert.deepEqual(planEvaluationAlarm(active,null,now,interval),{scheduled:true,before:null,after:1_015_000});
assert.equal(active.campaign.id,"campaign-preserved");
assert.equal(active.agents.CODY.cashUsd,1_000_000);
assert.deepEqual(active.score,{CODY:60,ATLAS:0});
const existing=planEvaluationAlarm(active,1_030_000,now,interval);
assert.deepEqual(existing,{scheduled:false,before:1_030_000,after:1_030_000});
assert.deepEqual(planEvaluationAlarm(active,existing.after,now+1,interval),{scheduled:false,before:1_030_000,after:1_030_000});
assert.deepEqual(planEvaluationAlarm(active,999_999,now,interval),{scheduled:false,before:999_999,after:999_999});
assert.deepEqual(planEvaluationAlarm({campaign:{status:"NOT_STARTED"}},null,now,interval),{scheduled:false,before:null,after:null});
assert.deepEqual(planEvaluationAlarm({campaign:{status:"COMPLETED"}},null,now,interval),{scheduled:false,before:null,after:null});
console.log(JSON.stringify({missingAlarmRecovery:"passed",existingAlarmPreserved:"passed",inactiveSuppression:"passed",statePreservation:"passed"}));
