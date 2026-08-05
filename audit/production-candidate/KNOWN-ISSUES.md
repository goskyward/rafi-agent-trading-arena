# Known Issues Register

| Issue | Severity / likelihood | Impact | Mitigation | Blocks production? | Owner / follow-up |
|---|---|---|---|---|---|
| Frontend calls root Worker while `[env.production]` names a different, nonexistent Worker | Critical / high | Wrong code target or new DO namespace; frontend unchanged | Choose root target explicitly, document state-preserving command, rerun dry run against that exact target | **Yes** | Release owner / candidate revision |
| Exact strategy version labels unavailable in production UI/API | High / certain | Cannot prove to users/auditors which frozen strategies run | Add a safe public strategy registry or embed hash-bound labels, then rerun UI/UAT | **Yes** | Arena + frontend owners / candidate revision |
| Frontend deployment version and rollback command absent | High / certain | Cannot guarantee coherent rollback | Record hosting release ID, source commit, deployment and rollback commands | **Yes** | Frontend owner / release runbook |
| Worker package reports `1.6.2-staging.1` in production | Medium / certain | Misleading release identity and audit ambiguity | Set a production candidate/release version without strategy changes | Yes under immutable identity requirement | Arena owner / candidate revision |
| Dev-tool dependency advisories (`undici`, `miniflare`, `wrangler`) | Medium / low public-runtime likelihood | CI/deploy-host exposure | Non-forced toolchain upgrade with regression/dry-run | No, because not bundled runtime code; requires tracked follow-up | Toolchain owner / maintenance release |
| `/health` exposes Durable Object object identifier | Low / certain | Infrastructure metadata disclosure | Remove identifier or restrict detailed health | No; identifier is not a credential and write routes remain authenticated | API owner / hardening release |
| No application rate limiting | Medium / moderate | Read abuse or admin brute-force load | Cloudflare rate-limit/WAF policy plus monitoring | Conditional; admin token and DO serialization reduce integrity risk, not availability risk | Operations / before broad launch |
| UAT and production differ in diagnostic/registry endpoints and frontend | Medium / certain | UAT evidence is not complete artifact parity | Run production-candidate-specific UAT after blockers are corrected | **Yes** | QA / candidate revision |

Final recommendation: **HOLD**. Preserve the branch for independent review; do not deploy or tag.
