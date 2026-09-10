# Sara — Security Principles

Sara is a personal agent with real-world reach: it can eventually publish to social
platforms, store private conversations and act on the user's behalf. Security is therefore
part of the architecture, not a cleanup task.

## Core principles

1. **Least privilege.** Sara runs only with explicitly granted permission scopes. Default: deny.
2. **Human approval for important external actions** — publishing content, deleting
   content, sending messages, and anything irreversible.
3. **Full auditability.** Important agent actions are recorded in an append-only audit log
   (what, when, why, which approval, what result).
4. **No secrets in code or Git.** All credentials live in environment variables / secret
   storage, referenced only through the validated config module.
5. **Safe defaults.** Features start disabled/limited; dangerous capability requires
   explicit opt-in by the operator.
6. **Never unrestricted machine access.** No shell on the host, no arbitrary filesystem
   writes outside designated directories, no credential theft surface.

## Secrets handling

- `.env` is gitignored; `.env.example` contains placeholder values only.
- Secret-shaped strings are scanned for by `npm run verify` before every push.
- Secrets are never logged, never placed in URLs, never sent to the client, never stored
  in memory stores or the database in plaintext (platform token *references* only).
- If a secret ever reaches Git history: rotate it immediately, then clean history.

## Permission scopes

Capabilities are strings checked by the orchestrator before any tool or provider call:

```text
memory.read / memory.write / memory.delete
content.draft / content.media.generate
social.publish.youtube / social.publish.facebook / social.publish.instagram / social.publish.tiktok
social.delete.youtube / …
tools.web.fetch / tools.calendar.write / …
```

- Scopes are granted/revoked in Settings by the operator.
- Each tool/provider capability declares the scope it needs; the orchestrator enforces it.
- Scope checks are tested explicitly (a denied scope must be truly denied, and audited).

## Action classes

| Class | Meaning | Examples |
| --- | --- | --- |
| `auto-allowed` | Local, reversible, read-mostly | draft content, read memory, internal tasks |
| `requires-approval` | External or irreversible | publish post, delete post, send message |
| `forbidden` | Explicit deny list | credential export, unrestricted file access |

Approvals are durable records: action preview (diff/content), requested-at, decided-at,
decision, decision-by. Publishing only proceeds with a matching approval record.

## Audit log

- Append-only; no update/delete code paths exist.
- Records: agent actions, approvals, permission changes, settings changes, memory
  deletions, integration connect/disconnect, login events.
- Each entry: timestamp, actor (user/agent/worker), action, target, scope used,
  approval reference, outcome.

## Runtime protections

- Rate limiting on the API (per IP/session) and on outbound provider calls (per platform).
- Input validation (zod) at every trust boundary; tool outputs are **untrusted data**,
  never instructions — this is the prompt-injection defense line.
- Destructive or high-impact tools re-confirm intent at execution time.
- Sessions: httpOnly, secure cookies; short lifetime with renewal; logout invalidates.

## Data protection

- All user data stays on the operator's infrastructure (self-hosted, local-first).
- Memory stores are inspectable and deletable from the dashboard; deletions are audited
  and actually remove data.
- Exports are explicit, operator-initiated actions.
