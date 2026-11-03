# Thought2Build workflow: a manually authored teaching example

This sample explains the four-stage workflow. It is not exported product output or customer data.

Starting idea: Build an onboarding checklist for a small SaaS.

# Onboarding checklist

REQ-01  A signed-in user can complete a checklist item.
AC-01   Completion is still visible after a page refresh.

Boundary: users can update only their own checklist.
Review: confirm the checklist and acceptance criteria.

---

# One implementation approach

Store completion against (user_id, item_id).
PATCH /checklist/items/{id} accepts a completed flag.
The server verifies ownership before persisting it.

Decision: saved server state is authoritative.
Risk to check: an update must not affect another user.

---

# Acceptance check: AC-01 → REQ-01

Given: a signed-in user with an incomplete item
When:  they complete it and refresh the page
Then:  the same item remains complete

Boundary check:
A different user cannot update that checklist item.

---

# Delivery task T-03 → REQ-01 / AC-01

Implement the checklist completion endpoint.
- Verify checklist ownership.
- Persist completion for the current user.
- Add the AC-01 acceptance check.

Done: completion survives refresh and the check passes.